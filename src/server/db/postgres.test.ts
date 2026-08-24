// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  configs: [] as Record<string, unknown>[],
  endCount: 0,
}))

vi.mock('./postgres-runtime', () => ({
  loadPostgresPool: () => class Pool {
    constructor(config: Record<string, unknown>) {
      harness.configs.push(config)
    }

    async connect(): Promise<never> {
      throw new Error('Unexpected PostgreSQL connection in a unit test.')
    }

    async end(): Promise<void> {
      harness.endCount += 1
    }

    async query(): Promise<never> {
      throw new Error('Unexpected PostgreSQL query in a unit test.')
    }
  },
}))

import { createPostgresSqlAdapter } from './postgres'

const PG_ENVIRONMENT_KEYS = [
  'NODE_PG_FORCE_NATIVE',
  'PGAPPNAME',
  'PGBINARY',
  'PGCLIENT_ENCODING',
  'PGCLIENTENCODING',
  'PGCONNECT_TIMEOUT',
  'PGDATABASE',
  'PGHOST',
  'PGHOSTADDR',
  'PGOPTIONS',
  'PGPASSWORD',
  'PGPORT',
  'PGREPLICATION',
  'PGSERVICE',
  'PGSSLMODE',
  'PGSSLNEGOTIATION',
  'PGUSER',
] as const
const originalPgEnvironment = Object.fromEntries(
  PG_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
)

describe('PostgreSQL wire adapter', () => {
  beforeEach(() => {
    harness.configs.length = 0
    harness.endCount = 0
  })

  afterEach(() => {
    for (const key of PG_ENVIRONMENT_KEYS) {
      const value = originalPgEnvironment[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('rejects an empty connection string before opening a pool', () => {
    expect(() => createPostgresSqlAdapter('')).toThrow(
      /non-empty PostgreSQL connection string/u,
    )
    expect(() => createPostgresSqlAdapter('   ')).toThrow(
      /non-empty PostgreSQL connection string/u,
    )
  })

  it('uses only the validated URL tuple despite inherited PG overrides', async () => {
    process.env.PGHOST = 'database.example.invalid'
    process.env.PGPORT = '6432'
    process.env.PGDATABASE = 'production'
    process.env.PGUSER = 'production-owner'
    process.env.PGPASSWORD = 'production-password'
    process.env.PGSSLMODE = 'require'
    process.env.PGSSLNEGOTIATION = 'direct'
    process.env.PGSERVICE = 'production-service'
    process.env.PGOPTIONS = '-c search_path=production'
    process.env.PGAPPNAME = 'production-app'
    process.env.PGCONNECT_TIMEOUT = '600'

    const adapter = createPostgresSqlAdapter(
      'postgresql://webchess:p%40ssword@127.0.0.1:55433/webchess',
      { applicationName: 'webchess-test' },
    )

    expect(harness.configs).toEqual([{
      application_name: 'webchess-test',
      connectionTimeoutMillis: 5_000,
      database: 'webchess',
      host: '127.0.0.1',
      max: 8,
      options: '-c search_path=public',
      password: 'p@ssword',
      port: 55_433,
      ssl: false,
      sslnegotiation: 'postgres',
      user: 'webchess',
    }])
    expect(harness.configs[0]).not.toHaveProperty('connectionString')

    await adapter.close()
    expect(harness.endCount).toBe(1)
  })

  it.each([
    ['PGBINARY', '1'],
    ['PGCLIENT_ENCODING', 'SQL_ASCII'],
    ['PGCLIENTENCODING', 'SQL_ASCII'],
    ['PGHOSTADDR', '198.51.100.22'],
    ['NODE_PG_FORCE_NATIVE', '1'],
    ['NODE_PG_FORCE_NATIVE', '0'],
    ['PGREPLICATION', 'database'],
  ])('rejects effective %s before constructing a Pool', (key, value) => {
    process.env[key] = value

    expect(() => createPostgresSqlAdapter(
      'postgresql://webchess:secret@127.0.0.1:55433/webchess',
    )).toThrow(/must be unset for a validated local PostgreSQL connection/u)
    expect(harness.configs).toEqual([])
  })
})
