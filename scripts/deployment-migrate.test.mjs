import { spawnSync } from 'node:child_process'

import { describe, expect, it, vi } from 'vitest'

import {
  migrationFailureMessage,
  migrationOwnerDatabaseClientConfig,
  migrationOwnerDatabaseUrl,
  runMigrationOwner,
} from './deployment-migrate.mjs'
import { ReleaseSourceError } from './deployment-source-check.mjs'

const migration = {
  id: '0001_example',
  sql: 'CREATE TABLE example (id integer PRIMARY KEY);',
}

const verifiedSource = {
  branch: 'main',
  commit: '0123456789abcdef0123456789abcdef01234567',
}

class FakeMigrationClient {
  constructor() {
    this.rows = []
    this.end = vi.fn()
  }

  async query(text, values) {
    if (text.includes("to_regclass('webchess_schema_migrations')")) {
      return {
        rows: [
          {
            migration_ledger:
              this.rows.length > 0
                ? 'webchess_schema_migrations'
                : null,
            has_webchess_objects: false,
          },
        ],
      }
    }
    if (text.includes('SELECT id, checksum')) {
      return { rows: [...this.rows] }
    }
    if (text.includes('INSERT INTO webchess_schema_migrations')) {
      this.rows.push({ id: values[0], checksum: values[1] })
    }
    return { rows: [] }
  }
}

