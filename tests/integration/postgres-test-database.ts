import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'

import { Pool } from 'pg'
import type { PoolClient, QueryResult } from 'pg'

import { runMigrations } from '../../src/server/db/migrations'
import type {
  Migration,
  MigrationRunResult,
  SqlAdapter,
  SqlResult,
  SqlRow,
  SqlStatement,
  SqlTransactionOptions,
} from '../../src/server/db'

const migrationDirectoryUrl = new URL(
  '../../db/migrations/',
  import.meta.url,
)
const migrationFilenamePattern =
  /^(\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/

const SCHEMA_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/

async function loadCanonicalMigrations(): Promise<readonly Migration[]> {
  const entries = await readdir(migrationDirectoryUrl, {
    withFileTypes: true,
  })
  const filenames = entries.map((entry) => {
    if (!entry.isFile() || !migrationFilenamePattern.test(entry.name)) {
      throw new Error(
        'The canonical migration directory contains an unexpected entry.',
      )
    }
    return entry.name
  }).sort()
  if (filenames.length === 0) {
    throw new Error('No canonical database migrations were found.')
  }

  return Promise.all(
    filenames.map(async (filename) => ({
      id: migrationFilenamePattern.exec(filename)?.[1] ?? '',
      sql: await readFile(
        new URL(filename, migrationDirectoryUrl),
        'utf8',
      ),
    })),
  )
}

export const durableWebChessMigrations =
  await loadCanonicalMigrations()

function connectionString(): string {
  const value = process.env.DATABASE_URL?.trim()
  if (!value) {
    throw new Error(
      'DATABASE_URL must point to the disposable PostgreSQL 17 integration-test database.',
    )
  }
  return value
}

function schemaName(label: string): string {
  const prefix = label.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const suffix = randomUUID().replaceAll('-', '')
  const name = `webchess_${prefix}_${suffix}`.slice(0, 63)
  if (!SCHEMA_NAME_PATTERN.test(name)) {
    throw new Error(`Unsafe generated PostgreSQL schema name: ${name}`)
  }
  return name
}

function sqlResult<Row extends SqlRow>(
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
    const isolationLevel = {
      ReadUncommitted: 'READ UNCOMMITTED',
      ReadCommitted: 'READ COMMITTED',
      RepeatableRead: 'REPEATABLE READ',
      Serializable: 'SERIALIZABLE',
    }[options.isolationLevel]
    modes.push(`ISOLATION LEVEL ${isolationLevel}`)
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
  return sqlResult<Row>(result)
}

class PostgresTestAdapter implements SqlAdapter {
  constructor(private readonly pool: Pool) {}

  query<Row extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<Row>> {
    return execute<Row>(this.pool, statement)
  }

  async transaction(
    statements: readonly SqlStatement[],
    options: SqlTransactionOptions = {},
  ): Promise<readonly SqlResult[]> {
    if (statements.length === 0) {
      return []
    }

    const client = await this.pool.connect()
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
  }
}

export interface PostgresTestDatabase {
  readonly adapter: SqlAdapter
  readonly schema: string
  migrate(): Promise<MigrationRunResult>
  dispose(): Promise<void>
}

export async function createPostgresTestDatabase(
  label: string,
): Promise<PostgresTestDatabase> {
  const databaseUrl = connectionString()
  const schema = schemaName(label)
  const administrator = new Pool({
    connectionString: databaseUrl,
    max: 1,
  })
  await administrator.query(`CREATE SCHEMA "${schema}"`)

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 8,
    options: `-c search_path=${schema},public`,
  })
  const adapter = new PostgresTestAdapter(pool)

  return {
    adapter,
    schema,
    migrate: () =>
      runMigrations(adapter, durableWebChessMigrations),
    async dispose() {
      await pool.end()
      await administrator.query(`DROP SCHEMA "${schema}" CASCADE`)
      await administrator.end()
    },
  }
}
