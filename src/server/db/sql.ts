import 'server-only'

import { neon } from '@neondatabase/serverless'

export type SqlRow = Record<string, unknown>

export interface SqlStatement {
  readonly text: string
  readonly values?: readonly unknown[]
}

export interface SqlResult<Row extends SqlRow = SqlRow> {
  readonly command: string
  readonly rowCount: number
  readonly rows: readonly Row[]
}

export interface SqlTransactionOptions {
  readonly isolationLevel?:
    | 'ReadUncommitted'
    | 'ReadCommitted'
    | 'RepeatableRead'
    | 'Serializable'
  readonly readOnly?: boolean
  readonly deferrable?: boolean
}

/**
 * The narrow database surface used by repositories.
 *
 * Transactions are deliberately non-interactive so the production
 * implementation can use Neon's atomic HTTP transaction endpoint. Callers
 * should express compare-and-swap behavior in SQL rather than relying on a
 * process-local callback.
 */
export interface SqlAdapter {
  query<Row extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<Row>>
  transaction(
    statements: readonly SqlStatement[],
    options?: SqlTransactionOptions,
  ): Promise<readonly SqlResult[]>
}

function mapNeonResult<Row extends SqlRow>(result: {
  readonly command: string
  readonly rowCount: number
  readonly rows: readonly Row[]
}): SqlResult<Row> {
  return {
    command: result.command,
    rowCount: result.rowCount,
    rows: result.rows,
  }
}

export function createNeonSqlAdapter(connectionString: string): SqlAdapter {
  if (connectionString.trim().length === 0) {
    throw new Error('A non-empty database connection string is required.')
  }

  const sql = neon(connectionString, { fullResults: true })

  return {
    async query<Row extends SqlRow = SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<Row>> {
      const result = await sql.query<false, true>(
        statement.text,
        [...(statement.values ?? [])],
        { fullResults: true },
      )

      return mapNeonResult(result as {
        command: string
        rowCount: number
        rows: Row[]
      })
    },

    async transaction(
      statements: readonly SqlStatement[],
      options: SqlTransactionOptions = {},
    ): Promise<readonly SqlResult[]> {
      if (statements.length === 0) {
        return []
      }

      const results = await sql.transaction<false, true>(
        (transactionSql) =>
          statements.map((statement) =>
            transactionSql.query(
              statement.text,
              [...(statement.values ?? [])],
            ),
          ),
        {
          ...options,
          fullResults: true,
        },
      )

      return results.map((result) =>
        mapNeonResult(result as {
          command: string
          rowCount: number
          rows: SqlRow[]
        }),
      )
    },
  }
}

let cachedDatabase: SqlAdapter | undefined

/**
 * Lazily creates the production database adapter.
 *
 * Reading this module, running tests, and building the application are all
 * safe without DATABASE_URL. Configuration is required only when a request
 * actually needs the database.
 */
export function getDatabase(): SqlAdapter {
  if (cachedDatabase) {
    return cachedDatabase
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not configured. Provision Neon for this environment before using durable WebChess routes.',
    )
  }

  cachedDatabase = createNeonSqlAdapter(connectionString)
  return cachedDatabase
}
