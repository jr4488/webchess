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
  await administrator.query(`CREATE SCHEMA "${compatibilitySchema}"`)
  await administrator.query(
    `CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${runtimePassword}'`,
  )
})

afterAll(async () => {
  await administrator.query(`DROP SCHEMA "${schema}" CASCADE`)
  await administrator.query(`DROP SCHEMA "${compatibilitySchema}" CASCADE`)
  await administrator.query(`DROP ROLE "${runtimeRole}"`)
  await administrator.end()
})

describe('deployment migration owner on PostgreSQL 17', () => {
  it('serializes concurrent owners and records one canonical application', async () => {
    const first = schemaClient()
    const second = schemaClient()
    await Promise.all([first.connect(), second.connect()])

    try {
      const results = (await Promise.all([
        applyCanonicalMigrations(first, migrations),
        applyCanonicalMigrations(second, migrations),
      ])) as MigrationRunResult[]

      expect(results.map((result) => result.applied.length).sort()).toEqual([
        0, 1,
      ])
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
      expect(ledger.rows).toEqual([{ id: '0001_concurrency_probe' }])
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
      await administrator.query(
        `GRANT SELECT, INSERT, UPDATE ON TABLE
          "${compatibilitySchema}".lifecycle_runs,
          "${compatibilitySchema}".research_requests
        TO "${runtimeRole}"`,
      )
      await administrator.query(
        `GRANT SELECT, INSERT ON TABLE
          "${compatibilitySchema}".portia_reviews,
          "${compatibilitySchema}".gate_decisions,
          "${compatibilitySchema}".charlotte_results,
          "${compatibilitySchema}".wilbur_actions,
          "${compatibilitySchema}".wilbur_observations,
          "${compatibilitySchema}".wilbur_mutation_requests,
          "${compatibilitySchema}".lifecycle_events,
          "${compatibilitySchema}".research_sources
        TO "${runtimeRole}"`,
      )
      await administrator.query(
        `GRANT UPDATE (answer_user_prompt, answer_user_prompt_sha256)
          ON TABLE "${compatibilitySchema}".gate_decisions
          TO "${runtimeRole}"`,
      )
      await administrator.query(
        `GRANT UPDATE (status, revision, updated_at)
          ON TABLE "${compatibilitySchema}".wilbur_actions
          TO "${runtimeRole}"`,
      )
      await administrator.query(
        `GRANT UPDATE (
            rate_admitted_at, denial_code, retry_at,
            reserved_future_rows, reserved_text_bytes, status,
            result_entity_id, result_revision, result_status,
            result_updated_at, updated_at
          )
          ON TABLE "${compatibilitySchema}".wilbur_mutation_requests
          TO "${runtimeRole}"`,
      )

      const runtime = runtimeClient()
      await runtime.connect()
      try {
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).resolves.toBeUndefined()

        await expect(
          runtime.query(
            'UPDATE gate_decisions SET answer_user_prompt = answer_user_prompt WHERE false',
          ),
        ).resolves.toMatchObject({ rowCount: 0 })
        await expect(
          runtime.query(
            'UPDATE gate_decisions SET result = result WHERE false',
          ),
        ).rejects.toMatchObject({ code: '42501' })
        await expect(
          runtime.query(
            'UPDATE wilbur_actions SET status = status WHERE false',
          ),
        ).resolves.toMatchObject({ rowCount: 0 })
        await expect(
          runtime.query('UPDATE wilbur_actions SET actor = actor WHERE false'),
        ).rejects.toMatchObject({ code: '42501' })
        await expect(
          runtime.query(
            'UPDATE wilbur_mutation_requests SET status = status WHERE false',
          ),
        ).resolves.toMatchObject({ rowCount: 0 })
        await expect(
          runtime.query(
            'UPDATE wilbur_mutation_requests SET request_digest = request_digest WHERE false',
          ),
        ).rejects.toMatchObject({ code: '42501' })

        await administrator.query(
          `GRANT UPDATE (actor)
            ON TABLE "${compatibilitySchema}".wilbur_actions
            TO "${runtimeRole}"`,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('column privileges')
        await administrator.query(
          `REVOKE UPDATE (actor)
            ON TABLE "${compatibilitySchema}".wilbur_actions
            FROM "${runtimeRole}"`,
        )

        await administrator.query(
          `GRANT UPDATE (request_digest)
            ON TABLE "${compatibilitySchema}".wilbur_mutation_requests
            TO "${runtimeRole}"`,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('column privileges')
        await administrator.query(
          `REVOKE UPDATE (request_digest)
            ON TABLE "${compatibilitySchema}".wilbur_mutation_requests
            FROM "${runtimeRole}"`,
        )

        await administrator.query(
          `REVOKE UPDATE (answer_user_prompt_sha256)
            ON TABLE "${compatibilitySchema}".gate_decisions
            FROM "${runtimeRole}"`,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('column privileges')
        await administrator.query(
          `GRANT UPDATE (answer_user_prompt_sha256)
            ON TABLE "${compatibilitySchema}".gate_decisions
            TO "${runtimeRole}"`,
        )

        await administrator.query(
          `REVOKE UPDATE ON TABLE "${compatibilitySchema}".deleted_user_tombstones FROM "${runtimeRole}"`,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('least-privilege contract')
        await administrator.query(
          `GRANT UPDATE ON TABLE "${compatibilitySchema}".deleted_user_tombstones TO "${runtimeRole}"`,
        )

        await administrator.query(
          `GRANT CREATE ON SCHEMA "${compatibilitySchema}" TO "${runtimeRole}"`,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
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
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('column contract')
        await owner.query(
          'ALTER TABLE games DROP COLUMN unexpected_contract_column',
        )

        await owner.query('DROP INDEX games_one_current_per_user')
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('critical index contract')
        await owner.query(`
          CREATE UNIQUE INDEX games_one_current_per_user
            ON games (clerk_user_id)
            WHERE is_current
        `)

        await owner.query(
          `ALTER TABLE wilbur_actions DROP CONSTRAINT
            wilbur_actions_charlotte_binding_version_valid`,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('critical constraint contract')
        await owner.query(`
          ALTER TABLE wilbur_actions
          ADD CONSTRAINT wilbur_actions_charlotte_binding_version_valid
          CHECK (
            charlotte_binding_version IS NULL
            OR charlotte_binding_version =
              'webchess-charlotte-action-binding-v1'
          )
        `)

        await owner.query(
          `ALTER TABLE wilbur_mutation_requests DROP CONSTRAINT
            wilbur_mutation_requests_clerk_user_id_fkey`,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('critical constraint contract')
        await owner.query(`
          ALTER TABLE wilbur_mutation_requests
          ADD CONSTRAINT wilbur_mutation_requests_clerk_user_id_fkey
          FOREIGN KEY (clerk_user_id)
          REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE
        `)

        const foreignKeyTrigger = await owner.query<{
          disable_statement: string
          enable_statement: string
        }>(`
          SELECT
            pg_catalog.format(
              'ALTER TABLE %I.%I DISABLE TRIGGER %I',
              current_schema(), relations.relname, triggers.tgname
            ) AS disable_statement,
            pg_catalog.format(
              'ALTER TABLE %I.%I ENABLE TRIGGER %I',
              current_schema(), relations.relname, triggers.tgname
            ) AS enable_statement
          FROM pg_catalog.pg_trigger AS triggers
          JOIN pg_catalog.pg_constraint AS constraints
            ON constraints.oid = triggers.tgconstraint
          JOIN pg_catalog.pg_namespace AS namespaces
            ON namespaces.oid = constraints.connamespace
          JOIN pg_catalog.pg_class AS relations
            ON relations.oid = triggers.tgrelid
          WHERE namespaces.nspname = current_schema()
            AND constraints.conname =
              'wilbur_mutation_requests_clerk_user_id_fkey'
            AND triggers.tgisinternal
          ORDER BY relations.relname, triggers.tgname
          LIMIT 1
        `)
        expect(foreignKeyTrigger.rows).toHaveLength(1)
        await administrator.query(
          foreignKeyTrigger.rows[0]!.disable_statement,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('critical constraint contract')
        await administrator.query(
          foreignKeyTrigger.rows[0]!.enable_statement,
        )

        await owner.query(`
          ALTER TABLE wilbur_mutation_requests
          ADD CONSTRAINT unexpected_wilbur_mutation_constraint
          CHECK (true)
        `)
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('critical constraint contract')
        await owner.query(`
          ALTER TABLE wilbur_mutation_requests
          DROP CONSTRAINT unexpected_wilbur_mutation_constraint
        `)

        await owner.query(`
          ALTER TABLE wilbur_mutation_requests
          ALTER COLUMN status SET DEFAULT 'denied'
        `)
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('critical default contract')
        await owner.query(`
          ALTER TABLE wilbur_mutation_requests
          ALTER COLUMN status SET DEFAULT 'pending'
        `)

        const originalTrigger = await owner.query<{ definition: string }>(`
          SELECT pg_catalog.pg_get_triggerdef(triggers.oid, true)
            AS definition
          FROM pg_catalog.pg_trigger AS triggers
          JOIN pg_catalog.pg_class AS relations
            ON relations.oid = triggers.tgrelid
          JOIN pg_catalog.pg_namespace AS namespaces
            ON namespaces.oid = relations.relnamespace
          WHERE namespaces.nspname = current_schema()
            AND relations.relname = 'wilbur_actions'
            AND triggers.tgname =
              'wilbur_actions_charlotte_binding_guard'
        `)
        expect(originalTrigger.rows).toHaveLength(1)

        await owner.query(
          `ALTER TABLE wilbur_actions DISABLE TRIGGER
            wilbur_actions_charlotte_binding_guard`,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('trigger contract')
        await owner.query(
          `ALTER TABLE wilbur_actions ENABLE TRIGGER
            wilbur_actions_charlotte_binding_guard`,
        )

        await owner.query(
          `ALTER TABLE wilbur_actions ENABLE REPLICA TRIGGER
            wilbur_actions_charlotte_binding_guard`,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('trigger contract')
        await owner.query(
          `ALTER TABLE wilbur_actions ENABLE TRIGGER
            wilbur_actions_charlotte_binding_guard`,
        )

        await owner.query(
          'DROP TRIGGER wilbur_actions_charlotte_binding_guard ON wilbur_actions',
        )
        await owner.query(`
          CREATE TRIGGER wilbur_actions_charlotte_binding_guard
          BEFORE UPDATE ON wilbur_actions
          FOR EACH ROW
          EXECUTE FUNCTION webchess_guard_wilbur_charlotte_binding()
        `)
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('trigger contract')
        await owner.query(
          'DROP TRIGGER wilbur_actions_charlotte_binding_guard ON wilbur_actions',
        )
        await owner.query(originalTrigger.rows[0]!.definition)

        await owner.query(
          'DROP TRIGGER wilbur_actions_charlotte_binding_guard ON wilbur_actions',
        )
        await owner.query(`
          CREATE TRIGGER wilbur_actions_charlotte_binding_guard
          BEFORE INSERT OR UPDATE ON wilbur_actions
          FOR EACH ROW
          WHEN (false)
          EXECUTE FUNCTION webchess_guard_wilbur_charlotte_binding()
        `)
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('trigger contract')
        await owner.query(
          'DROP TRIGGER wilbur_actions_charlotte_binding_guard ON wilbur_actions',
        )
        await owner.query(originalTrigger.rows[0]!.definition)

        await owner.query(
          'DROP TRIGGER wilbur_actions_charlotte_binding_guard ON wilbur_actions',
        )
        await owner.query(`
          CREATE TRIGGER wilbur_actions_charlotte_binding_guard
          BEFORE INSERT OR UPDATE OF status ON wilbur_actions
          FOR EACH ROW
          EXECUTE FUNCTION webchess_guard_wilbur_charlotte_binding()
        `)
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('trigger contract')
        await owner.query(
          'DROP TRIGGER wilbur_actions_charlotte_binding_guard ON wilbur_actions',
        )
        await owner.query(originalTrigger.rows[0]!.definition)

        await owner.query(
          'DROP TRIGGER wilbur_actions_charlotte_binding_guard ON wilbur_actions',
        )
        await owner.query(`
          CREATE TRIGGER wilbur_actions_charlotte_binding_guard
          BEFORE INSERT OR UPDATE ON wilbur_actions
          FOR EACH ROW
          EXECUTE FUNCTION webchess_guard_wilbur_charlotte_binding('unexpected')
        `)
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('trigger contract')
        await owner.query(
          'DROP TRIGGER wilbur_actions_charlotte_binding_guard ON wilbur_actions',
        )
        await owner.query(originalTrigger.rows[0]!.definition)

        await owner.query(`
          CREATE TRIGGER unexpected_wilbur_actions_guard
          BEFORE UPDATE ON wilbur_actions
          FOR EACH ROW
          EXECUTE FUNCTION webchess_guard_wilbur_charlotte_binding()
        `)
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('trigger contract')
        await owner.query(
          'DROP TRIGGER unexpected_wilbur_actions_guard ON wilbur_actions',
        )

        const originalGuard = await owner.query<{ definition: string }>(`
          SELECT pg_catalog.pg_get_functiondef(procedures.oid) AS definition
          FROM pg_catalog.pg_proc AS procedures
          JOIN pg_catalog.pg_namespace AS namespaces
            ON namespaces.oid = procedures.pronamespace
          WHERE namespaces.nspname = current_schema()
            AND procedures.proname =
              'webchess_guard_wilbur_charlotte_binding'
        `)
        expect(originalGuard.rows).toHaveLength(1)
        await owner.query(`
          CREATE OR REPLACE FUNCTION
            webchess_guard_wilbur_charlotte_binding()
          RETURNS trigger
          LANGUAGE plpgsql
          SET search_path = pg_catalog, pg_temp
          AS $permissive$
          BEGIN
            RETURN NEW;
          END
          $permissive$
        `)
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('trigger contract')
        await owner.query(originalGuard.rows[0]!.definition)
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).resolves.toBeUndefined()

        await owner.query(
          `ALTER FUNCTION webchess_guard_wilbur_charlotte_binding()
            RESET search_path`,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('trigger contract')
        await owner.query(originalGuard.rows[0]!.definition)

        await owner.query(
          `ALTER FUNCTION webchess_guard_wilbur_charlotte_binding()
            SECURITY DEFINER`,
        )
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('trigger contract')
        await owner.query(
          `ALTER FUNCTION webchess_guard_wilbur_charlotte_binding()
            SECURITY INVOKER`,
        )

        await administrator.query(`
          ALTER FUNCTION "${compatibilitySchema}".
            webchess_guard_wilbur_charlotte_binding()
          OWNER TO "${runtimeRole}"
        `)
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('trigger contract')
        await administrator.query(`
          ALTER FUNCTION "${compatibilitySchema}".
            webchess_guard_wilbur_charlotte_binding()
          OWNER TO CURRENT_USER
        `)

        await owner.query(`ALTER TABLE games OWNER TO "${runtimeRole}"`)
        await expect(
          checkCanonicalMigrationsReadOnly(runtime, canonicalMigrations),
        ).rejects.toThrow('assume ownership')
      } finally {
        await runtime.end()
      }
    } finally {
      await owner.end()
    }
  })
})
