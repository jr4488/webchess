// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  createApiServices: vi.fn(),
  createPostgresSqlAdapter: vi.fn(),
  createUsageController: vi.fn(),
  loadUsageConfig: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  runMigrations: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('node:fs/promises', () => ({
  readFile: harness.readFile,
  readdir: harness.readdir,
}))
vi.mock('@/server/db', () => ({
  createPostgresSqlAdapter: harness.createPostgresSqlAdapter,
}))
vi.mock('@/server/db/migrations', () => ({
  runMigrations: harness.runMigrations,
}))
vi.mock('@/server/games', () => ({
  DurableGameRepository: class DurableGameRepository {
    constructor(readonly database: unknown) {}
  },
}))
vi.mock('@/server/http/service-adapter', () => ({
  createApiServicesWithDependencies: harness.createApiServices,
}))
vi.mock('@/server/lifecycle', () => ({
  DurableLifecycleRepository: class DurableLifecycleRepository {
    constructor(readonly database: unknown) {}
  },
}))
vi.mock('@/server/research', () => ({
  DurableResearchBroker: class DurableResearchBroker {
    constructor(readonly repository: unknown) {}
  },
  DurableResearchRepository: class DurableResearchRepository {
    constructor(readonly database: unknown) {}
  },
}))
vi.mock('@/server/usage', () => ({
  createUsageController: harness.createUsageController,
  loadUsageConfig: harness.loadUsageConfig,
}))

const ENVIRONMENT_KEYS = [
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_TARGET_ENV',
  'VERCEL_URL',
  'WEBCHESS_OPENCLAW_DATABASE_URL',
  'WEBCHESS_OPENCLAW_ENABLED',
] as const
const originalEnvironment = Object.fromEntries(
  ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
)

function migrationEntry(name: string, file = true) {
  return {
    isFile: () => file,
    name,
  }
}

function databaseWithRow(
  row: Record<string, unknown> | undefined,
  version: Record<string, unknown> | undefined = {
    server_version: '17.6',
    server_version_num: '170006',
  },
) {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockImplementation(async (statement: { text: string }) => ({
      rows: statement.text.includes("server_version_num")
        ? (version ? [version] : [])
        : (row ? [row] : []),
    })),
  }
}

async function loadServicesModule() {
  return import('./services')
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  for (const key of ENVIRONMENT_KEYS) delete process.env[key]
  process.env.WEBCHESS_OPENCLAW_ENABLED = 'true'
  process.env.WEBCHESS_OPENCLAW_DATABASE_URL =
    'postgresql://webchess_test:webchess_test@127.0.0.1:55432/webchess_test'
  harness.readdir.mockResolvedValue([
    migrationEntry('0001_initial.sql'),
    migrationEntry('0010_player_visible_answer_prompt.sql'),
  ])
  harness.readFile.mockImplementation(async (path: unknown) =>
    `-- migration ${String(path)}`)
  harness.loadUsageConfig.mockReturnValue({ hmacSecret: 'test-hmac-secret' })
  harness.createUsageController.mockReturnValue({ kind: 'usage-controller' })
  harness.runMigrations.mockResolvedValue(undefined)
  harness.createApiServices.mockReturnValue({ kind: 'api-services' })
  harness.createPostgresSqlAdapter.mockReturnValue(databaseWithRow({
    has_migration_ledger: false,
    relation_count: 0,
    schema_name: 'public',
    unexpected_relation: null,
  }))
})

