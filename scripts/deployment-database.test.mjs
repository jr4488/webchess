import { readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { migrationChecksum } from '../src/server/db/migrations'
import {
  DeploymentMigrationError,
  applyCanonicalMigrations,
  assertCanonicalMigrationCompatibility,
  checkCanonicalMigrationsReadOnly,
  deploymentMigrationChecksum,
  loadCanonicalMigrations,
  planCanonicalMigrations,
  validateCanonicalMigrations,
} from './deployment-database.mjs'

const exampleMigrations = () => [
  {
    id: '0001_example',
    sql: 'CREATE TABLE example (id integer PRIMARY KEY);\n',
  },
  {
    id: '0002_more',
    sql: 'ALTER TABLE example ADD COLUMN label text;\n',
  },
]

const ledgerFor = (migrations) =>
  migrations.map((migration) => ({
    id: migration.id,
    checksum: deploymentMigrationChecksum(migration.sql),
  }))

const compatibleRuntimeInspection = () => ({
  schema_resolved: true,
  schema_usage: true,
  schema_create: false,
  public_schema_create: false,
  tables_exact: true,
  columns_exact: true,
  privileges_exact: true,
  column_privileges_exact: true,
  owner_isolated: true,
  indexes_exact: true,
  triggers_exact: true,
  constraints_exact: true,
  defaults_exact: true,
})

class FakeClient {
  constructor(rows = [], inspection = compatibleRuntimeInspection()) {
    this.rows = [...rows]
    this.inspection = inspection
    this.queries = []
  }

  async query(text, values) {
    this.queries.push({ text, values })
    if (text.includes('webchess_runtime_compatibility_probe')) {
      return { rows: [this.inspection] }
    }
    if (text.includes("to_regclass('webchess_schema_migrations')")) {
      return {
        rows: [
          {
            migration_ledger:
              this.rows.length > 0 ? 'webchess_schema_migrations' : null,
            has_webchess_objects: false,
          },
        ],
      }
    }
    if (text.includes('SELECT id, checksum')) {
      return { rows: [...this.rows] }
    }
    if (text.includes('INSERT INTO webchess_schema_migrations')) {
      this.rows.push({ id: values[0], checksum: values[1] })
    }
    return { rows: [] }
  }
}

describe('deployment database migration tooling', () => {
  it('loads every canonical SQL migration in deterministic order', async () => {
    const migrationDirectory = pathToFileURL(
      `${join(process.cwd(), 'db', 'migrations')}${sep}`,
    )
    const migrations = await loadCanonicalMigrations(migrationDirectory)

    expect(migrations.map((migration) => migration.id)).toEqual([
      '0001_durable_webchess',
      '0002_webchess_2_lifecycle',
      '0003_prompt_review_answer_stage',
      '0004_detached_provider_recovery',
      '0005_align_completed_portia_progress',
      '0006_permitted_portia_amendments',
      '0007_bounded_charlotte_attempts',
      '0008_visible_research_broker',
      '0009_expand_research_timeout_ceiling',
      '0010_player_visible_answer_prompt',
      '0011_extend_research_timeout_ceiling',
      '0012_unique_wilbur_charlotte_actions',
      '0013_wilbur_mutation_requests',
    ])
    expect(migrations[0].sql).toContain('CREATE TABLE IF NOT EXISTS games')
    const researchMigration = migrations.find(
      (migration) => migration.id === '0008_visible_research_broker',
    )
    const timeoutMigration = migrations.find(
      (migration) => migration.id === '0009_expand_research_timeout_ceiling',
    )
    const answerPromptMigration = migrations.find(
      (migration) => migration.id === '0010_player_visible_answer_prompt',
    )
    const extendedTimeoutMigration = migrations.find(
      (migration) => migration.id === '0011_extend_research_timeout_ceiling',
    )
    const uniqueWilburActionsMigration = migrations.find(
      (migration) => migration.id === '0012_unique_wilbur_charlotte_actions',
    )
    const wilburMutationRequestsMigration = migrations.find(
      (migration) => migration.id === '0013_wilbur_mutation_requests',
    )
    expect(researchMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS research_requests',
    )
    expect(researchMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS research_sources',
    )
    expect(timeoutMigration?.sql).toContain(
      'CHECK (timeout_ms BETWEEN 1000 AND 120000)',
    )
    expect(answerPromptMigration?.sql).toContain('answer_user_prompt_sha256')
    expect(extendedTimeoutMigration?.sql).toContain(
      'CHECK (timeout_ms BETWEEN 1000 AND 150000)',
    )
    expect(uniqueWilburActionsMigration?.sql).toContain(
      'wilbur_actions_one_per_charlotte_suggestion',
    )
    expect(uniqueWilburActionsMigration?.sql).toContain(
      'wilbur_actions_charlotte_binding_guard',
    )
    expect(wilburMutationRequestsMigration?.sql).toContain(
      'CREATE TABLE wilbur_mutation_requests',
    )
  })

  it('pins the visible research broker runtime schema and privileges', async () => {
    const migrations = exampleMigrations()
    const client = new FakeClient(ledgerFor(migrations))

    await checkCanonicalMigrationsReadOnly(client, migrations)

    const probe = client.queries.find((query) =>
      query.text.includes('webchess_runtime_compatibility_probe'),
    )
    const columns = JSON.parse(probe.values[0])
    const privileges = JSON.parse(probe.values[1])
    const indexes = JSON.parse(probe.values[2])
    const columnPrivileges = JSON.parse(probe.values[3])
    const triggers = JSON.parse(probe.values[4])
    const constraints = JSON.parse(probe.values[5])
    const defaults = JSON.parse(probe.values[6])

    const requestColumns = columns.filter(
      ({ table_name }) => table_name === 'research_requests',
    )
    expect(requestColumns).toHaveLength(32)
    expect(requestColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          column_name: 'stage',
          data_type: 'text',
          not_null: true,
        }),
        expect.objectContaining({
          column_name: 'content_digest',
          data_type: 'character(64)',
          not_null: false,
        }),
      ]),
    )
    expect(
      columns.filter(({ table_name }) => table_name === 'research_sources'),
    ).toHaveLength(11)

    const allowedPrivileges = (tableName) =>
      privileges
        .filter(
          ({ table_name, allowed }) => table_name === tableName && allowed,
        )
        .map(({ privilege }) => privilege)
    expect(allowedPrivileges('research_requests')).toEqual([
      'SELECT',
      'INSERT',
      'UPDATE',
    ])
    expect(allowedPrivileges('research_sources')).toEqual(['SELECT', 'INSERT'])
    expect(allowedPrivileges('wilbur_actions')).toEqual(['SELECT', 'INSERT'])
    expect(allowedPrivileges('wilbur_mutation_requests')).toEqual([
      'SELECT',
      'INSERT',
    ])

    const gateUpdateColumns = columnPrivileges
      .filter(
        ({ table_name, privilege, allowed }) =>
          table_name === 'gate_decisions' && privilege === 'UPDATE' && allowed,
      )
      .map(({ column_name }) => column_name)
    expect(gateUpdateColumns).toEqual([
      'answer_user_prompt',
      'answer_user_prompt_sha256',
    ])
    const wilburActionUpdateColumns = columnPrivileges
      .filter(
        ({ table_name, privilege, allowed }) =>
          table_name === 'wilbur_actions' && privilege === 'UPDATE' && allowed,
      )
      .map(({ column_name }) => column_name)
    expect(wilburActionUpdateColumns).toEqual([
      'status',
      'revision',
      'updated_at',
    ])
    const wilburMutationUpdateColumns = columnPrivileges
      .filter(
        ({ table_name, privilege, allowed }) =>
          table_name === 'wilbur_mutation_requests' &&
          privilege === 'UPDATE' &&
          allowed,
      )
      .map(({ column_name }) => column_name)
    expect(wilburMutationUpdateColumns).toEqual([
      'rate_admitted_at',
      'denial_code',
      'retry_at',
      'reserved_future_rows',
      'reserved_text_bytes',
      'status',
      'result_entity_id',
      'result_revision',
      'result_status',
      'result_updated_at',
      'updated_at',
    ])

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index_name: 'research_requests_game_id_stage_policy_version_key',
          table_name: 'research_requests',
          key_columns: 'game_id,stage,policy_version',
        }),
        expect.objectContaining({
          index_name: 'research_sources_research_request_id_ordinal_key',
          table_name: 'research_sources',
          key_columns: 'research_request_id,ordinal',
        }),
        expect.objectContaining({
          index_name: 'research_sources_research_request_id_url_key',
          table_name: 'research_sources',
          key_columns: 'research_request_id,url',
        }),
        expect.objectContaining({
          index_name: 'wilbur_actions_one_per_charlotte_suggestion',
          table_name: 'wilbur_actions',
          key_columns: 'lifecycle_run_id,charlotte_action_index',
          predicate:
            "(charlotte_binding_version = 'webchess-charlotte-action-binding-v1'::text)",
        }),
        expect.objectContaining({
          index_name: 'wilbur_mutation_requests_pkey',
          table_name: 'wilbur_mutation_requests',
          key_columns: 'clerk_user_id,idempotency_key',
          predicate: null,
        }),
      ]),
    )

    expect(triggers).toEqual([
      expect.objectContaining({
        table_name: 'wilbur_actions',
        trigger_name: 'wilbur_actions_charlotte_binding_guard',
        function_name: 'webchess_guard_wilbur_charlotte_binding',
        function_config: 'search_path=pg_catalog, pg_temp',
        security_definer: false,
        leakproof: false,
        function_owner_isolated: true,
        volatility: 'v',
        parallel_mode: 'u',
        enabled_mode: 'O',
        trigger_type: 23,
        has_when_clause: false,
        update_columns: '',
        argument_count: 0,
        argument_bytes: 0,
        constraint_trigger: false,
        trigger_deferrable: false,
        initially_deferred: false,
        parent_trigger: false,
        function_source: expect.stringContaining(
          'NEW.charlotte_binding_version IS DISTINCT FROM OLD.charlotte_binding_version',
        ),
      }),
      expect.objectContaining({
        table_name: 'wilbur_mutation_requests',
        trigger_name: 'wilbur_mutation_requests_state_guard',
        function_name: 'webchess_guard_wilbur_mutation_request',
        function_config: 'search_path=pg_catalog, pg_temp',
        security_definer: false,
        leakproof: false,
        function_owner_isolated: true,
        volatility: 'v',
        parallel_mode: 'u',
        enabled_mode: 'O',
        trigger_type: 23,
        has_when_clause: false,
        update_columns: '',
        argument_count: 0,
        argument_bytes: 0,
        constraint_trigger: false,
        trigger_deferrable: false,
        initially_deferred: false,
        parent_trigger: false,
        function_source: expect.stringContaining("OLD.status <> 'pending'"),
      }),
    ])

    for (const [index, filename] of [
      [0, '0012_unique_wilbur_charlotte_actions.sql'],
      [1, '0013_wilbur_mutation_requests.sql'],
    ]) {
      const functionBody = readFileSync(
        join(process.cwd(), 'db', 'migrations', filename),
        'utf8',
      ).match(/AS \$function\$([\s\S]*?)\$function\$;/u)?.[1]
      expect(functionBody).toBeDefined()
      expect(triggers[index].function_source).toBe(
        functionBody?.trim().replace(/\s+/gu, ' '),
      )
      expect(triggers[index].function_source).not.toBe('BEGIN RETURN NEW; END')
    }

    expect(constraints).toHaveLength(18)
    expect(constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraint_name: 'wilbur_actions_charlotte_binding_version_valid',
          definition: expect.stringContaining(
            'webchess-charlotte-action-binding-v1',
          ),
        }),
        expect.objectContaining({
          constraint_name: 'wilbur_mutation_requests_clerk_user_id_fkey',
          definition: expect.stringContaining('ON DELETE CASCADE'),
        }),
        expect.objectContaining({
          constraint_name: 'wilbur_mutation_requests_reservation_shape',
          definition: expect.stringContaining('reserved_future_rows'),
        }),
      ]),
    )
    expect(defaults).toHaveLength(5)
    expect(defaults).toEqual(
      expect.arrayContaining([
        {
          table_name: 'wilbur_mutation_requests',
          column_name: 'reserved_future_rows',
          definition: '0',
        },
        {
          table_name: 'wilbur_mutation_requests',
          column_name: 'status',
          definition: "'pending'::text",
        },
      ]),
    )
  })

  it('fails closed for a permissive same-name trigger function body', async () => {
    const migrations = exampleMigrations()
    const client = new FakeClient(ledgerFor(migrations), {
      ...compatibleRuntimeInspection(),
      triggers_exact: false,
    })

    await expect(
      checkCanonicalMigrationsReadOnly(client, migrations),
    ).rejects.toThrow('trigger contract')
    expect(client.queries.at(-1).text).toBe('ROLLBACK')
  })

  it('uses the existing migration runner checksum semantics exactly', () => {
    const sql = readFileSync(
      join(process.cwd(), 'db', 'migrations', '0001_durable_webchess.sql'),
      'utf8',
    )

    expect(deploymentMigrationChecksum(sql)).toBe(migrationChecksum(sql))
    expect(deploymentMigrationChecksum('SELECT 1;\r\n')).toBe(
      migrationChecksum('SELECT 1;\r\n'),
    )
  })

  it('rejects transaction control without rejecting procedural bodies', () => {
    expect(() =>
      validateCanonicalMigrations([
        {
          id: '0001_bad',
          sql: '-- unsafe wrapper\nBEGIN; SELECT 1; COMMIT;',
        },
      ]),
    ).toThrow(/transaction control/)

    expect(() =>
      validateCanonicalMigrations([
        {
          id: '0001_bad',
          sql: 'CREATE INDEX CONCURRENTLY bad_index ON bad_table (id);',
        },
      ]),
    ).toThrow(/nontransactional DDL/)

    for (const sql of [
      'CREATE DATABASE bad_database;',
      'DROP DATABASE bad_database;',
      "CREATE TABLESPACE bad_space LOCATION '/tmp/bad';",
      'DROP TABLESPACE bad_space;',
      "ALTER SYSTEM SET work_mem = '1GB';",
    ]) {
      expect(() =>
        validateCanonicalMigrations([{ id: '0001_bad', sql }]),
      ).toThrow(/nontransactional DDL/)
    }

    expect(() =>
      validateCanonicalMigrations([
        {
          id: '0001_good',
          sql: `
            DO $body$
            BEGIN
              PERFORM 'safe;body';
            END
            $body$;
          `,
        },
      ]),
    ).not.toThrow()
  })

  it('plans missing migrations but rejects checksum drift and unexpected IDs', () => {
    const migrations = exampleMigrations()
    expect(
      planCanonicalMigrations(migrations, ledgerFor(migrations.slice(0, 1))),
    ).toEqual([migrations[1]])

    const drifted = ledgerFor(migrations)
    drifted[0] = { ...drifted[0], checksum: '0'.repeat(64) }
    expect(() => planCanonicalMigrations(migrations, drifted)).toThrow(
      /0001_example has a checksum mismatch/,
    )

    const unexpected = [
      ...ledgerFor(migrations),
      { id: '0003_unknown', checksum: '1'.repeat(64) },
    ]
    expect(() => planCanonicalMigrations(migrations, unexpected)).toThrow(
      /0003_unknown is not present in the release/,
    )

    expect(() =>
      planCanonicalMigrations(migrations, ledgerFor(migrations.slice(1))),
    ).toThrow(/not an exact prefix/)
  })

  it('rejects a database missing a canonical migration', () => {
    expect(() =>
      assertCanonicalMigrationCompatibility(exampleMigrations(), []),
    ).toThrow(/0001_example has not been applied/)
  })

  it('checks compatibility inside an explicitly read-only transaction', async () => {
    const migrations = exampleMigrations()
    const client = new FakeClient(ledgerFor(migrations))

    await expect(
      checkCanonicalMigrationsReadOnly(client, migrations),
    ).resolves.toBeUndefined()

    expect(client.queries.map((query) => query.text.trim())).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      expect.stringContaining('webchess_runtime_compatibility_probe'),
      expect.stringContaining('SELECT id, checksum'),
      'COMMIT',
    ])
  })

  it.each([
    ['schema_resolved', false, /search path/],
    ['schema_usage', false, /lacks USAGE/],
    ['schema_create', true, /CREATE.*application schema/],
    ['public_schema_create', true, /CREATE.*public schema/],
    ['tables_exact', false, /table set/],
    ['columns_exact', false, /column contract/],
    ['indexes_exact', false, /critical index contract/],
    ['triggers_exact', false, /trigger contract/],
    ['constraints_exact', false, /critical constraint contract/],
    ['defaults_exact', false, /critical default contract/],
    ['owner_isolated', false, /assume ownership/],
    ['privileges_exact', false, /least-privilege contract/],
    ['column_privileges_exact', false, /column privileges/],
  ])(
    'fails closed when runtime compatibility field %s is %s',
    async (field, failedValue, message) => {
      const migrations = exampleMigrations()
      const inspection = {
        ...compatibleRuntimeInspection(),
        [field]: failedValue,
      }
      const client = new FakeClient(ledgerFor(migrations), inspection)

      await expect(
        checkCanonicalMigrationsReadOnly(client, migrations),
      ).rejects.toThrow(message)
      expect(client.queries.at(-1).text).toBe('ROLLBACK')
      expect(
        client.queries.some((query) =>
          query.text.includes('SELECT id, checksum'),
        ),
      ).toBe(false)
    },
  )

  it('rejects malformed runtime probe results without reflecting driver data', async () => {
    const migrations = exampleMigrations()
    const client = new FakeClient(ledgerFor(migrations), {
      schema_resolved: 'postgresql://secret@example/db',
    })

    await expect(
      checkCanonicalMigrationsReadOnly(client, migrations),
    ).rejects.toThrow('probe returned an invalid result')
    expect(client.queries.at(-1).text).toBe('ROLLBACK')
  })

  it('rolls back the read-only check when compatibility fails', async () => {
    const client = new FakeClient([])

    await expect(
      checkCanonicalMigrationsReadOnly(client, exampleMigrations()),
    ).rejects.toBeInstanceOf(DeploymentMigrationError)
    expect(client.queries.at(-1).text).toBe('ROLLBACK')
  })

  it('applies pending migrations atomically and records exact checksums', async () => {
    const migrations = exampleMigrations()
    const existing = ledgerFor(migrations.slice(0, 1))
    const client = new FakeClient(existing)

    await expect(applyCanonicalMigrations(client, migrations)).resolves.toEqual(
      {
        applied: ['0002_more'],
        alreadyApplied: ['0001_example'],
      },
    )

    expect(client.queries[0].text).toBe('BEGIN ISOLATION LEVEL READ COMMITTED')
    expect(
      client.queries.some(
        (query) =>
          query.text === migrations[1].sql && query.values === undefined,
      ),
    ).toBe(true)
    expect(client.rows).toEqual(ledgerFor(migrations))
    expect(client.queries.at(-1).text).toBe('COMMIT')
  })

  it('refuses to stamp a raw-SQL schema that has no migration ledger', async () => {
    const client = new FakeClient()
    const originalQuery = client.query.bind(client)
    client.query = async (text, values) => {
      if (text.includes("to_regclass('webchess_schema_migrations')")) {
        client.queries.push({ text, values })
        return {
          rows: [
            {
              migration_ledger: null,
              has_webchess_objects: true,
            },
          ],
        }
      }
      return originalQuery(text, values)
    }

    await expect(
      applyCanonicalMigrations(client, exampleMigrations()),
    ).rejects.toThrow('automatic adoption is forbidden')
    expect(client.queries.at(-1).text).toBe('ROLLBACK')
    expect(
      client.queries.some((query) =>
        query.text.includes('INSERT INTO webchess_schema_migrations'),
      ),
    ).toBe(false)
  })

  it('reports a missing migration ledger without exposing driver details', async () => {
    const client = {
      async query(text) {
        if (text.includes('webchess_runtime_compatibility_probe')) {
          return { rows: [compatibleRuntimeInspection()] }
        }
        if (text.includes('SELECT id, checksum')) {
          throw Object.assign(
            new Error(
              'relation does not exist at postgresql://secret@example/db',
            ),
            { code: '42P01' },
          )
        }
        return { rows: [] }
      },
    }

    await expect(
      checkCanonicalMigrationsReadOnly(client, exampleMigrations()),
    ).rejects.toThrow('database migration ledger is missing')
  })
})
