import { spawnSync } from 'node:child_process'

import { describe, expect, it, vi } from 'vitest'

import { deploymentMigrationChecksum } from './deployment-database.mjs'
import {
  runSchemaCompatibilityCheck,
  runtimeDatabaseClientConfig,
  runtimeDatabaseUrl,
  schemaCheckMode,
  schemaCheckFailureMessage,
} from './deployment-schema-check.mjs'

const migration = {
  id: '0001_example',
  sql: 'CREATE TABLE example (id integer PRIMARY KEY);',
}

const compatibleRuntimeInspection = {
  schema_resolved: true,
  schema_usage: true,
  schema_create: false,
  public_schema_create: false,
  tables_exact: true,
  columns_exact: true,
  privileges_exact: true,
  column_privileges_exact: true,
  owner_isolated: true,
  indexes_exact: true,
  triggers_exact: true,
  constraints_exact: true,
  defaults_exact: true,
}

class FakeSchemaClient {
  constructor(rows) {
    this.rows = rows
    this.end = vi.fn()
  }

  async query(text) {
    if (text.includes('webchess_runtime_compatibility_probe')) {
      return { rows: [compatibleRuntimeInspection] }
    }
    if (text.includes('SELECT id, checksum')) {
      return { rows: this.rows }
    }
    return { rows: [] }
  }
}

