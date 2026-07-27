import { describe, expect, it, vi } from 'vitest'

import {
  migrationFailureMessage,
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
        DATABASE_URL: 'postgresql://runtime.example/webchess',
      }),
    ).toThrow('MIGRATION_DATABASE_URL is required')

    expect(
      migrationOwnerDatabaseUrl({
        DATABASE_URL: 'postgresql://runtime.example/webchess',
        MIGRATION_DATABASE_URL:
          'postgresql://migration-owner.example/webchess',
      }),
    ).toBe('postgresql://migration-owner.example/webchess')
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
          DATABASE_URL: 'postgresql://runtime.example/webchess',
          MIGRATION_DATABASE_URL:
            'postgresql://migration-owner.example/webchess',
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
    expect(connect).toHaveBeenCalledWith(
      'postgresql://migration-owner.example/webchess',
    )
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
            'postgresql://migration-owner.example/webchess',
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
            'postgresql://migration-owner.example/webchess',
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
