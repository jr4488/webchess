import { z } from 'zod'

import { sha256Hex } from './hash'
import { parseResultRows } from './rows'
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
   * Migrations must be fully transactional. The runner rejects explicit
   * transaction control and PostgreSQL commands that cannot run in its atomic
   * transaction, then records and checks an exact checksum.
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

export class MigrationHistoryError extends Error {
  constructor(
    message: string,
    readonly migrationId?: string,
  ) {
    super(message)
    this.name = 'MigrationHistoryError'
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

function withoutLeadingComments(statement: string): string {
  let remaining = statement.trimStart()
  while (remaining.startsWith('--') || remaining.startsWith('/*')) {
    if (remaining.startsWith('--')) {
      const lineEnd = remaining.indexOf('\n')
      remaining =
        lineEnd === -1
          ? ''
          : remaining.slice(lineEnd + 1).trimStart()
      continue
    }

    let depth = 0
    let index = 0
    for (; index < remaining.length - 1; index += 1) {
      const pair = remaining.slice(index, index + 2)
      if (pair === '/*') {
        depth += 1
        index += 1
      } else if (pair === '*/') {
        depth -= 1
        index += 1
        if (depth === 0) break
      }
    }
    remaining = remaining.slice(index + 1).trimStart()
  }
  return remaining
}

const FORBIDDEN_TRANSACTION_STATEMENT =
  /^(?:BEGIN|START\s+TRANSACTION|COMMIT|END(?:\s+(?:WORK|TRANSACTION))?|ROLLBACK|ABORT|SAVEPOINT|RELEASE\s+SAVEPOINT|PREPARE\s+TRANSACTION|SET\s+TRANSACTION)\b/i
const FORBIDDEN_NONTRANSACTIONAL_DDL =
  /^(?:(?:CREATE|DROP)\s+(?:(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY|DATABASE\b|TABLESPACE\b)|ALTER\s+SYSTEM\b|REINDEX\b[\s\S]*\bCONCURRENTLY\b|VACUUM\b)/i

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

    const statements = splitSqlStatements(migration.sql)
    if (statements.length === 0) {
      throw new TypeError(`Migration ${migration.id} has no SQL statements.`)
    }
    for (const statement of statements) {
      const significantStatement = withoutLeadingComments(statement)
      if (
        FORBIDDEN_TRANSACTION_STATEMENT.test(significantStatement) ||
        FORBIDDEN_NONTRANSACTIONAL_DDL.test(significantStatement)
      ) {
        throw new TypeError(
          `Migration ${migration.id} contains transaction control or nontransactional DDL.`,
        )
      }
    }

    previousId = migration.id
    seen.add(migration.id)
  }
}

function validateMigrationHistory(
  migrations: readonly Migration[],
  databaseMigrations: readonly z.infer<typeof appliedMigrationRowSchema>[],
): void {
  let previousId: string | undefined
  for (const databaseMigration of databaseMigrations) {
    if (
      previousId !== undefined &&
      databaseMigration.id <= previousId
    ) {
      throw new MigrationHistoryError(
        'The database migration ledger is not strictly ordered and unique.',
        databaseMigration.id,
      )
    }
    previousId = databaseMigration.id
  }

  const sourceById = new Map(
    migrations.map((migration) => [migration.id, migration]),
  )
  for (const databaseMigration of databaseMigrations) {
    const sourceMigration = sourceById.get(databaseMigration.id)
    if (!sourceMigration) {
      throw new MigrationHistoryError(
        `Database migration ${databaseMigration.id} is not present in the canonical migration source.`,
        databaseMigration.id,
      )
    }

    const sourceChecksum = migrationChecksum(sourceMigration.sql)
    if (databaseMigration.checksum !== sourceChecksum) {
      throw new MigrationDriftError(
        databaseMigration.id,
        databaseMigration.checksum,
        sourceChecksum,
      )
    }
  }

  for (let index = 0; index < databaseMigrations.length; index += 1) {
    if (databaseMigrations[index].id !== migrations[index]?.id) {
      throw new MigrationHistoryError(
        'The database migration ledger is not an exact prefix of the canonical migration source.',
        databaseMigrations[index].id,
      )
    }
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

function migrationLedgerGuardStatement(
  expectedMigrations: readonly z.infer<typeof appliedMigrationRowSchema>[],
): SqlStatement {
  return {
    text: `
      /* webchess_migration_ledger_guard */
      WITH current_ledger AS (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_array(id, checksum::text)
            ORDER BY id
          ),
          '[]'::jsonb
        ) AS entries
        FROM webchess_schema_migrations
      )
      SELECT 1 / CASE
        WHEN entries = $1::jsonb THEN 1
        ELSE 0
      END AS ledger_matches
      FROM current_ledger
    `,
    values: [
      JSON.stringify(
        expectedMigrations.map(({ id, checksum }) => [id, checksum]),
      ),
    ],
  }
}

/**
 * Applies canonical migrations to a dedicated local PostgreSQL schema.
 * Existing ledger rows must be an exact, checksum-matching prefix of the
 * supplied source before any pending migration is applied. Callers remain
 * responsible for rejecting pre-existing WebChess schemas that lack a ledger;
 * hosted deployment uses its separate owner-only migration command.
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
  validateMigrationHistory(migrations, databaseMigrations)
  const pendingMigrations = migrations.slice(databaseMigrations.length)
  const finalLedger = migrations.map((migration) => ({
    id: migration.id,
    checksum: migrationChecksum(migration.sql),
  }))
  const transactionStatements: SqlStatement[] = [
    {
      text: 'SELECT pg_advisory_xact_lock($1::bigint)',
      values: [MIGRATION_LOCK_KEY],
    },
    {
      text: `
        LOCK TABLE webchess_schema_migrations
        IN SHARE ROW EXCLUSIVE MODE
      `,
    },
    migrationLedgerGuardStatement(databaseMigrations),
  ]

  for (const migration of pendingMigrations) {
    transactionStatements.push(
      ...splitSqlStatements(migration.sql).map((text) => ({ text })),
      {
        text: `
          INSERT INTO webchess_schema_migrations (id, checksum)
          VALUES ($1, $2)
        `,
        values: [migration.id, migrationChecksum(migration.sql)],
      },
    )
  }
  if (pendingMigrations.length > 0) {
    transactionStatements.push(migrationLedgerGuardStatement(finalLedger))
  }

  await database.transaction(transactionStatements, {
    isolationLevel: 'ReadCommitted',
  })

  return {
    applied: pendingMigrations.map(({ id }) => id),
    alreadyApplied: databaseMigrations.map(({ id }) => id),
  }
}
