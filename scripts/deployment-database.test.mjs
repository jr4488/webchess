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
    ])
    expect(migrations[0].sql).toContain(
      'CREATE TABLE IF NOT EXISTS games',
    )
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