afterEach(() => {
  for (const key of ENVIRONMENT_KEYS) {
    const value = originalEnvironment[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('OpenClaw durable service bootstrap', () => {
  it('rejects every hosted or disabled environment before opening PostgreSQL', async () => {
    const { getOpenClawApiServices } = await loadServicesModule()

    for (const [name, value] of [
      ['VERCEL', '1'],
      ['VERCEL_ENV', 'preview'],
      ['VERCEL_TARGET_ENV', 'preview'],
      ['VERCEL_URL', 'webchess-preview.vercel.app'],
    ] as const) {
      process.env[name] = value
      await expect(getOpenClawApiServices()).rejects.toThrow(/disabled/u)
      delete process.env[name]
    }

    process.env.WEBCHESS_OPENCLAW_ENABLED = 'false'
    await expect(getOpenClawApiServices()).rejects.toThrow(/disabled/u)

    expect(harness.createPostgresSqlAdapter).not.toHaveBeenCalled()
  })

  it('requires a valid loopback PostgreSQL URL', async () => {
    const { getOpenClawApiServices } = await loadServicesModule()

    delete process.env.WEBCHESS_OPENCLAW_DATABASE_URL
    await expect(getOpenClawApiServices()).rejects.toThrow(
      /must point to the dedicated local PostgreSQL database/u,
    )

    process.env.WEBCHESS_OPENCLAW_DATABASE_URL = 'not a URL'
    await expect(getOpenClawApiServices()).rejects.toThrow(/not a valid URL/u)

    process.env.WEBCHESS_OPENCLAW_DATABASE_URL = 'https://127.0.0.1/webchess'
    await expect(getOpenClawApiServices()).rejects.toThrow(/must use PostgreSQL/u)

    process.env.WEBCHESS_OPENCLAW_DATABASE_URL =
      'postgresql://webchess_test:webchess_test@db.example/webchess_test'
    await expect(getOpenClawApiServices()).rejects.toThrow(/loopback host/u)

    expect(harness.createPostgresSqlAdapter).not.toHaveBeenCalled()
  })

  it('queries the real server version and rejects anything except PostgreSQL 17', async () => {
    const unsupported = databaseWithRow({
      has_migration_ledger: false,
      relation_count: 0,
      schema_name: 'public',
      unexpected_relation: null,
    }, {
      server_version: '16.10',
      server_version_num: '160010',
    })
    harness.createPostgresSqlAdapter.mockReturnValue(unsupported)
    const { getOpenClawApiServices } = await loadServicesModule()

    await expect(getOpenClawApiServices()).rejects.toMatchObject({
      detectedMajorVersion: 16,
      detectedServerVersion: '16.10',
      reason: 'unsupported-version',
    })
    expect(unsupported.query).toHaveBeenCalledOnce()
    expect(harness.runMigrations).not.toHaveBeenCalled()
    expect(unsupported.close).toHaveBeenCalledOnce()
  })

  it('rejects a malformed PostgreSQL version response before schema inspection', async () => {
    const malformed = databaseWithRow({
      has_migration_ledger: false,
      relation_count: 0,
      schema_name: 'public',
      unexpected_relation: null,
    }, {
      server_version: '17.6',
      server_version_num: 170006,
    })
    harness.createPostgresSqlAdapter.mockReturnValue(malformed)
    const { getOpenClawApiServices } = await loadServicesModule()

    await expect(getOpenClawApiServices()).rejects.toMatchObject({
      reason: 'unavailable',
    })
    expect(malformed.query).toHaveBeenCalledOnce()
    expect(harness.runMigrations).not.toHaveBeenCalled()
    expect(malformed.close).toHaveBeenCalledOnce()
  })

  it('fails closed for directories, unexpected names, and an empty migration set', async () => {
    const { getOpenClawApiServices } = await loadServicesModule()

    harness.readdir.mockResolvedValueOnce([migrationEntry('nested', false)])
    await expect(getOpenClawApiServices()).rejects.toThrow(/unexpected entry/u)

    harness.readdir.mockResolvedValueOnce([migrationEntry('README.md')])
    await expect(getOpenClawApiServices()).rejects.toThrow(/unexpected entry/u)

    harness.readdir.mockResolvedValueOnce([])
    await expect(getOpenClawApiServices()).rejects.toThrow(/no database migrations/u)

    expect(harness.createPostgresSqlAdapter).not.toHaveBeenCalled()
  })

  it('rejects malformed or unsafe existing schemas and always closes the adapter', async () => {
    const databases = [
      databaseWithRow(undefined),
      databaseWithRow({
        has_migration_ledger: false,
        relation_count: 0,
        schema_name: 7,
        unexpected_relation: null,
      }),
      databaseWithRow({
        has_migration_ledger: 'no',
        relation_count: 0,
        schema_name: 'public',
        unexpected_relation: null,
      }),
      databaseWithRow({
        has_migration_ledger: false,
        relation_count: 1,
        schema_name: 'public',
        unexpected_relation: null,
      }),
    ]
    const pendingDatabases = [...databases]
    harness.createPostgresSqlAdapter.mockImplementation(() => pendingDatabases.shift())
    const { getOpenClawApiServices } = await loadServicesModule()

    await expect(getOpenClawApiServices()).rejects.toThrow(/inspected safely/u)
    await expect(getOpenClawApiServices()).rejects.toThrow(/inspected safely/u)
    await expect(getOpenClawApiServices()).rejects.toThrow(/inspected safely/u)
    await expect(getOpenClawApiServices()).rejects.toThrow(/automatic adoption is forbidden/u)

    for (const database of databases) {
      expect(database.close).toHaveBeenCalledOnce()
    }
  })

  it('runs ordered migrations once and reuses the fully composed service graph', async () => {
    const database = databaseWithRow({
      has_migration_ledger: true,
      relation_count: 74,
      schema_name: 'public',
      unexpected_relation: null,
    })
    harness.createPostgresSqlAdapter.mockReturnValue(database)
    const services = { kind: 'webchess-services' }
    harness.createApiServices.mockReturnValue(services)
    const {
      getOpenClawApiServices,
      getOpenClawDatabaseStatus,
    } = await loadServicesModule()

    await expect(getOpenClawApiServices()).resolves.toBe(services)
    await expect(getOpenClawApiServices()).resolves.toBe(services)
    await expect(getOpenClawDatabaseStatus()).resolves.toEqual({
      available: true,
      engine: 'PostgreSQL',
      majorVersion: 17,
      scope: 'dedicated-local',
      serverVersion: '17.6',
    })

    expect(harness.readFile).toHaveBeenCalledTimes(2)
    expect(harness.runMigrations).toHaveBeenCalledWith(database, [
      expect.objectContaining({ id: '0001_initial' }),
      expect.objectContaining({ id: '0010_player_visible_answer_prompt' }),
    ])
    expect(harness.createApiServices).toHaveBeenCalledWith(
      expect.objectContaining({
        modelProvider: 'openclaw',
        softwareVersion: 'webchess@2.2.0-rc.1-openclaw',
      }),
    )
    expect(harness.createPostgresSqlAdapter).toHaveBeenCalledOnce()
    expect(database.query).toHaveBeenCalledTimes(2)
    expect(database.close).not.toHaveBeenCalled()
  })

  it('closes PostgreSQL and allows a clean retry when initialization fails', async () => {
    const failedDatabase = databaseWithRow({
      has_migration_ledger: false,
      relation_count: 0,
      schema_name: 'public',
      unexpected_relation: null,
    })
    const recoveredDatabase = databaseWithRow({
      has_migration_ledger: false,
      relation_count: 0,
      schema_name: 'public',
      unexpected_relation: null,
    })
    harness.createPostgresSqlAdapter
      .mockReturnValueOnce(failedDatabase)
      .mockReturnValueOnce(recoveredDatabase)
    harness.runMigrations
      .mockRejectedValueOnce(new Error('migration failed'))
      .mockResolvedValueOnce(undefined)
    const services = { kind: 'recovered-services' }
    harness.createApiServices.mockReturnValue(services)
    const { getOpenClawApiServices } = await loadServicesModule()

    await expect(getOpenClawApiServices()).rejects.toThrow('migration failed')
    await expect(getOpenClawApiServices()).resolves.toBe(services)

    expect(failedDatabase.close).toHaveBeenCalledOnce()
    expect(recoveredDatabase.close).not.toHaveBeenCalled()
  })
})
