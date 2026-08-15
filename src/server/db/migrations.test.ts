// @vitest-environment node

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  MigrationDriftError,
  MigrationHistoryError,
  migrationChecksum,
  runMigrations,
  splitSqlStatements,
} from './migrations'
import type {
  SqlAdapter,
  SqlResult,
  SqlRow,
  SqlStatement,
} from './sql'

function sqlResult<Row extends SqlRow>(
  rows: readonly Row[],
  command = 'SELECT',
): SqlResult<Row> {
  return { command, rowCount: rows.length, rows }
}

class MemoryMigrationAdapter implements SqlAdapter {
  readonly applied = new Map<string, string>()
  readonly transactionStatements: SqlStatement[][] = []
  readonly transactionOptions: unknown[] = []
  beforeMigrationInsert:
    | ((id: string, checksum: string) => void)
    | undefined
  beforeTransaction: (() => void) | undefined
  ddlStatements: string[] = []
  ledgerRowsOverride:
    | readonly { readonly id: string; readonly checksum: string }[]
    | undefined
  transactions = 0

  async query<Row extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<Row>> {
    if (statement.text.includes('SELECT id, checksum')) {
      return sqlResult(
        (this.ledgerRowsOverride ?? [...this.applied]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, checksum]) => ({
            id,
            checksum,
          }))) as unknown as Row[],
      )
    }

    return sqlResult([] as Row[], 'CREATE')
  }

  async transaction(
    statements: readonly SqlStatement[],
    options?: unknown,
  ): Promise<readonly SqlResult[]> {
    this.transactions += 1
    this.beforeTransaction?.()
    this.transactionStatements.push([...statements])
    this.transactionOptions.push(options)
    const appliedBeforeTransaction = new Map(this.applied)
    const ddlCountBeforeTransaction = this.ddlStatements.length
    const results: SqlResult[] = []

    try {
      for (const statement of statements) {
        if (statement.text.includes('webchess_migration_ledger_guard')) {
          const actualLedger = JSON.stringify(
            [...this.applied]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([id, checksum]) => [id, checksum]),
          )
          if (actualLedger !== statement.values?.[0]) {
            throw new Error('The migration ledger changed under the lock.')
          }
          results.push(sqlResult([{ ledger_matches: 1 }]))
        } else if (
          statement.text.includes(
            'INSERT INTO webchess_schema_migrations (id, checksum)',
          )
        ) {
          const [id, checksum] = statement.values as [string, string]
          this.beforeMigrationInsert?.(id, checksum)
          if (this.applied.has(id)) {
            throw new Error(`duplicate migration id ${id}`)
          }
          this.applied.set(id, checksum)
          results.push(sqlResult([], 'INSERT'))
        } else if (
          statement.text.includes('pg_advisory_xact_lock') ||
          statement.text.includes('LOCK TABLE webchess_schema_migrations')
        ) {
          results.push(sqlResult([], 'LOCK'))
        } else {
          this.ddlStatements.push(statement.text)
          results.push(sqlResult([], 'DDL'))
        }
      }
    } catch (error) {
      this.applied.clear()
      for (const [id, checksum] of appliedBeforeTransaction) {
        this.applied.set(id, checksum)
      }
      this.ddlStatements.length = ddlCountBeforeTransaction
      throw error
    }

    return results
  }
}

