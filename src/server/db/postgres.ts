import 'server-only'

import { Pool } from 'pg'
import type { PoolClient, QueryResult } from 'pg'

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
 * PostgreSQL wire-protocol adapter used only by the loopback OpenClaw runtime.
 * Hosted WebChess continues to use the Neon HTTP adapter.
 */
export function createPostgresSqlAdapter(
  connectionString: string,
): PostgresSqlAdapter {
  if (connectionString.trim().length === 0) {
    throw new Error('A non-empty PostgreSQL connection string is required.')
  }
  const pool = new Pool({
    application_name: 'webchess-openclaw-v2',
    connectionTimeoutMillis: 5_000,
    connectionString,
    max: 8,
  })

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
