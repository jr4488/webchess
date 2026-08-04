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
              this.rows.length > 0
                ? 'webchess_schema_migrations'
                : null,
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
    const migrations = await loadCanonicalMigrations(
      migrationDirectory,
    )

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
    ])
    expect(migrations[0].sql).toContain(
      'CREATE TABLE IF NOT EXISTS games',
    )
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
    expect(researchMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS research_requests',
    )
    expect(researchMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS research_sources',
    )
    expect(timeoutMigration?.sql).toContain(
      'CHECK (timeout_ms BETWEEN 1000 AND 120000)',
    )
    expect(answerPromptMigration?.sql).toContain(
      'answer_user_prompt_sha256',
    )
    expect(extendedTimeoutMigration?.sql).toContain(
      'CHECK (timeout_ms BETWEEN 1000 AND 150000)',
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

    const requestColumns = columns.filter(({ table_name }) =>
      table_name === 'research_requests')
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
    expect(columns.filter(({ table_name }) =>
      table_name === 'research_sources')).toHaveLength(11)

    const allowedPrivileges = (tableName) => privileges
      .filter(({ table_name, allowed }) =>
        table_name === tableName && allowed)
      .map(({ privilege }) => privilege)
    expect(allowedPrivileges('research_requests')).toEqual([
      'SELECT',
      'INSERT',
      'UPDATE',
    ])
    expect(allowedPrivileges('research_sources')).toEqual([
      'SELECT',
      'INSERT',
    ])

    const gateUpdateColumns = columnPrivileges
      .filter(({ table_name, privilege, allowed }) =>
        table_name === 'gate_decisions' && privilege === 'UPDATE' && allowed)
      .map(({ column_name }) => column_name)
    expect(gateUpdateColumns).toEqual([
      'answer_user_prompt',
      'answer_user_prompt_sha256',
    ])

    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        index_name:
          'research_requests_game_id_stage_policy_version_key',
        table_name: 'research_requests',
        key_columns: 'game_id,stage,policy_version',
      }),
      expect.objectContaining({
        index_name:
          'research_sources_research_request_id_ordinal_key',
        table_name: 'research_sources',
        key_columns: 'research_request_id,ordinal',
      }),
      expect.objectContaining({
        index_name: 'research_sources_research_request_id_url_key',
        table_name: 'research_sources',
        key_columns: 'research_request_id,url',
      }),
    ]))
  })

  it('uses the existing migration runner checksum semantics exactly', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'db',
        'migrations',
        '0001_durable_webchess.sql',
      ),
      'utf8',
    )

    expect(deploymentMigrationChecksum(sql)).toBe(
      migrationChecksum(sql),
    )
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
    expect(() =>
      planCanonicalMigrations(migrations, drifted),
    ).toThrow(/0001_example has a checksum mismatch/)

    const unexpected = [
      ...ledgerFor(migrations),
      { id: '0003_unknown', checksum: '1'.repeat(64) },
    ]
    expect(() =>
      planCanonicalMigrations(migrations, unexpected),
    ).toThrow(/0003_unknown is not present in the release/)

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
      expect.stringContaining(
        'webchess_runtime_compatibility_probe',
      ),
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
      const client = new FakeClient(
        ledgerFor(migrations),
        inspection,
      )

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

    await expect(
      applyCanonicalMigrations(client, migrations),
    ).resolves.toEqual({
      applied: ['0002_more'],
      alreadyApplied: ['0001_example'],
    })

    expect(client.queries[0].text).toBe(
      'BEGIN ISOLATION LEVEL READ COMMITTED',
    )
    expect(
      client.queries.some(
        (query) =>
          query.text === migrations[1].sql &&
          query.values === undefined,
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
        if (
          text.includes('webchess_runtime_compatibility_probe')
        ) {
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