describe('SQL migration runner', () => {
  it('splits statements without breaking PostgreSQL quoted content', () => {
    const statements = splitSqlStatements(`
      -- a comment with ;
      SELECT 'literal;value';
      SELECT "identifier;value";
      DO $body$
      BEGIN
        PERFORM 'body;value';
      END
      $body$;
      /* nested ; /* still nested ; */ complete */
      SELECT 4;
    `)

    expect(statements).toHaveLength(4)
    expect(statements[2]).toContain("PERFORM 'body;value'")
    expect(statements[3]).toContain('SELECT 4')
  })

  it('rejects incomplete SQL quoting', () => {
    expect(() => splitSqlStatements("SELECT 'unfinished")).toThrow(
      /unterminated/,
    )
    expect(() => splitSqlStatements('SELECT /* unfinished')).toThrow(
      /unterminated/,
    )
  })

  it('applies each pending migration once and verifies its checksum', async () => {
    const database = new MemoryMigrationAdapter()
    const migration = {
      id: '0001_example',
      sql: 'CREATE TABLE IF NOT EXISTS example (id integer PRIMARY KEY);',
    }

    await expect(runMigrations(database, [migration])).resolves.toEqual({
      applied: ['0001_example'],
      alreadyApplied: [],
    })
    await expect(runMigrations(database, [migration])).resolves.toEqual({
      applied: [],
      alreadyApplied: ['0001_example'],
    })
    expect(database.transactions).toBe(2)
    expect(database.transactionOptions).toEqual([
      { isolationLevel: 'ReadCommitted' },
      { isolationLevel: 'ReadCommitted' },
    ])
    const transactionStatements = database.transactionStatements[0]
    expect(transactionStatements[0].text).toContain(
      'pg_advisory_xact_lock',
    )
    expect(transactionStatements[1].text).toContain(
      'LOCK TABLE webchess_schema_migrations',
    )
    expect(transactionStatements[2].text).toContain(
      'webchess_migration_ledger_guard',
    )
    const insert = transactionStatements.find((statement) =>
      statement.text.includes(
        'INSERT INTO webchess_schema_migrations (id, checksum)',
      ),
    )
    expect(insert?.text).not.toContain('ON CONFLICT')
  })

  it('applies only the pending tail after validating an exact ledger prefix', async () => {
    const database = new MemoryMigrationAdapter()
    database.applied.set('0001_first', migrationChecksum('SELECT 1;'))

    await expect(
      runMigrations(database, [
        { id: '0001_first', sql: 'SELECT 1;' },
        { id: '0002_second', sql: 'SELECT 2;' },
      ]),
    ).resolves.toEqual({
      applied: ['0002_second'],
      alreadyApplied: ['0001_first'],
    })
    expect(database.transactions).toBe(1)
  })

  it('stops when an applied migration was edited', async () => {
    const database = new MemoryMigrationAdapter()
    await runMigrations(database, [
      { id: '0001_example', sql: 'SELECT 1;' },
    ])

    await expect(
      runMigrations(database, [
        { id: '0001_example', sql: 'SELECT 2;' },
      ]),
    ).rejects.toBeInstanceOf(MigrationDriftError)
    expect(database.transactions).toBe(1)
  })

  it('rejects ledger entries that are absent from the migration source before applying', async () => {
    const database = new MemoryMigrationAdapter()
    database.applied.set('0009_unknown', migrationChecksum('SELECT 9;'))

    await expect(
      runMigrations(database, [
        { id: '0001_example', sql: 'SELECT 1;' },
      ]),
    ).rejects.toMatchObject({
      name: 'MigrationHistoryError',
      migrationId: '0009_unknown',
    })
    expect(database.transactions).toBe(0)
  })

  it('rejects a holed migration ledger before applying the missing migration', async () => {
    const database = new MemoryMigrationAdapter()
    database.applied.set('0001_first', migrationChecksum('SELECT 1;'))
    database.applied.set('0003_third', migrationChecksum('SELECT 3;'))

    await expect(
      runMigrations(database, [
        { id: '0001_first', sql: 'SELECT 1;' },
        { id: '0002_second', sql: 'SELECT 2;' },
        { id: '0003_third', sql: 'SELECT 3;' },
      ]),
    ).rejects.toMatchObject({
      name: 'MigrationHistoryError',
      migrationId: '0003_third',
    })
    expect(database.transactions).toBe(0)
  })

  it.each([
    {
      name: 'duplicate',
      rows: [
        { id: '0001_first', checksum: migrationChecksum('SELECT 1;') },
        { id: '0001_first', checksum: migrationChecksum('SELECT 1;') },
      ],
    },
    {
      name: 'unordered',
      rows: [
        { id: '0002_second', checksum: migrationChecksum('SELECT 2;') },
        { id: '0001_first', checksum: migrationChecksum('SELECT 1;') },
      ],
    },
  ])('rejects a $name ledger before applying migrations', async ({ rows }) => {
    const database = new MemoryMigrationAdapter()
    database.ledgerRowsOverride = rows

    await expect(
      runMigrations(database, [
        { id: '0001_first', sql: 'SELECT 1;' },
        { id: '0002_second', sql: 'SELECT 2;' },
      ]),
    ).rejects.toBeInstanceOf(MigrationHistoryError)
    expect(database.transactions).toBe(0)
  })

  it('validates every applied checksum before applying a pending tail', async () => {
    const database = new MemoryMigrationAdapter()
    database.applied.set('0001_first', migrationChecksum('SELECT 1;'))
    database.applied.set('0002_second', migrationChecksum('SELECT 999;'))

    await expect(
      runMigrations(database, [
        { id: '0001_first', sql: 'SELECT 1;' },
        { id: '0002_second', sql: 'SELECT 2;' },
        { id: '0003_third', sql: 'SELECT 3;' },
      ]),
    ).rejects.toMatchObject({
      name: 'MigrationDriftError',
      migrationId: '0002_second',
    })
    expect(database.transactions).toBe(0)
  })

  it('revalidates the complete ledger under the lock before running DDL', async () => {
    const database = new MemoryMigrationAdapter()
    database.beforeTransaction = () => {
      database.applied.set(
        '0001_example',
        migrationChecksum('SELECT 1;'),
      )
    }

    await expect(
      runMigrations(database, [
        { id: '0001_example', sql: 'CREATE TABLE example (id integer);' },
      ]),
    ).rejects.toThrow(/ledger changed under the lock/u)
    expect(database.ddlStatements).toEqual([])
    expect(database.applied).toEqual(
      new Map([
        ['0001_example', migrationChecksum('SELECT 1;')],
      ]),
    )
  })

  it('revalidates under the lock even when no migration appeared pending', async () => {
    const database = new MemoryMigrationAdapter()
    database.applied.set(
      '0001_example',
      migrationChecksum('SELECT 1;'),
    )
    database.beforeTransaction = () => {
      database.applied.set(
        '0002_newer',
        migrationChecksum('SELECT 2;'),
      )
    }

    await expect(
      runMigrations(database, [
        { id: '0001_example', sql: 'SELECT 1;' },
      ]),
    ).rejects.toThrow(/ledger changed under the lock/u)
    expect(database.ddlStatements).toEqual([])
    expect(database.applied).toEqual(
      new Map([
        ['0001_example', migrationChecksum('SELECT 1;')],
        ['0002_newer', migrationChecksum('SELECT 2;')],
      ]),
    )
  })

  it('rolls back migration DDL when the plain ledger insert conflicts', async () => {
    const database = new MemoryMigrationAdapter()
    database.beforeMigrationInsert = (id) => {
      database.applied.set(id, '0'.repeat(64))
    }

    await expect(
      runMigrations(database, [
        { id: '0001_example', sql: 'CREATE TABLE example (id integer);' },
      ]),
    ).rejects.toThrow(/duplicate migration id/u)
    expect(database.applied).toEqual(new Map())
    expect(database.ddlStatements).toEqual([])
  })

  it.each([
    '-- wrapper\nBEGIN; SELECT 1; COMMIT;',
    'CREATE INDEX CONCURRENTLY bad_index ON bad_table (id);',
    'REINDEX INDEX CONCURRENTLY bad_index;',
    'VACUUM bad_table;',
    'CREATE DATABASE bad_database;',
    'DROP DATABASE bad_database;',
    'CREATE TABLESPACE bad_space LOCATION \'/tmp/bad\';',
    'DROP TABLESPACE bad_space;',
    "ALTER SYSTEM SET work_mem = '1GB';",
  ])('rejects transaction-unsafe migration SQL: %s', async (sql) => {
    const database = new MemoryMigrationAdapter()

    await expect(
      runMigrations(database, [{ id: '0001_unsafe', sql }]),
    ).rejects.toThrow(/transaction control or nontransactional DDL/u)
    expect(database.transactions).toBe(0)
  })

  it('allows transaction-safe procedural bodies', async () => {
    const database = new MemoryMigrationAdapter()

    await expect(
      runMigrations(database, [
        {
          id: '0001_procedure',
          sql: `
            DO $body$
            BEGIN
              PERFORM 'safe;body';
            END
            $body$;
          `,
        },
      ]),
    ).resolves.toEqual({
      applied: ['0001_procedure'],
      alreadyApplied: [],
    })
  })

  it('keeps the checked-in durable schema complete and statement-safe', () => {
    const sql = readFileSync(
      new URL('../../../db/migrations/0001_durable_webchess.sql', import.meta.url),
      'utf8',
    )
    const statements = splitSqlStatements(sql)

    for (const table of [
      'user_controls',
      'games',
      'game_events',
      'model_requests',
      'usage_buckets',
      'rate_buckets',
      'model_concurrency_slots',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }

    expect(sql).toContain('cast_version text NOT NULL')
    expect(sql).toContain('event_version smallint NOT NULL')
    expect(sql).toContain('captured_piece_id text')
    expect(sql).toContain("promoted_to IS NULL OR promoted_to = 'queen'")
    expect(sql).toContain('result_payload jsonb')
    expect(sql).toContain('model_requests_result_payload_matches_status')
    expect(sql).toContain('cache_write_input_tokens bigint')
    expect(sql).toContain('usage_reported boolean NOT NULL DEFAULT false')
    expect(sql).toContain('model_requests_usage_fields_match_reported')
    expect(sql).toContain('AND from_ring IS NOT NULL')
    expect(sql).toContain('AND from_sector IS NOT NULL')
    expect(sql).toContain('AND to_ring IS NOT NULL')
    expect(sql).toContain('AND to_sector IS NOT NULL')
    expect(sql).toContain('AND request_sha256 IS NOT NULL')
    expect(sql).not.toMatch(/\bip_address\b|\braw_ip\b/)
    expect(statements.length).toBeGreaterThan(10)
  })
})
