import { randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// @ts-expect-error The operator CLI is intentionally plain ESM, not app code.
import * as deploymentDatabase from '../../scripts/deployment-database.mjs'

const {
  applyCanonicalMigrations,
  checkCanonicalMigrationsReadOnly,
  loadCanonicalMigrations,
} = deploymentDatabase

const schema = `webchess_deployment_migrations_${randomUUID()
  .replaceAll('-', '')
  .slice(0, 24)}`
const compatibilitySchema = `webchess_runtime_contract_${randomUUID()
  .replaceAll('-', '')
  .slice(0, 24)}`
const runtimeRole = `webchess_runtime_${randomUUID()
  .replaceAll('-', '')
  .slice(0, 24)}`
const runtimePassword = randomUUID()

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim()
  if (!value) {
    throw new Error(
      'DATABASE_URL must point to the disposable PostgreSQL 17 integration-test database.',
    )
  }
  return value
}

function schemaClient(): Client {
  return new Client({
    connectionString: databaseUrl(),
    options: `-c search_path=${schema},public`,
  })
}

function compatibilityOwnerClient(): Client {
  return new Client({
    connectionString: databaseUrl(),
    options: `-c search_path=${compatibilitySchema},public`,
  })
}

function runtimeClient(): Client {
  const connectionString = new URL(databaseUrl())
  connectionString.username = runtimeRole
  connectionString.password = runtimePassword
  return new Client({
    connectionString: connectionString.toString(),
    options: `-c search_path=${compatibilitySchema},public`,
  })
}

const migrations = [
  {
    id: '0001_concurrency_probe',
    sql: `
      CREATE TABLE deployment_migration_probe (
        id integer PRIMARY KEY
      );
    `,
  },
]

interface MigrationRunResult {
  readonly applied: readonly string[]
  readonly alreadyApplied: readonly string[]
}

let administrator: Client

beforeAll(async () => {
  administrator = new Client({ connectionString: databaseUrl() })
  await administrator.connect()
  await administrator.query(`CREATE SCHEMA "${schema}"`)
  await administrator.query(
    `CREATE SCHEMA "${compatibilitySchema}"`,
  )
  await administrator.query(
    `CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${runtimePassword}'`,
  )
})

afterAll(async () => {
  await administrator.query(`DROP SCHEMA "${schema}" CASCADE`)
  await administrator.query(
    `DROP SCHEMA "${compatibilitySchema}" CASCADE`,
  )
  await administrator.query(`DROP ROLE "${runtimeRole}"`)
  await administrator.end()
})

describe('deployment migration owner on PostgreSQL 17', () => {
  it('serializes concurrent owners and records one canonical application', async () => {
    const first = schemaClient()
    const second = schemaClient()
    await Promise.all([first.connect(), second.connect()])

    try {
      const results = await Promise.all([
        applyCanonicalMigrations(first, migrations),
        applyCanonicalMigrations(second, migrations),
      ]) as MigrationRunResult[]

      expect(
        results.map((result) => result.applied.length).sort(),
      ).toEqual([0, 1])
      expect(
        results.map((result) => result.alreadyApplied.length).sort(),
      ).toEqual([0, 1])

      const ledger = await first.query(
        `
          SELECT id
          FROM webchess_schema_migrations
          ORDER BY id
        `,
      )
      expect(ledger.rows).toEqual([
        { id: '0001_concurrency_probe' },
      ])
    } finally {
      await Promise.all([first.end(), second.end()])
    }
  })

  it('enforces the exact PG17 schema and least-privilege runtime role', async () => {
    const owner = compatibilityOwnerClient()
    await owner.connect()
    const canonicalMigrations = await loadCanonicalMigrations()

    try {
      await applyCanonicalMigrations(owner, canonicalMigrations)

      await administrator.query(
        `GRANT USAGE ON SCHEMA "${compatibilitySchema}" TO "${runtimeRole}"`,
      )
      await administrator.query(
        `REVOKE CREATE ON SCHEMA "${compatibilitySchema}" FROM "${runtimeRole}"`,
      )
      await administrator.query(
        `REVOKE CREATE ON SCHEMA public FROM "${runtimeRole}"`,
      )
      await administrator.query(
        `GRANT SELECT ON TABLE "${compatibilitySchema}".webchess_schema_migrations TO "${runtimeRole}"`,
      )
      await administrator.query(
        `GRANT SELECT, INSERT, UPDATE ON TABLE "${compatibilitySchema}".deleted_user_tombstones TO "${runtimeRole}"`,
      )
      await administrator.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
          "${compatibilitySchema}".user_controls,
          "${compatibilitySchema}".games,
          "${compatibilitySchema}".model_requests,
          "${compatibilitySchema}".game_start_requests,
          "${compatibilitySchema}".usage_buckets,
          "${compatibilitySchema}".rate_buckets
        TO "${runtimeRole}"`,
      )
      await administrator.query(
        `GRANT SELECT, INSERT ON TABLE "${compatibilitySchema}".game_events TO "${runtimeRole}"`,
      )
      await administrator.query(
        `GRANT SELECT, UPDATE ON TABLE "${compatibilitySchema}".model_concurrency_slots TO "${runtimeRole}"`,
      )

      const runtime = runtimeClient()
      await runtime.connect()
      try {
        await expect(
          checkCanonicalMigrationsReadOnly(
            runtime,
            canonicalMigrations,
          ),
        ).resolves.toBeUndefined()

        await administrator.query(
          `REVOKE UPDATE ON TABLE "${compatibilitySchema}".deleted_user_tombstones FROM "${runtimeRole}"`,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(
            runtime,
            canonicalMigrations,
          ),
        ).rejects.toThrow('least-privilege contract')
        await administrator.query(
          `GRANT UPDATE ON TABLE "${compatibilitySchema}".deleted_user_tombstones TO "${runtimeRole}"`,
        )

        await administrator.query(
          `GRANT CREATE ON SCHEMA "${compatibilitySchema}" TO "${runtimeRole}"`,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(
            runtime,
            canonicalMigrations,
          ),
        ).rejects.toThrow(
          'must not have CREATE on the WebChess application schema',
        )
        await administrator.query(
          `REVOKE CREATE ON SCHEMA "${compatibilitySchema}" FROM "${runtimeRole}"`,
        )

        await owner.query(
          'ALTER TABLE games ADD COLUMN unexpected_contract_column text',
        )
        await expect(
          checkCanonicalMigrationsReadOnly(
            runtime,
            canonicalMigrations,
          ),
        ).rejects.toThrow('column contract')
        await owner.query(
          'ALTER TABLE games DROP COLUMN unexpected_contract_column',
        )

        await owner.query(
          'DROP INDEX games_one_current_per_user',
        )
        await expect(
          checkCanonicalMigrationsReadOnly(
            runtime,
            canonicalMigrations,
          ),
        ).rejects.toThrow('critical index contract')
        await owner.query(`
          CREATE UNIQUE INDEX games_one_current_per_user
            ON games (clerk_user_id)
            WHERE is_current
        `)

        await owner.query(
          `ALTER TABLE games OWNER TO "${runtimeRole}"`,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(
            runtime,
            canonicalMigrations,
          ),
        ).rejects.toThrow('assume ownership')
      } finally {
        await runtime.end()
      }
    } finally {
      await owner.end()
    }
  })
})