describe('Vercel schema compatibility command', () => {
  it('is an offline no-op outside Vercel in prebuild mode', async () => {
    const connect = vi.fn()

    await expect(
      runSchemaCompatibilityCheck({
        environment: {
          DATABASE_URL:
            'postgresql://runtime:runtime-secret@runtime.example/webchess',
        },
        mode: 'vercel-only',
        connect,
      }),
    ).resolves.toEqual({ checked: false })
    expect(connect).not.toHaveBeenCalled()
  })

  it('accepts only the explicit prebuild flag', () => {
    expect(schemaCheckMode([])).toBe('always')
    expect(schemaCheckMode(['--vercel-only'])).toBe('vercel-only')
    expect(() => schemaCheckMode(['--unknown'])).toThrow(
      'accepts only --vercel-only',
    )
  })

  it('requires the runtime URL and never falls back to the migration-owner URL', () => {
    expect(() =>
      runtimeDatabaseUrl({
        MIGRATION_DATABASE_URL:
          'postgresql://migration-owner.example/webchess',
      }),
    ).toThrow('DATABASE_URL is required')
  })

  it('rejects sslmode=disable for a remote runtime database without echoing it', () => {
    const databaseUrl =
      'postgresql://runtime:do-not-print@runtime.example/webchess?sslmode=disable'

    let configurationError
    let message = ''
    try {
      runtimeDatabaseUrl({ DATABASE_URL: databaseUrl })
    } catch (error) {
      configurationError = error
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('DATABASE_URL contains an unapproved sslmode')
    expect(message).not.toContain(databaseUrl)
    expect(schemaCheckFailureMessage(configurationError)).toBe(message)
  })

  it.each([
    'postgresql://runtime:local-secret@127.0.0.1/webchess?sslmode=disable',
    'postgresql://runtime:local-secret@[::1]/webchess?sslmode=disable',
  ])('allows sslmode=disable for a loopback runtime database: %s', (databaseUrl) => {
    expect(runtimeDatabaseUrl({ DATABASE_URL: databaseUrl })).toBe(databaseUrl)
  })

  it.each([
    'postgresql://runtime:local-secret@127.0.0.1/webchess?sslmode=disable',
    'postgresql://runtime:local-secret@[::1]/webchess?sslmode=disable',
  ])('rejects plaintext loopback for a hosted schema check: %s', (databaseUrl) => {
    expect(() => runtimeDatabaseClientConfig({
      DATABASE_URL: databaseUrl,
      VERCEL: '1',
    })).toThrow('must use verified TLS in a hosted deployment')
  })

  it('rejects plaintext DNS localhost even for a local schema check', () => {
    expect(() => runtimeDatabaseClientConfig({
      DATABASE_URL:
        'postgresql://runtime:local-secret@localhost/webchess?sslmode=disable',
    })).toThrow('DATABASE_URL contains an unapproved sslmode')
  })

  it('returns only explicit reviewed connection fields', () => {
    const config = runtimeDatabaseClientConfig({
      DATABASE_URL:
        'postgresql://runtime:runtime-secret@runtime.example:6543/webchess?sslmode=verify-full',
    })

    expect(config).toEqual({
      application_name: 'webchess-schema-check',
      database: 'webchess',
      host: 'runtime.example',
      port: 6543,
      ssl: { rejectUnauthorized: true },
      sslnegotiation: 'postgres',
      user: 'runtime',
    })
    expect(config.password).toBe('runtime-secret')
    expect(config).not.toHaveProperty('connectionString')
  })

  it.each([
    'host=shadow.invalid',
    'ssl=0',
    'sslmode=require',
    'uselibpqcompat=true',
  ])('rejects a runtime URL transport override: %s', (query) => {
    const databaseUrl =
      `postgresql://runtime:do-not-print@runtime.example/webchess?${query}`

    expect(() => runtimeDatabaseClientConfig({
      DATABASE_URL: databaseUrl,
    })).toThrow('DATABASE_URL')
  })

  it.each([
    'PGHOST',
    'PGPORT',
    'PGPASSWORD',
    'PGPASSFILE',
    'PGSSLMODE',
    'NODE_EXTRA_CA_CERTS',
    'NODE_PG_FORCE_NATIVE',
    'NODE_USE_SYSTEM_CA',
    'SSL_CERT_FILE',
  ])(
    'rejects runtime PostgreSQL environment injection: %s',
    (name) => {
      const secret = 'environment-secret-do-not-print'
      expect(() => runtimeDatabaseClientConfig({
        DATABASE_URL:
          'postgresql://runtime:runtime-secret@runtime.example/webchess',
        [name]: secret,
      })).toThrow(name)
    },
  )

  it('rejects native-driver injection before importing pg', () => {
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `
        import { runSchemaCompatibilityCheck } from './scripts/deployment-schema-check.mjs'
        try {
          await runSchemaCompatibilityCheck({
            environment: {
              DATABASE_URL: 'postgresql://runtime:secret@runtime.example/webchess',
            },
          })
          process.exitCode = 2
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error))
          if (!(error instanceof Error) || !error.message.includes('NODE_PG_FORCE_NATIVE')) {
            process.exitCode = 3
          }
        }
      `,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, NODE_PG_FORCE_NATIVE: '   ' },
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('NODE_PG_FORCE_NATIVE')
    expect(result.stderr).not.toContain('pg-native')
    expect(result.stderr).not.toContain('runtime:secret')
  })

  it('honors an ambient hosted marker omitted from the injected environment', () => {
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `
        import { runSchemaCompatibilityCheck } from './scripts/deployment-schema-check.mjs'
        try {
          await runSchemaCompatibilityCheck({
            environment: {
              DATABASE_URL: 'postgresql://runtime:local-secret@127.0.0.1/webchess?sslmode=disable',
            },
            mode: 'vercel-only',
          })
          process.exitCode = 2
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error))
          if (!(error instanceof Error) || !error.message.includes('verified TLS in a hosted deployment')) {
            process.exitCode = 3
          }
        }
      `,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, VERCEL: '1' },
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('verified TLS in a hosted deployment')
    expect(result.stderr).not.toContain('local-secret')
  })

  it('checks the runtime database without reading the owner URL', async () => {
    const runtimeUrl =
      'postgresql://runtime:runtime-secret@runtime.example/webchess'
    const client = new FakeSchemaClient([
      {
        id: migration.id,
        checksum: deploymentMigrationChecksum(migration.sql),
      },
    ])
    const connect = vi.fn(async () => client)
    const logger = { log: vi.fn() }

    await expect(
      runSchemaCompatibilityCheck({
        environment: {
          VERCEL_PROJECT_ID: 'prj_webchess_example',
          DATABASE_URL: runtimeUrl,
          MIGRATION_DATABASE_URL:
            'postgresql://migration-owner.example/webchess',
        },
        mode: 'vercel-only',
        connect,
        loadMigrations: async () => [migration],
        logger,
      }),
    ).resolves.toEqual({ checked: true })

    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledWith({
      application_name: 'webchess-schema-check',
      database: 'webchess',
      host: 'runtime.example',
      port: 5432,
      ssl: { rejectUnauthorized: true },
      sslnegotiation: 'postgres',
      user: 'runtime',
    })
    expect(connect.mock.calls[0][0].password).toBe('runtime-secret')
    expect(connect.mock.calls[0][0]).not.toHaveProperty('connectionString')
    expect(client.end).toHaveBeenCalledOnce()
    expect(logger.log).toHaveBeenCalledWith(
      'Vercel database schema compatibility check passed.',
    )
  })

  it('fails on a missing migration and still closes the connection', async () => {
    const client = new FakeSchemaClient([])

    await expect(
      runSchemaCompatibilityCheck({
        environment: {
          VERCEL: '1',
          DATABASE_URL:
            'postgresql://runtime:runtime-secret@runtime.example/webchess',
        },
        connect: async () => client,
        loadMigrations: async () => [migration],
        logger: { log: vi.fn() },
      }),
    ).rejects.toThrow(/0001_example has not been applied/)
    expect(client.end).toHaveBeenCalledOnce()
  })

  it('sanitizes driver failures that may contain database URLs', () => {
    const leakedUrl = 'postgresql://user:password@example.invalid/db'
    const message = schemaCheckFailureMessage(
      new Error(`connection failed for ${leakedUrl}`),
    )

    expect(message).not.toContain(leakedUrl)
    expect(message).toContain('schema compatibility check failed')
  })
})