describe('migration-owner deployment command', () => {
  it('requires MIGRATION_DATABASE_URL and never falls back to DATABASE_URL', () => {
    expect(() =>
      migrationOwnerDatabaseUrl({
        DATABASE_URL:
          'postgresql://runtime:runtime-secret@runtime.example/webchess',
      }),
    ).toThrow('MIGRATION_DATABASE_URL is required')

    expect(
      migrationOwnerDatabaseUrl({
        DATABASE_URL:
          'postgresql://runtime:runtime-secret@runtime.example/webchess',
        MIGRATION_DATABASE_URL:
          'postgresql://migration-owner:owner-secret@migration-owner.example/webchess',
      }),
    ).toBe(
      'postgresql://migration-owner:owner-secret@migration-owner.example/webchess',
    )
  })

  it('rejects sslmode=disable for a remote owner database without echoing it', () => {
    const databaseUrl =
      'postgresql://owner:do-not-print@owner.example/webchess?sslmode=disable'

    let configurationError
    let message = ''
    try {
      migrationOwnerDatabaseUrl({ MIGRATION_DATABASE_URL: databaseUrl })
    } catch (error) {
      configurationError = error
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain(
      'MIGRATION_DATABASE_URL contains an unapproved sslmode',
    )
    expect(message).not.toContain(databaseUrl)
    expect(migrationFailureMessage(configurationError)).toBe(message)
  })

  it.each([
    'postgresql://owner:local-secret@127.0.0.1/webchess?sslmode=disable',
    'postgresql://owner:local-secret@[::1]/webchess?sslmode=disable',
  ])('allows sslmode=disable for a loopback owner database: %s', (databaseUrl) => {
    expect(
      migrationOwnerDatabaseUrl({ MIGRATION_DATABASE_URL: databaseUrl }),
    ).toBe(databaseUrl)
  })

  it.each([
    'postgresql://owner:local-secret@127.0.0.1/webchess?sslmode=disable',
    'postgresql://owner:local-secret@[::1]/webchess?sslmode=disable',
  ])('rejects plaintext loopback for a hosted owner command: %s', (databaseUrl) => {
    expect(() => migrationOwnerDatabaseClientConfig({
      MIGRATION_DATABASE_URL: databaseUrl,
      VERCEL: '1',
    })).toThrow('must use verified TLS in a hosted deployment')
  })

  it('rejects plaintext DNS localhost even for a local owner command', () => {
    expect(() => migrationOwnerDatabaseClientConfig({
      MIGRATION_DATABASE_URL:
        'postgresql://owner:local-secret@localhost/webchess?sslmode=disable',
    })).toThrow('MIGRATION_DATABASE_URL contains an unapproved sslmode')
  })

  it('returns only explicit reviewed owner connection fields', () => {
    const config = migrationOwnerDatabaseClientConfig({
      MIGRATION_DATABASE_URL:
        'postgresql://owner:owner-secret@owner.example:6543/webchess?sslmode=verify-full',
    })

    expect(config).toEqual({
      application_name: 'webchess-migration-owner',
      database: 'webchess',
      host: 'owner.example',
      port: 6543,
      ssl: { rejectUnauthorized: true },
      sslnegotiation: 'postgres',
      user: 'owner',
    })
    expect(config.password).toBe('owner-secret')
    expect(config).not.toHaveProperty('connectionString')
  })

  it.each([
    'password=shadow-secret',
    'dbname=shadow-database',
    'ssl=0',
    'sslmode=prefer',
    'sslmode=verify-ca',
    'uselibpqcompat=true',
  ])('rejects a migration URL transport override: %s', (query) => {
    const databaseUrl =
      `postgresql://owner:do-not-print@owner.example/webchess?${query}`

    expect(() => migrationOwnerDatabaseClientConfig({
      MIGRATION_DATABASE_URL: databaseUrl,
    })).toThrow('MIGRATION_DATABASE_URL')
  })

  it.each([
    'PGHOST',
    'PGDATABASE',
    'PGUSER',
    'PGPASSWORD',
    'PGPASSFILE',
    'PGSERVICE',
    'PGSERVICEFILE',
    'PGSSLMODE',
    'PGSSLROOTCERT',
    'NODE_EXTRA_CA_CERTS',
    'NODE_PG_FORCE_NATIVE',
    'NODE_USE_SYSTEM_CA',
    'OPENSSL_CONF',
  ])('rejects migration PostgreSQL environment injection: %s', (name) => {
    const secret = 'environment-secret-do-not-print'
    expect(() => migrationOwnerDatabaseClientConfig({
      MIGRATION_DATABASE_URL:
        'postgresql://owner:owner-secret@owner.example/webchess',
      [name]: secret,
    })).toThrow(name)
  })

  it('rejects native-driver injection before importing pg', () => {
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `
        import { runMigrationOwner } from './scripts/deployment-migrate.mjs'
        try {
          await runMigrationOwner({
            environment: {
              MIGRATION_DATABASE_URL: 'postgresql://owner:secret@owner.example/webchess',
            },
            loadMigrations: async () => [],
            verifySource: async () => ({ branch: 'test', commit: '1'.repeat(40) }),
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
    expect(result.stderr).not.toContain('owner:secret')
  })

  it('honors an ambient hosted marker omitted from the owner environment', () => {
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `
        import { migrationOwnerDatabaseClientConfig } from './scripts/deployment-migrate.mjs'
        try {
          migrationOwnerDatabaseClientConfig({
            MIGRATION_DATABASE_URL: 'postgresql://owner:local-secret@127.0.0.1/webchess?sslmode=disable',
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

  it('applies canonical migrations through only the owner connection', async () => {
    const client = new FakeMigrationClient()
    const order = []
    const connect = vi.fn(async () => {
      order.push('connect')
      return client
    })
    const loadMigrations = vi.fn(async () => {
      order.push('load')
      return [migration]
    })
    const logger = { log: vi.fn() }
    const verifySource = vi.fn(async () => {
      order.push('verify')
      return verifiedSource
    })

    await expect(
      runMigrationOwner({
        environment: {
          DATABASE_URL:
            'postgresql://runtime:runtime-secret@runtime.example/webchess',
          MIGRATION_DATABASE_URL:
            'postgresql://migration-owner:owner-secret@migration-owner.example/webchess',
        },
        connect,
        loadMigrations,
        logger,
        verifySource,
      }),
    ).resolves.toEqual({
      applied: ['0001_example'],
      alreadyApplied: [],
    })

    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledWith({
      application_name: 'webchess-migration-owner',
      database: 'webchess',
      host: 'migration-owner.example',
      port: 5432,
      ssl: { rejectUnauthorized: true },
      sslnegotiation: 'postgres',
      user: 'migration-owner',
    })
    expect(connect.mock.calls[0][0].password).toBe('owner-secret')
    expect(connect.mock.calls[0][0]).not.toHaveProperty('connectionString')
    expect(verifySource).toHaveBeenCalledTimes(2)
    expect(loadMigrations).toHaveBeenCalledOnce()
    expect(order).toEqual(['verify', 'load', 'verify', 'connect'])
    expect(client.end).toHaveBeenCalledOnce()
    expect(logger.log).toHaveBeenCalledWith(
      'Database migrations complete: 1 applied, 0 already present.',
    )
  })

  it('does not load, parse, or connect when initial source verification fails', async () => {
    const connect = vi.fn()
    const loadMigrations = vi.fn()
    const sourceError = new ReleaseSourceError(
      'Release source is not clean; tracked and untracked changes are forbidden.',
    )

    await expect(
      runMigrationOwner({
        environment: {},
        connect,
        loadMigrations,
        verifySource: vi.fn(async () => {
          throw sourceError
        }),
      }),
    ).rejects.toBe(sourceError)

    expect(loadMigrations).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it('does not parse or connect when source changes while migrations load', async () => {
    const connect = vi.fn()
    const loadMigrations = vi.fn(async () => [migration])
    const verifySource = vi
      .fn()
      .mockResolvedValueOnce(verifiedSource)
      .mockResolvedValueOnce({
        ...verifiedSource,
        commit: '89abcdef0123456789abcdef0123456789abcdef',
      })

    await expect(
      runMigrationOwner({
        environment: {},
        connect,
        loadMigrations,
        verifySource,
      }),
    ).rejects.toThrow(
      'Release source changed while canonical migrations were loaded.',
    )

    expect(verifySource).toHaveBeenCalledTimes(2)
    expect(loadMigrations).toHaveBeenCalledOnce()
    expect(connect).not.toHaveBeenCalled()
  })

  it('does not connect when the post-load source verification fails', async () => {
    const connect = vi.fn()
    const sourceError = new ReleaseSourceError(
      'Release source changed during verification.',
    )
    const verifySource = vi
      .fn()
      .mockResolvedValueOnce(verifiedSource)
      .mockRejectedValueOnce(sourceError)

    await expect(
      runMigrationOwner({
        environment: {
          MIGRATION_DATABASE_URL:
            'postgresql://migration-owner:owner-secret@migration-owner.example/webchess',
        },
        connect,
        loadMigrations: async () => [migration],
        verifySource,
      }),
    ).rejects.toBe(sourceError)

    expect(verifySource).toHaveBeenCalledTimes(2)
    expect(connect).not.toHaveBeenCalled()
  })

  it('requires the branch as well as the commit to stay unchanged', async () => {
    const connect = vi.fn()
    const verifySource = vi
      .fn()
      .mockResolvedValueOnce(verifiedSource)
      .mockResolvedValueOnce({
        ...verifiedSource,
        branch: 'release',
      })

    await expect(
      runMigrationOwner({
        environment: {
          MIGRATION_DATABASE_URL:
            'postgresql://migration-owner:owner-secret@migration-owner.example/webchess',
        },
        connect,
        loadMigrations: async () => [migration],
        verifySource,
      }),
    ).rejects.toThrow(
      'Release source changed while canonical migrations were loaded.',
    )

    expect(connect).not.toHaveBeenCalled()
  })

  it('reports controlled release-source failures without rewriting them', () => {
    const sourceError = new ReleaseSourceError(
      'Release source must be an attached local branch.',
    )

    expect(migrationFailureMessage(sourceError)).toBe(sourceError.message)
  })

  it('sanitizes driver failures that may contain database URLs', () => {
    const leakedUrl = 'postgresql://user:password@example.invalid/db'
    const message = migrationFailureMessage(
      new Error(`connection failed for ${leakedUrl}`),
    )

    expect(message).not.toContain(leakedUrl)
    expect(message).toContain('WebChess database migration failed')
  })
})
