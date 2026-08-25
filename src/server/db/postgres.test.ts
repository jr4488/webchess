// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  clientQueries: [] as Array<{
    text: string
    values: readonly unknown[] | undefined
  }>,
  clientReplies: [] as Array<Error | {
    command: string
    rowCount: number | null
    rows: Record<string, unknown>[]
  }>,
  connectCount: 0,
  configs: [] as Record<string, unknown>[],
  endCount: 0,
  poolQueries: [] as Array<{
    text: string
    values: readonly unknown[] | undefined
  }>,
  poolReplies: [] as Array<Error | {
    command: string
    rowCount: number | null
    rows: Record<string, unknown>[]
  }>,
  releaseCount: 0,
}))

vi.mock('./postgres-runtime', () => ({
  loadPostgresPool: () => class Pool {
    constructor(config: Record<string, unknown>) {
      harness.configs.push(config)
    }

    async connect() {
      harness.connectCount += 1
      return {
        async query(text: string, values?: readonly unknown[]) {
          harness.clientQueries.push({ text, values })
          const reply = harness.clientReplies.shift() ?? {
            command: text.split(' ')[0] ?? '',
            rowCount: null,
            rows: [],
          }
          if (reply instanceof Error) throw reply
          return reply
        },
        release() {
          harness.releaseCount += 1
        },
      }
    }

    async end(): Promise<void> {
      harness.endCount += 1
    }

    async query(text: string, values?: readonly unknown[]) {
      harness.poolQueries.push({ text, values })
      const reply = harness.poolReplies.shift()
      if (reply === undefined) {
        throw new Error('Unexpected PostgreSQL query in a unit test.')
      }
      if (reply instanceof Error) throw reply
      return reply
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
    harness.clientQueries.length = 0
    harness.clientReplies.length = 0
    harness.connectCount = 0
    harness.configs.length = 0
    harness.endCount = 0
    harness.poolQueries.length = 0
    harness.poolReplies.length = 0
    harness.releaseCount = 0
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

  it('uses the bounded default application name and rejects unsafe names', () => {
    createPostgresSqlAdapter(
      'postgresql://webchess:secret@127.0.0.1:55433/webchess',
    )
    createPostgresSqlAdapter(
      'postgresql://webchess:secret@127.0.0.1:55433/webchess',
      { applicationName: '   ' },
    )

    expect(harness.configs.map((config) => config.application_name)).toEqual([
      'webchess-openclaw-v2',
      'webchess-openclaw-v2',
    ])
    expect(() => createPostgresSqlAdapter(
      'postgresql://webchess:secret@127.0.0.1:55433/webchess',
      { applicationName: 'x'.repeat(121) },
    )).toThrow(/application name is invalid/u)
    expect(() => createPostgresSqlAdapter(
      'postgresql://webchess:secret@127.0.0.1:55433/webchess',
      { applicationName: 'webchess\nspoofed' },
    )).toThrow(/application name is invalid/u)
  })

  it('maps query results and never reuses a caller-owned values array', async () => {
    harness.poolReplies.push(
      {
        command: 'SELECT',
        rowCount: 1,
        rows: [{ id: 'case-1' }],
      },
      {
        command: 'SELECT',
        rowCount: null,
        rows: [{ id: 'case-2' }, { id: 'case-3' }],
      },
    )
    const adapter = createPostgresSqlAdapter(
      'postgresql://webchess:secret@127.0.0.1:55433/webchess',
    )
    const values = ['case-1']

    await expect(adapter.query<{ id: string }>({
      text: 'SELECT id FROM games WHERE id = $1',
      values,
    })).resolves.toEqual({
      command: 'SELECT',
      rowCount: 1,
      rows: [{ id: 'case-1' }],
    })
    await expect(adapter.query<{ id: string }>({
      text: 'SELECT id FROM games',
    })).resolves.toEqual({
      command: 'SELECT',
      rowCount: 2,
      rows: [{ id: 'case-2' }, { id: 'case-3' }],
    })
    expect(harness.poolQueries).toEqual([
      {
        text: 'SELECT id FROM games WHERE id = $1',
        values: ['case-1'],
      },
      { text: 'SELECT id FROM games', values: [] },
    ])
    expect(harness.poolQueries[0]?.values).not.toBe(values)
  })

  it('does not reserve a client for an empty transaction', async () => {
    const adapter = createPostgresSqlAdapter(
      'postgresql://webchess:secret@127.0.0.1:55433/webchess',
    )

    await expect(adapter.transaction([])).resolves.toEqual([])
    expect(harness.connectCount).toBe(0)
    expect(harness.clientQueries).toEqual([])
  })

  it.each([
    ['ReadUncommitted', 'READ UNCOMMITTED'],
    ['ReadCommitted', 'READ COMMITTED'],
    ['RepeatableRead', 'REPEATABLE READ'],
    ['Serializable', 'SERIALIZABLE'],
  ] as const)(
    'commits a %s read-only deferrable transaction',
    async (isolationLevel, sqlLevel) => {
      harness.clientReplies.push(
        { command: 'BEGIN', rowCount: null, rows: [] },
        { command: 'SELECT', rowCount: 1, rows: [{ id: 'case-1' }] },
        { command: 'COMMIT', rowCount: null, rows: [] },
      )
      const adapter = createPostgresSqlAdapter(
        'postgresql://webchess:secret@127.0.0.1:55433/webchess',
      )

      await expect(adapter.transaction(
        [{ text: 'SELECT id FROM games WHERE id = $1', values: ['case-1'] }],
        { deferrable: true, isolationLevel, readOnly: true },
      )).resolves.toEqual([{
        command: 'SELECT',
        rowCount: 1,
        rows: [{ id: 'case-1' }],
      }])
      expect(harness.clientQueries).toEqual([
        {
          text: `BEGIN ISOLATION LEVEL ${sqlLevel}, READ ONLY, DEFERRABLE`,
          values: undefined,
        },
        {
          text: 'SELECT id FROM games WHERE id = $1',
          values: ['case-1'],
        },
        { text: 'COMMIT', values: undefined },
      ])
      expect(harness.releaseCount).toBe(1)
    },
  )

  it('renders explicit read-write and non-deferrable transaction modes', async () => {
    const adapter = createPostgresSqlAdapter(
      'postgresql://webchess:secret@127.0.0.1:55433/webchess',
    )

    await expect(adapter.transaction(
      [{ text: 'UPDATE games SET revision = revision + 1' }],
      { deferrable: false, readOnly: false },
    )).resolves.toEqual([{
      command: 'UPDATE',
      rowCount: 0,
      rows: [],
    }])
    expect(harness.clientQueries.map(({ text }) => text)).toEqual([
      'BEGIN READ WRITE, NOT DEFERRABLE',
      'UPDATE games SET revision = revision + 1',
      'COMMIT',
    ])
    expect(harness.releaseCount).toBe(1)
  })

  it('uses a plain BEGIN by default and rolls back before releasing on error', async () => {
    harness.clientReplies.push(
      { command: 'BEGIN', rowCount: null, rows: [] },
      new Error('statement failed'),
      { command: 'ROLLBACK', rowCount: null, rows: [] },
    )
    const adapter = createPostgresSqlAdapter(
      'postgresql://webchess:secret@127.0.0.1:55433/webchess',
    )

    await expect(adapter.transaction([
      { text: 'UPDATE games SET revision = revision + 1' },
    ])).rejects.toThrow('statement failed')
    expect(harness.clientQueries.map(({ text }) => text)).toEqual([
      'BEGIN',
      'UPDATE games SET revision = revision + 1',
      'ROLLBACK',
    ])
    expect(harness.releaseCount).toBe(1)
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

  it('ignores empty rejected override variables', () => {
    for (const key of [
      'NODE_PG_FORCE_NATIVE',
      'PGBINARY',
      'PGCLIENT_ENCODING',
      'PGCLIENTENCODING',
      'PGHOSTADDR',
      'PGREPLICATION',
    ] as const) {
      process.env[key] = ''
    }

    expect(() => createPostgresSqlAdapter(
      'postgresql://webchess:secret@127.0.0.1:55433/webchess',
    )).not.toThrow()
    expect(harness.configs).toHaveLength(1)
  })
})
