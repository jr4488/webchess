import { describe, expect, it, vi } from 'vitest'

import { deploymentMigrationChecksum } from './deployment-database.mjs'
import {
  runSchemaCompatibilityCheck,
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
  owner_isolated: true,
  indexes_exact: true,
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
          DATABASE_URL: 'postgresql://runtime.example/webchess',
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

  it('checks the runtime database without reading the owner URL', async () => {
    const runtimeUrl = 'postgresql://runtime.example/webchess'
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
    expect(connect).toHaveBeenCalledWith(runtimeUrl)
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
          DATABASE_URL: 'postgresql://runtime.example/webchess',
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
