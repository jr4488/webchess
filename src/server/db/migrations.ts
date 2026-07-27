import { z } from 'zod'

import { sha256Hex } from './hash'
import {
  parseResultRows,
  parseSingleResultRow,
} from './rows'
import type { SqlAdapter, SqlStatement } from './sql'

const MIGRATION_ID_PATTERN = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/
const MIGRATION_LOCK_KEY = '8120371142281'

const appliedMigrationRowSchema = z.object({
  id: z.string().regex(MIGRATION_ID_PATTERN),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
})

export interface Migration {
  readonly id: string
  /**
   * Migrations must be safe to retry. The runner records and checks an exact
   * checksum, but Neon HTTP transactions are non-interactive, so a concurrent
   * runner can only safely replay idempotent DDL after waiting for the advisory
   * transaction lock.
   */
  readonly sql: string
}

export interface MigrationRunResult {
  readonly applied: readonly string[]
  readonly alreadyApplied: readonly string[]
}

export class MigrationDriftError extends Error {
  constructor(
    readonly migrationId: string,
    readonly expectedChecksum: string,
    readonly actualChecksum: string,
  ) {
    super(
      `Migration ${migrationId} has checksum ${actualChecksum}, but the database records ${expectedChecksum}.`,
    )
    this.name = 'MigrationDriftError'
  }
}

export function migrationChecksum(sql: string): string {
  const normalized = `${sql.replace(/\r\n?/g, '\n').trim()}\n`
  return sha256Hex(normalized)
}

function dollarQuoteAt(sql: string, offset: number): string | undefined {
  const match = sql.slice(offset).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)
  return match?.[0]
}

/**
 * Splits a trusted migration script into statements without breaking quoted
 * strings, identifiers, comments, or PostgreSQL dollar-quoted bodies.
 */
export function splitSqlStatements(sql: string): readonly string[] {
  const statements: string[] = []
  let current = ''
  let singleQuoted = false
  let doubleQuoted = false
  let lineComment = false
  let blockCommentDepth = 0
  let dollarQuote: string | undefined

  const finishStatement = () => {
    const statement = current.trim()
    if (statement.length > 0) {
      statements.push(statement)
    }
    current = ''
  }

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]
    const next = sql[index + 1]

    if (lineComment) {
      current += character
      if (character === '\n') {
        lineComment = false
      }
      continue
    }

    if (blockCommentDepth > 0) {
      current += character
      if (character === '/' && next === '*') {
        current += next
        blockCommentDepth += 1
        index += 1
      } else if (character === '*' && next === '/') {
        current += next
        blockCommentDepth -= 1
        index += 1
      }
      continue
    }

    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        current += dollarQuote
        index += dollarQuote.length - 1
        dollarQuote = undefined
      } else {
        current += character
      }
      continue
    }

    if (singleQuoted) {
      current += character
      if (character === "'" && next === "'") {
        current += next
        index += 1
      } else if (character === '\\' && next !== undefined) {
        current += next
        index += 1
      } else if (character === "'") {
        singleQuoted = false
      }
      continue
    }

    if (doubleQuoted) {
      current += character
      if (character === '"' && next === '"') {
        current += next
        index += 1
      } else if (character === '"') {
        doubleQuoted = false
      }
      continue
    }

    if (character === '-' && next === '-') {
      current += character + next
      lineComment = true
      index += 1
      continue
    }

    if (character === '/' && next === '*') {
      current += character + next
      blockCommentDepth = 1
      index += 1
      continue
    }

    if (character === "'") {
      current += character
      singleQuoted = true
      continue
    }

    if (character === '"') {
      current += character
      doubleQuoted = true
      continue
    }

    if (character === '$') {
      const tag = dollarQuoteAt(sql, index)
      if (tag) {
        current += tag
        dollarQuote = tag
        index += tag.length - 1
        continue
      }
    }

    if (character === ';') {
      finishStatement()
      continue
    }

    current += character
  }

  if (
    singleQuoted ||
    doubleQuoted ||
    blockCommentDepth > 0 ||
    dollarQuote !== undefined
  ) {
    throw new SyntaxError('Migration SQL contains an unterminated quoted value or comment.')
  }

  finishStatement()
  return statements
}

