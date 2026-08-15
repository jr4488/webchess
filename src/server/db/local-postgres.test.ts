// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  runMigrations: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readdir: harness.readdir,
  readFile: harness.readFile,
}))

vi.mock('./migrations', () => ({
  runMigrations: harness.runMigrations,
}))

function databaseWithRow(row: Record<string, unknown> | undefined) {
  return {
    query: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }),
    transaction: vi.fn().mockResolvedValue([]),
  }
}

function migrationEntry(name: string, file = true) {
  return {
    isFile: () => file,
    name,
  }
}

describe('local hosted PostgreSQL schema bootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    harness.readdir.mockResolvedValue([
      migrationEntry('0001_durable_webchess.sql'),
      migrationEntry('0002_webchess_2_lifecycle.sql'),
    ])
    harness.readFile.mockResolvedValue('SELECT 1;')
    harness.runMigrations.mockResolvedValue({
      applied: ['0001_durable_webchess'],
      alreadyApplied: [],
    })
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('loads ordered canonical migration files and rejects unexpected entries', async () => {
    const { loadCanonicalFilesystemMigrations } = await import('./local-postgres')

    await expect(loadCanonicalFilesystemMigrations('/tmp/webchess')).resolves.toEqual([
      { id: '0001_durable_webchess', sql: 'SELECT 1;' },
      { id: '0002_webchess_2_lifecycle', sql: 'SELECT 1;' },
    ])

    harness.readdir.mockResolvedValueOnce([migrationEntry('nested', false)])
    await expect(loadCanonicalFilesystemMigrations()).rejects.toThrow(/unexpected entry/u)
  })

  it('refuses to adopt a local schema that lacks a migration ledger', async () => {
    const { assertDedicatedLocalSchema, ensureLocalHostedSchema } =
      await import('./local-postgres')
    const adopted = databaseWithRow({
      has_migration_ledger: false,
      relation_count: 1,
      schema_name: 'public',
      unexpected_relation: null,
    })

    await expect(assertDedicatedLocalSchema(adopted)).rejects.toThrow(
      /automatic adoption is forbidden/u,
    )
    await expect(ensureLocalHostedSchema(adopted)).rejects.toThrow(
      /automatic adoption is forbidden/u,
    )
    expect(harness.runMigrations).not.toHaveBeenCalled()
  })

  it('refuses an unrelated relation instead of treating the schema as empty', async () => {
    const { assertDedicatedLocalSchema, ensureLocalHostedSchema } =
      await import('./local-postgres')
    const unrelated = databaseWithRow({
      has_migration_ledger: false,
      relation_count: 1,
      schema_name: 'public',
      unexpected_relation: 'r:unrelated_notes',
    })

    await expect(assertDedicatedLocalSchema(unrelated)).rejects.toThrow(
      /unexpected relation \(r:unrelated_notes\)/u,
    )
    await expect(ensureLocalHostedSchema(unrelated)).rejects.toThrow(
      /unexpected relation/u,
    )
    expect(harness.runMigrations).not.toHaveBeenCalled()
  })

  it('migrates a dedicated empty database once per adapter', async () => {
    const { ensureLocalHostedSchema } = await import('./local-postgres')
    const database = databaseWithRow({
      has_migration_ledger: false,
      relation_count: 0,
      schema_name: 'public',
      unexpected_relation: null,
    })

    await ensureLocalHostedSchema(database)
    await ensureLocalHostedSchema(database)

    expect(harness.runMigrations).toHaveBeenCalledOnce()
    expect(harness.runMigrations).toHaveBeenCalledWith(database, [
      expect.objectContaining({ id: '0001_durable_webchess' }),
      expect.objectContaining({ id: '0002_webchess_2_lifecycle' }),
    ])
  })

  it('accepts a canonical ledger-backed migration prefix', async () => {
    const { ensureLocalHostedSchema } = await import('./local-postgres')
    const database = databaseWithRow({
      has_migration_ledger: true,
      relation_count: 36,
      schema_name: 'public',
      unexpected_relation: null,
    })

    await ensureLocalHostedSchema(database)

    expect(harness.runMigrations).toHaveBeenCalledOnce()
  })
})
