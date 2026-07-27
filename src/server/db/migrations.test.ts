// @vitest-environment node

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  MigrationDriftError,
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
  transactions = 0

  async query<Row extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<Row>> {
    if (statement.text.includes('SELECT id, checksum')) {
      return sqlResult(
        [...this.applied].map(([id, checksum]) => ({
          id,
          checksum,
        })) as unknown as Row[],
      )
    }

    return sqlResult([] as Row[], 'CREATE')
  }

  async transaction(
    statements: readonly SqlStatement[],
  ): Promise<readonly SqlResult[]> {
    this.transactions += 1
    const results: SqlResult[] = []

    for (const statement of statements) {
      if (
        statement.text.includes(
          'INSERT INTO webchess_schema_migrations (id, checksum)',
        )
      ) {
        const [id, checksum] = statement.values as [string, string]
        if (!this.applied.has(id)) {
          this.applied.set(id, checksum)
        }
        results.push(sqlResult([], 'INSERT'))
      } else if (
        statement.text.includes('FROM webchess_schema_migrations') &&
        statement.text.includes('WHERE id = $1')
      ) {
        const id = statement.values?.[0] as string
        const checksum = this.applied.get(id)
        results.push(
          sqlResult(checksum === undefined ? [] : [{ id, checksum }]),
        )
      } else {
        results.push(sqlResult([], 'DDL'))
      }
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
