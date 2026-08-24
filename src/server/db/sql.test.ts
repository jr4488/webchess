// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'

describe('lazy Neon database configuration', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  const originalForceNative = process.env.NODE_PG_FORCE_NATIVE

  afterEach(() => {
    vi.doUnmock('pg')
    vi.resetModules()
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl
    }
    if (originalForceNative === undefined) {
      delete process.env.NODE_PG_FORCE_NATIVE
    } else {
      process.env.NODE_PG_FORCE_NATIVE = originalForceNative
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

  it('does not load pg-native for a hosted Neon adapter', async () => {
    vi.doMock('pg', () => {
      throw new Error('The hosted adapter must not load node-postgres.')
    })
    process.env.NODE_PG_FORCE_NATIVE = '1'
    process.env.DATABASE_URL =
      'postgresql://webchess:secret@db.example.invalid:5432/webchess'
    vi.resetModules()

    const databaseModule = await import('./sql')

    expect(() => databaseModule.getDatabase()).not.toThrow()
  })

  it('rejects inherited pg-native selection before loading a local Pool', async () => {
    process.env.NODE_PG_FORCE_NATIVE = '0'
    process.env.DATABASE_URL =
      'postgresql://webchess:secret@127.0.0.1:55433/webchess'
    vi.resetModules()

    const databaseModule = await import('./sql')

    expect(() => databaseModule.getDatabase()).toThrow(
      /NODE_PG_FORCE_NATIVE must be unset/u,
    )
  })

  it('rejects an empty explicit connection string', async () => {
    const { createNeonSqlAdapter } = await import('./sql')

    expect(() => createNeonSqlAdapter('   ')).toThrow(
      /non-empty database connection string/,
    )
  })

  it.each([
    ['host override', '?host=database.example.invalid'],
    ['SSL disable override', '?ssl=0'],
    ['libpq SSL override', '?sslmode=disable'],
    ['libpq compatibility override', '?uselibpqcompat=true'],
    ['fragment', '#database.example.invalid'],
  ])('rejects a loopback DATABASE_URL with %s', async (_label, suffix) => {
    process.env.DATABASE_URL =
      `postgresql://webchess:secret@127.0.0.1:55433/webchess${suffix}`
    vi.resetModules()

    const databaseModule = await import('./sql')

    expect(() => databaseModule.getDatabase()).toThrow(
      /must not contain a query or fragment/u,
    )
  })
})