function validateMigrations(migrations: readonly Migration[]): void {
  let previousId: string | undefined
  const seen = new Set<string>()

  for (const migration of migrations) {
    if (!MIGRATION_ID_PATTERN.test(migration.id)) {
      throw new TypeError(
        `Invalid migration id ${JSON.stringify(migration.id)}. Expected NNNN_lowercase_name.`,
      )
    }

    if (seen.has(migration.id)) {
      throw new TypeError(`Duplicate migration id ${migration.id}.`)
    }

    if (previousId !== undefined && migration.id <= previousId) {
      throw new TypeError('Migrations must be provided in strictly increasing id order.')
    }

    if (splitSqlStatements(migration.sql).length === 0) {
      throw new TypeError(`Migration ${migration.id} has no SQL statements.`)
    }

    previousId = migration.id
    seen.add(migration.id)
  }
}

const createMigrationsTableStatement: SqlStatement = {
  text: `
    CREATE TABLE IF NOT EXISTS webchess_schema_migrations (
      id text PRIMARY KEY
        CHECK (id ~ '^[0-9]{4}_[a-z0-9]+(?:_[a-z0-9]+)*$'),
      checksum char(64) NOT NULL
        CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `,
}

/**
 * @internal Test-only helper for provisioning blank, disposable database
 * schemas. It does not validate or adopt a pre-existing schema that lacks the
 * migration ledger, so production and deployment code must not call it.
 */
export async function runMigrations(
  database: SqlAdapter,
  migrations: readonly Migration[],
): Promise<MigrationRunResult> {
  validateMigrations(migrations)
  await database.query(createMigrationsTableStatement)

  const appliedResult = await database.query({
    text: `
      SELECT id, checksum
      FROM webchess_schema_migrations
      ORDER BY id
    `,
  })
  const databaseMigrations = parseResultRows(
    appliedResult,
    appliedMigrationRowSchema,
  )
  const checksumById = new Map(
    databaseMigrations.map((migration) => [
      migration.id,
      migration.checksum,
    ]),
  )

  const applied: string[] = []
  const alreadyApplied: string[] = []

  for (const migration of migrations) {
    const checksum = migrationChecksum(migration.sql)
    const existingChecksum = checksumById.get(migration.id)

    if (existingChecksum !== undefined) {
      if (existingChecksum !== checksum) {
        throw new MigrationDriftError(
          migration.id,
          existingChecksum,
          checksum,
        )
      }

      alreadyApplied.push(migration.id)
      continue
    }

    const migrationStatements: SqlStatement[] = splitSqlStatements(
      migration.sql,
    ).map((text) => ({ text }))

    const results = await database.transaction(
      [
        {
          text: 'SELECT pg_advisory_xact_lock($1::bigint)',
          values: [MIGRATION_LOCK_KEY],
        },
        ...migrationStatements,
        {
          text: `
            INSERT INTO webchess_schema_migrations (id, checksum)
            VALUES ($1, $2)
            ON CONFLICT (id) DO NOTHING
          `,
          values: [migration.id, checksum],
        },
        {
          text: `
            SELECT id, checksum
            FROM webchess_schema_migrations
            WHERE id = $1
          `,
          values: [migration.id],
        },
      ],
      { isolationLevel: 'Serializable' },
    )

    const verification = parseSingleResultRow(
      results[results.length - 1],
      appliedMigrationRowSchema,
    )
    if (verification.checksum !== checksum) {
      throw new MigrationDriftError(
        migration.id,
        verification.checksum,
        checksum,
      )
    }

    checksumById.set(migration.id, checksum)
    applied.push(migration.id)
  }

  return { applied, alreadyApplied }
}
