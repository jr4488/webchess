import { describe, expect, it } from 'vitest'

import { assertDedicatedLocalSchema } from '../../src/server/db/local-postgres'
import { runMigrations } from '../../src/server/db/migrations'
import {
  createPostgresTestDatabase,
  durableWebChessMigrations,
} from './postgres-test-database'

describe('dedicated local PostgreSQL schema boundary', () => {
  it('accepts a genuinely empty schema and rejects an unrelated relation', async () => {
    const database = await createPostgresTestDatabase('local_schema_boundary')
    try {
      await expect(
        assertDedicatedLocalSchema(database.adapter),
      ).resolves.toBeUndefined()

      await database.adapter.query({
        text: 'CREATE TABLE unrelated_notes (id integer PRIMARY KEY)',
      })

      await expect(
        assertDedicatedLocalSchema(database.adapter),
      ).rejects.toThrow(/unexpected relation/u)
    } finally {
      await database.dispose()
    }
  })

  it('accepts a canonical ledger-backed migration prefix', async () => {
    const database = await createPostgresTestDatabase('local_schema_prefix')
    try {
      await runMigrations(database.adapter, durableWebChessMigrations.slice(0, 2))

      await expect(
        assertDedicatedLocalSchema(database.adapter),
      ).resolves.toBeUndefined()
    } finally {
      await database.dispose()
    }
  })

  it('accepts the complete canonical schema', async () => {
    const database = await createPostgresTestDatabase('local_schema_complete')
    try {
      await database.migrate()

      await expect(
        assertDedicatedLocalSchema(database.adapter),
      ).resolves.toBeUndefined()
    } finally {
      await database.dispose()
    }
  })
})
