// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'

describe('lazy Neon database configuration', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL

  afterEach(() => {
    vi.resetModules()
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl
    }
  })

  it('can import the module without DATABASE_URL', async () => {
    delete process.env.DATABASE_URL
    vi.resetModules()

    const databaseModule = await import('./sql')

    expect(databaseModule.getDatabase).toBeTypeOf('function')
    expect(() => databaseModule.getDatabase()).toThrow(
      /DATABASE_URL is not configured/,
    )
  })

  it('uses the PostgreSQL wire adapter for loopback Clerk development', async () => {
    process.env.DATABASE_URL =
      'postgresql://webchess:secret@127.0.0.1:55433/webchess'
    vi.resetModules()

    const databaseModule = await import('./sql')
    const database = databaseModule.getDatabase() as unknown as {
      close(): Promise<void>
    }

    expect(database).toHaveProperty('close')
    await database.close()
  })

  it('rejects an empty explicit connection string', async () => {
    const { createNeonSqlAdapter } = await import('./sql')

    expect(() => createNeonSqlAdapter('   ')).toThrow(
      /non-empty database connection string/,
    )
  })
})
