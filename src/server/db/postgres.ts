import 'server-only'

import type { Pool, PoolClient, PoolConfig, QueryResult } from 'pg'

import { parseLoopbackPostgresUrl } from './adapter-kind'
import { loadPostgresPool } from './postgres-runtime'

import type {
  SqlAdapter,
  SqlResult,
  SqlRow,
  SqlStatement,
  SqlTransactionOptions,
} from './sql'

export type PostgresSqlAdapter = SqlAdapter & {
  close(): Promise<void>
}

export interface PostgresSqlAdapterOptions {
  readonly applicationName?: string
}

const REJECTED_POSTGRES_ENVIRONMENT_KEYS = [
  'NODE_PG_FORCE_NATIVE',
  'PGBINARY',
  'PGCLIENT_ENCODING',
  'PGCLIENTENCODING',
  'PGHOSTADDR',
  'PGREPLICATION',
] as const

function assertNoEffectivePostgresEnvironmentOverrides(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const configured = REJECTED_POSTGRES_ENVIRONMENT_KEYS.filter(
    (key) => Boolean(environment[key]),
  )
  if (configured.length > 0) {
    throw new Error(
      `${configured.join(', ')} must be unset for a validated local PostgreSQL connection.`,
    )
  }
}

function mapResult<Row extends SqlRow>(
  result: QueryResult<Record<string, unknown>>,
): SqlResult<Row> {
  return {
    command: result.command,
    rowCount: result.rowCount ?? result.rows.length,
    rows: result.rows as readonly Row[],
  }
}

function beginStatement(options: SqlTransactionOptions): string {
  const modes: string[] = []
  if (options.isolationLevel) {
    modes.push(`ISOLATION LEVEL ${{
      ReadUncommitted: 'READ UNCOMMITTED',
      ReadCommitted: 'READ COMMITTED',
      RepeatableRead: 'REPEATABLE READ',
      Serializable: 'SERIALIZABLE',
    }[options.isolationLevel]}`)
  }
  if (options.readOnly !== undefined) {
    modes.push(options.readOnly ? 'READ ONLY' : 'READ WRITE')
  }
  if (options.deferrable !== undefined) {
    modes.push(options.deferrable ? 'DEFERRABLE' : 'NOT DEFERRABLE')
  }
  return modes.length === 0 ? 'BEGIN' : `BEGIN ${modes.join(', ')}`
}

async function execute<Row extends SqlRow>(
  client: Pool | PoolClient,
  statement: SqlStatement,
): Promise<SqlResult<Row>> {
  const result = await client.query<Record<string, unknown>>(
    statement.text,
    [...(statement.values ?? [])],
  )
  return mapResult<Row>(result)
}

/**
 * PostgreSQL wire-protocol adapter for loopback runtimes. Hosted Vercel
 * continues to use the Neon HTTP adapter.
 */
export function createPostgresSqlAdapter(
  connectionString: string,
  options: PostgresSqlAdapterOptions = {},
): PostgresSqlAdapter {
  if (connectionString.trim().length === 0) {
    throw new Error('A non-empty PostgreSQL connection string is required.')
  }
  const parsed = parseLoopbackPostgresUrl(
    connectionString,
    'PostgreSQL connection string',
  )
  assertNoEffectivePostgresEnvironmentOverrides()
  const applicationName = options.applicationName?.trim() ||
    'webchess-openclaw-v2'
  if (applicationName.length > 120 || /[\p{C}]/gu.test(applicationName)) {
    throw new Error('The PostgreSQL application name is invalid.')
  }
  const poolConfig: PoolConfig & { sslnegotiation: 'postgres' } = {
    application_name: applicationName,
    connectionTimeoutMillis: 5_000,
    database: decodeURIComponent(parsed.pathname.slice(1)),
    host: parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, ''),
    max: 8,
    options: '-c search_path=public',
    password: decodeURIComponent(parsed.password),
    port: Number(parsed.port),
    ssl: false,
    sslnegotiation: 'postgres',
    user: decodeURIComponent(parsed.username),
  }
  const PostgresPool = loadPostgresPool()
  const pool = new PostgresPool(poolConfig)

  return {
    query<Row extends SqlRow = SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<Row>> {
      return execute<Row>(pool, statement)
    },

    close(): Promise<void> {
      return pool.end()
    },

    async transaction(
      statements: readonly SqlStatement[],
      options: SqlTransactionOptions = {},
    ): Promise<readonly SqlResult[]> {
      if (statements.length === 0) return []

      const client = await pool.connect()
      try {
        await client.query(beginStatement(options))
        const results: SqlResult[] = []
        for (const statement of statements) {
          results.push(await execute(client, statement))
        }
        await client.query('COMMIT')
        return results
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
  }
}
