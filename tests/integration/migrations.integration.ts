import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { SqlRow } from '../../src/server/db'
import { runMigrations } from '../../src/server/db/migrations'
import {
  createPostgresTestDatabase,
  durableWebChessMigrations,
} from './postgres-test-database'
import type { PostgresTestDatabase } from './postgres-test-database'

let database: PostgresTestDatabase

const EXPECTED_MIGRATION_IDS = [
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
  '0014_web_memory_feedback',
  '0015_direct_page_research_evidence',
  '0016_extend_research_timeout_to_five_minutes',
  '0017_trajectory_directional_record',
  '0018_align_answer_prompt_durable_limit',
  '0019_durable_answer_operation_deadline',
] as const

beforeAll(async () => {
  database = await createPostgresTestDatabase('migration')
})

afterAll(async () => {
  await database.dispose()
})

describe('durable WebChess migration on PostgreSQL 17', () => {
  it('applies the canonical migration atomically and replays it idempotently', async () => {
    await expect(database.migrate()).resolves.toEqual({
      applied: EXPECTED_MIGRATION_IDS,
      alreadyApplied: [],
    })
    await expect(database.migrate()).resolves.toEqual({
      applied: [],
      alreadyApplied: EXPECTED_MIGRATION_IDS,
    })

    const version = await database.adapter.query<SqlRow>({
      text: 'SHOW server_version_num',
    })
    expect(String(version.rows[0]?.server_version_num)).toMatch(/^17\d{4}$/)

    const tables = await database.adapter.query<SqlRow>({
      text: `
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = current_schema()
        ORDER BY tablename
      `,
    })
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      'charlotte_results',
      'deleted_user_tombstones',
      'game_events',
      'game_start_requests',
      'games',
      'gate_decisions',
      'lifecycle_events',
      'lifecycle_runs',
      'model_concurrency_slots',
      'model_requests',
      'portia_reviews',
      'rate_buckets',
      'research_requests',
      'research_sources',
      'usage_buckets',
      'user_controls',
      'web_memory_links',
      'webchess_schema_migrations',
      'wilbur_actions',
      'wilbur_mutation_requests',
      'wilbur_observations',
    ])

    const slots = await database.adapter.query<SqlRow>({
      text: `
        SELECT slot, enabled
        FROM model_concurrency_slots
        ORDER BY slot
      `,
    })
    expect(slots.rows).toEqual([
      { slot: 1, enabled: true },
      { slot: 2, enabled: true },
      { slot: 3, enabled: true },
      { slot: 4, enabled: true },
    ])
  })

  it('backfills and guards the explicit durable Answer deadline', async () => {
    const upgrade = await createPostgresTestDatabase(
      'answer_operation_deadline_upgrade',
    )
    try {
      const deadlineMigrationIndex = durableWebChessMigrations.findIndex(
        (migration) =>
          migration.id === '0019_durable_answer_operation_deadline',
      )
      const priorMigrations = durableWebChessMigrations.slice(
        0,
        deadlineMigrationIndex,
      )
      const deadlineMigration = durableWebChessMigrations[
        deadlineMigrationIndex
      ]
      if (!deadlineMigration) {
        throw new Error('The durable Answer deadline migration is missing.')
      }
      await runMigrations(upgrade.adapter, priorMigrations)

      const owner = 'user_answer_deadline_upgrade'
      const requestId = '65000000-0000-4000-8000-000000000001'
      const leaseToken = '65000000-0000-4000-8000-000000000002'
      const createdAt = new Date('2026-08-25T12:00:00.000Z')
      const leaseExpiresAt = new Date(createdAt.valueOf() + 335_000)
      await upgrade.adapter.query({
        text: `
          INSERT INTO user_controls (clerk_user_id)
          VALUES ($1::text)
        `,
        values: [owner],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO model_requests (
            id, clerk_user_id, operation, idempotency_key,
            request_sha256, status, provider, model, prompt_version,
            software_version, provider_started_at, created_at, updated_at
          )
          VALUES (
            $1::uuid, $2::text, 'answer', $1::uuid,
            repeat('a', 64), 'in_progress', 'openclaw',
            'gpt-5.6-sol', 'answer-v1', 'upgrade-test',
            $3::timestamptz, $3::timestamptz, $3::timestamptz
          )
        `,
        values: [requestId, owner, createdAt.toISOString()],
      })
      await upgrade.adapter.query({
        text: `
          UPDATE model_concurrency_slots
          SET request_id = $1::uuid,
              clerk_user_id = $2::text,
              lease_token = $3::uuid,
              lease_expires_at = $4::timestamptz
          WHERE slot = 1
        `,
        values: [
          requestId,
          owner,
          leaseToken,
          leaseExpiresAt.toISOString(),
        ],
      })

      await expect(runMigrations(upgrade.adapter, durableWebChessMigrations))
        .resolves.toEqual({
          applied: ['0019_durable_answer_operation_deadline'],
          alreadyApplied: priorMigrations.map((migration) => migration.id),
        })

      const persisted = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT operation_deadline_at
          FROM model_requests
          WHERE id = $1::uuid
        `,
        values: [requestId],
      })
      expect(persisted.rows).toEqual([{
        operation_deadline_at: new Date(createdAt.valueOf() + 300_000),
      }])

      await expect(upgrade.adapter.query({
        text: `
          UPDATE model_requests
          SET operation_deadline_at = operation_deadline_at + interval '1 second'
          WHERE id = $1::uuid
        `,
        values: [requestId],
      })).rejects.toMatchObject({ code: '23514' })

      await expect(upgrade.adapter.query({
        text: `
          INSERT INTO model_requests (
            id, clerk_user_id, operation, idempotency_key,
            request_sha256, status, provider, model, prompt_version,
            software_version
          )
          VALUES (
            '65000000-0000-4000-8000-000000000003', $1::text,
            'answer', '65000000-0000-4000-8000-000000000003',
            repeat('b', 64), 'reserved', 'openclaw',
            'gpt-5.6-sol', 'answer-v1', 'upgrade-test'
          )
        `,
        values: [owner],
      })).rejects.toMatchObject({
        constraint: 'model_requests_operation_deadline_valid',
      })
    } finally {
      await upgrade.dispose()
    }
  })

  it('upgrades the Gate-approved Answer prompt from 200000 to the shared 3000000-character ceiling', async () => {
    const upgrade = await createPostgresTestDatabase(
      'answer_prompt_durable_limit_upgrade',
    )
    try {
      const limitMigrationIndex = durableWebChessMigrations.findIndex(
        (migration) =>
          migration.id === '0018_align_answer_prompt_durable_limit',
      )
      const priorMigrations = durableWebChessMigrations.slice(
        0,
        limitMigrationIndex,
      )
      await runMigrations(upgrade.adapter, priorMigrations)

      const owner = 'user_answer_prompt_limit_upgrade'
      const gameId = '64000000-0000-4000-8000-000000000001'
      const runId = '64000000-0000-4000-8000-000000000002'
      await upgrade.adapter.query({
        text: `
          INSERT INTO user_controls (clerk_user_id)
          VALUES ($1::text)
        `,
        values: [owner],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO games (
            id, clerk_user_id, status, problem, problem_sha256,
            event_version, rules_version, engine_version, cast_version,
            software_version
          )
          VALUES (
            $1::uuid, $2::text, 'dividing',
            'How should this upgrade preserve a complete reviewed Answer input?',
            repeat('a', 64), 1, 'rules-test', 'engine-test',
            'cast-test', 'software-test'
          )
        `,
        values: [gameId, owner],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO lifecycle_runs (
            id, clerk_user_id, game_id, root_run_id, state,
            division_seed, cast_seed, trajectory_seed,
            software_version, lifecycle_version, rules_version,
            engine_version, cast_version, event_version,
            portia_prompt_version, portia_contract_version,
            gate_algorithm_version, retry_policy_version,
            charlotte_prompt_version, charlotte_contract_version,
            wilbur_record_version
          )
          VALUES (
            $1::uuid, $2::text, $3::uuid, $1::uuid, 'gate_passed',
            'division-seed', 'cast-seed', 'trajectory-seed',
            'software-test', 'webchess-lifecycle-v2.4', 'rules-test',
            'engine-test', 'cast-test', 1,
            'portia-prompt-test', 'portia-contract-test',
            'gate-test', 'retry-test', 'charlotte-prompt-test',
            'charlotte-contract-test', 'wilbur-record-test'
          )
        `,
        values: [runId, owner, gameId],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO gate_decisions (
            id, clerk_user_id, lifecycle_run_id, algorithm_version,
            input_digest, passed, result,
            answer_user_prompt, answer_user_prompt_sha256
          )
          VALUES (
            '64000000-0000-4000-8000-000000000003',
            $1::text, $2::uuid, 'gate-test', repeat('b', 64), true,
            '{}'::jsonb, 'reviewed prompt', repeat('c', 64)
          )
        `,
        values: [owner, runId],
      })

      await expect(
        runMigrations(upgrade.adapter, durableWebChessMigrations),
      ).resolves.toEqual({
        applied: [
          '0018_align_answer_prompt_durable_limit',
          '0019_durable_answer_operation_deadline',
        ],
        alreadyApplied: priorMigrations.map((migration) => migration.id),
      })

      await expect(upgrade.adapter.query({
        text: `
          UPDATE gate_decisions
          SET answer_user_prompt = repeat('x', 3000000),
              answer_user_prompt_sha256 = repeat('d', 64)
          WHERE lifecycle_run_id = $1::uuid
        `,
        values: [runId],
      })).resolves.toMatchObject({ rowCount: 1 })

      await expect(upgrade.adapter.query({
        text: `
          UPDATE gate_decisions
          SET answer_user_prompt = repeat('x', 3000001),
              answer_user_prompt_sha256 = repeat('e', 64)
          WHERE lifecycle_run_id = $1::uuid
        `,
        values: [runId],
      })).rejects.toMatchObject({
        constraint: 'gate_decisions_answer_user_prompt_valid',
      })

      await expect(upgrade.adapter.query({
        text: `
          UPDATE gate_decisions
          SET answer_user_prompt = NULL,
              answer_user_prompt_sha256 = repeat('f', 64)
          WHERE lifecycle_run_id = $1::uuid
        `,
        values: [runId],
      })).rejects.toMatchObject({
        constraint: 'gate_decisions_answer_user_prompt_valid',
      })

      await expect(upgrade.adapter.query({
        text: `
          UPDATE gate_decisions
          SET answer_user_prompt = 'detached reviewed prompt',
              answer_user_prompt_sha256 = NULL
          WHERE lifecycle_run_id = $1::uuid
        `,
        values: [runId],
      })).rejects.toMatchObject({
        constraint: 'gate_decisions_answer_user_prompt_valid',
      })

      const persisted = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT
            char_length(answer_user_prompt)::integer AS prompt_characters,
            answer_user_prompt_sha256,
            (
              SELECT count(*)::integer
              FROM pg_constraint
              WHERE conrelid = 'lifecycle_runs'::regclass
                AND conname LIKE
                  'lifecycle_runs_trajectory_directional_record_%'
            ) AS directional_constraint_count,
            (
              SELECT pg_get_constraintdef(oid, true)
              FROM pg_constraint
              WHERE conrelid = 'gate_decisions'::regclass
                AND conname =
                  'gate_decisions_answer_user_prompt_valid'
            ) AS prompt_constraint
          FROM gate_decisions
          WHERE lifecycle_run_id = $1::uuid
        `,
        values: [runId],
      })
      expect(persisted.rows).toEqual([{
        prompt_characters: 3_000_000,
        answer_user_prompt_sha256: 'd'.repeat(64),
        directional_constraint_count: 4,
        prompt_constraint:
          "CHECK (answer_user_prompt IS NULL AND answer_user_prompt_sha256 IS NULL OR answer_user_prompt IS NOT NULL AND answer_user_prompt_sha256 IS NOT NULL AND passed AND char_length(answer_user_prompt) >= 1 AND char_length(answer_user_prompt) <= 3000000 AND answer_user_prompt_sha256 ~ '^[0-9a-f]{64}$'::text)",
      }])
    } finally {
      await upgrade.dispose()
    }
  })

  it('expands the research timeout ceiling without changing the applied 0008 migration', async () => {
    const upgrade = await createPostgresTestDatabase('research_timeout_upgrade')
    try {
      const timeoutMigrationIndex = durableWebChessMigrations.findIndex(
        (migration) => migration.id === '0009_expand_research_timeout_ceiling',
      )
      const priorMigrations = durableWebChessMigrations.slice(
        0,
        timeoutMigrationIndex,
      )
      await runMigrations(upgrade.adapter, priorMigrations)
      await upgrade.adapter.query({
        text: `
          INSERT INTO user_controls (clerk_user_id)
          VALUES ('user_research_timeout_upgrade')
        `,
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO games (
            id, clerk_user_id, status, problem, problem_sha256,
            event_version, rules_version, engine_version, cast_version,
            software_version
          )
          VALUES (
            '65000000-0000-4000-8000-000000000001',
            'user_research_timeout_upgrade', 'dividing',
            'Which current facts require a bounded local research window?',
            repeat('a', 64), 1, 'rules-test', 'engine-test',
            'cast-test', 'software-test'
          )
        `,
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO research_requests (
            id, clerk_user_id, game_id, stage, policy_version,
            reason, status, result_limit, source_limit, timeout_ms,
            synthesis_character_limit, completed_at
          )
          VALUES (
            '65000000-0000-4000-8000-000000000002',
            'user_research_timeout_upgrade',
            '65000000-0000-4000-8000-000000000001',
            'portia', 'research-policy-timeout-upgrade-test',
            'No search is needed for this migration fixture.',
            'not_needed', 5, 5, 60000, 12000, now()
          )
        `,
      })

      await expect(
        runMigrations(
          upgrade.adapter,
          durableWebChessMigrations.slice(0, timeoutMigrationIndex + 1),
        ),
      ).resolves.toEqual({
        applied: ['0009_expand_research_timeout_ceiling'],
        alreadyApplied: priorMigrations.map((migration) => migration.id),
      })

      await expect(
        upgrade.adapter.query({
          text: `
          UPDATE research_requests
          SET timeout_ms = 120000
          WHERE id = '65000000-0000-4000-8000-000000000002'
        `,
        }),
      ).resolves.toMatchObject({ rowCount: 1 })
      await expect(
        upgrade.adapter.query({
          text: `
          UPDATE research_requests
          SET timeout_ms = 120001
          WHERE id = '65000000-0000-4000-8000-000000000002'
        `,
        }),
      ).rejects.toMatchObject({
        constraint: 'research_requests_timeout_valid',
      })

      const persisted = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT timeout_ms
          FROM research_requests
          WHERE id = '65000000-0000-4000-8000-000000000002'
        `,
      })
      expect(persisted.rows).toEqual([{ timeout_ms: 120000 }])
    } finally {
      await upgrade.dispose()
    }
  })

  it('extends the research broker envelope beyond the provider search window', async () => {
    const upgrade = await createPostgresTestDatabase(
      'research_timeout_envelope_upgrade',
    )
    try {
      const envelopeMigrationIndex = durableWebChessMigrations.findIndex(
        (migration) => migration.id === '0011_extend_research_timeout_ceiling',
      )
      const priorMigrations = durableWebChessMigrations.slice(
        0,
        envelopeMigrationIndex,
      )
      await runMigrations(upgrade.adapter, priorMigrations)
      await upgrade.adapter.query({
        text: `
          INSERT INTO user_controls (clerk_user_id)
          VALUES ('user_research_timeout_envelope_upgrade')
        `,
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO games (
            id, clerk_user_id, status, problem, problem_sha256,
            event_version, rules_version, engine_version, cast_version,
            software_version
          )
          VALUES (
            '65000000-0000-4000-8000-000000000011',
            'user_research_timeout_envelope_upgrade', 'dividing',
            'Which current facts need a complete bounded research envelope?',
            repeat('b', 64), 1, 'rules-test', 'engine-test',
            'cast-test', 'software-test'
          )
        `,
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO research_requests (
            id, clerk_user_id, game_id, stage, policy_version,
            reason, status, result_limit, source_limit, timeout_ms,
            synthesis_character_limit, completed_at
          )
          VALUES (
            '65000000-0000-4000-8000-000000000012',
            'user_research_timeout_envelope_upgrade',
            '65000000-0000-4000-8000-000000000011',
            'portia', 'research-policy-envelope-upgrade-test',
            'No search is needed for this migration fixture.',
            'not_needed', 5, 5, 120000, 12000, now()
          )
        `,
      })

      await expect(
        runMigrations(
          upgrade.adapter,
          durableWebChessMigrations.slice(0, envelopeMigrationIndex + 1),
        ),
      ).resolves.toEqual({
        applied: ['0011_extend_research_timeout_ceiling'],
        alreadyApplied: priorMigrations.map((migration) => migration.id),
      })

      await expect(
        upgrade.adapter.query({
          text: `
          UPDATE research_requests
          SET timeout_ms = 150000
          WHERE id = '65000000-0000-4000-8000-000000000012'
        `,
        }),
      ).resolves.toMatchObject({ rowCount: 1 })
      await expect(
        upgrade.adapter.query({
          text: `
          UPDATE research_requests
          SET timeout_ms = 150001
          WHERE id = '65000000-0000-4000-8000-000000000012'
        `,
        }),
      ).rejects.toMatchObject({
        constraint: 'research_requests_timeout_valid',
      })
    } finally {
      await upgrade.dispose()
    }
  })

  it('extends only the persisted research timeout ceiling to five minutes', async () => {
    const upgrade = await createPostgresTestDatabase(
      'research_timeout_five_minute_upgrade',
    )
    try {
      const fiveMinuteMigrationIndex = durableWebChessMigrations.findIndex(
        (migration) =>
          migration.id === '0016_extend_research_timeout_to_five_minutes',
      )
      const priorMigrations = durableWebChessMigrations.slice(
        0,
        fiveMinuteMigrationIndex,
      )
      await runMigrations(upgrade.adapter, priorMigrations)
      await upgrade.adapter.query({
        text: `
          INSERT INTO user_controls (clerk_user_id)
          VALUES ('user_research_timeout_five_minute_upgrade')
        `,
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO games (
            id, clerk_user_id, status, problem, problem_sha256,
            event_version, rules_version, engine_version, cast_version,
            software_version
          )
          VALUES (
            '65000000-0000-4000-8000-000000000021',
            'user_research_timeout_five_minute_upgrade', 'dividing',
            'Which facts need a bounded five-minute research allowance?',
            repeat('c', 64), 1, 'rules-test', 'engine-test',
            'cast-test', 'software-test'
          )
        `,
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO research_requests (
            id, clerk_user_id, game_id, stage, policy_version,
            reason, status, result_limit, source_limit, timeout_ms,
            synthesis_character_limit, completed_at
          )
          VALUES (
            '65000000-0000-4000-8000-000000000022',
            'user_research_timeout_five_minute_upgrade',
            '65000000-0000-4000-8000-000000000021',
            'portia', 'research-policy-five-minute-upgrade-test',
            'No search is needed for this migration fixture.',
            'not_needed', 5, 5, 150000, 12000, now()
          )
        `,
      })

      const constraintsBefore = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT conname, pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
          WHERE conrelid = 'research_requests'::regclass
            AND conname <> 'research_requests_timeout_valid'
          ORDER BY conname
        `,
      })

      await expect(
        runMigrations(
          upgrade.adapter,
          durableWebChessMigrations.slice(0, fiveMinuteMigrationIndex + 1),
        ),
      ).resolves.toEqual({
        applied: ['0016_extend_research_timeout_to_five_minutes'],
        alreadyApplied: priorMigrations.map((migration) => migration.id),
      })

      await expect(
        upgrade.adapter.query({
          text: `
            UPDATE research_requests
            SET timeout_ms = 300000
            WHERE id = '65000000-0000-4000-8000-000000000022'
          `,
        }),
      ).resolves.toMatchObject({ rowCount: 1 })
      await expect(
        upgrade.adapter.query({
          text: `
            UPDATE research_requests
            SET timeout_ms = 300001
            WHERE id = '65000000-0000-4000-8000-000000000022'
          `,
        }),
      ).rejects.toMatchObject({
        constraint: 'research_requests_timeout_valid',
      })

      const constraintsAfter = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT conname, pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
          WHERE conrelid = 'research_requests'::regclass
            AND conname <> 'research_requests_timeout_valid'
          ORDER BY conname
        `,
      })
      expect(constraintsAfter.rows).toEqual(constraintsBefore.rows)

      const persisted = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT timeout_ms
          FROM research_requests
          WHERE id = '65000000-0000-4000-8000-000000000022'
        `,
      })
      expect(persisted.rows).toEqual([{ timeout_ms: 300000 }])
    } finally {
      await upgrade.dispose()
    }
  })

  it('upgrades legacy lifecycles without relabelling them and guards current directional evidence', async () => {
    const upgrade = await createPostgresTestDatabase(
      'trajectory_directional_record_upgrade',
    )
    try {
      const directionalMigrationIndex = durableWebChessMigrations.findIndex(
        (migration) =>
          migration.id === '0017_trajectory_directional_record',
      )
      const priorMigrations = durableWebChessMigrations.slice(
        0,
        directionalMigrationIndex,
      )
      await runMigrations(upgrade.adapter, priorMigrations)
      const owner = 'user_directional_record_migration_upgrade'
      await upgrade.adapter.query({
        text: `INSERT INTO user_controls (clerk_user_id) VALUES ($1::text)`,
        values: [owner],
      })
      await upgrade.adapter.query({
        text: `
          WITH division AS (
            SELECT jsonb_agg('{}'::jsonb) AS items
            FROM generate_series(1, 64)
          )
          INSERT INTO games (
            id, clerk_user_id, is_current, revision, status, problem,
            problem_sha256, division_seed, division_facets, problem_parts,
            division_model, division_prompt_version, division_prompt_sha256,
            division_digest, rules_version, engine_version, cast_version,
            event_version, software_version, outcome, completed_at
          )
          SELECT fixture.id::uuid, $1::text, false, 1, fixture.status,
            'How should this migration preserve exact directional provenance?',
            repeat('a', 64), 'migration-directional-seed',
            division.items, division.items, 'gpt-5.6-sol',
            'webchess-division-v4', repeat('b', 64), repeat('c', 64),
            'circular-direct-king-v1', 'engine-v2',
            'independent-three-shuffle-v1', 1, '2.2.0-rc.1',
            CASE WHEN fixture.status = 'completed'
              THEN '{"winner":null,"reason":"no-progress","completedTurn":80}'::jsonb
              ELSE NULL
            END,
            CASE WHEN fixture.status = 'completed' THEN now() ELSE NULL END
          FROM division
          CROSS JOIN (VALUES
            ('65500000-0000-4000-8000-000000000031', 'completed'),
            ('65500000-0000-4000-8000-000000000032', 'playing')
          ) AS fixture(id, status)
        `,
        values: [owner],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO lifecycle_runs (
            id, clerk_user_id, game_id, root_run_id, state, revision,
            division_seed, cast_seed, trajectory_seed, terminal_fingerprint,
            survivor_set, software_version, lifecycle_version, rules_version,
            engine_version, cast_version, event_version,
            portia_prompt_version, portia_contract_version,
            gate_algorithm_version, retry_policy_version,
            charlotte_prompt_version, charlotte_contract_version,
            wilbur_record_version
          )
          VALUES
            ('65500000-0000-4000-8001-000000000031', $1::text,
             '65500000-0000-4000-8000-000000000031',
             '65500000-0000-4000-8001-000000000031', 'chess_terminal', 4,
             'migration-directional-seed', 'migration-cast-seed',
             'migration-trajectory-seed', repeat('f', 64), '[]'::jsonb,
             '2.2.0-rc.1', 'webchess-lifecycle-v2.4',
             'circular-direct-king-v1', 'engine-v2',
             'independent-three-shuffle-v1', 1,
             'webchess-portia-v4', 'webchess-portia-review-v2',
             'webchess-gate-v4', 'webchess-retry-v2',
             'webchess-charlotte-v4', 'webchess-charlotte-result-v1',
             'webchess-wilbur-v1'),
            ('65500000-0000-4000-8001-000000000032', $1::text,
             '65500000-0000-4000-8000-000000000032',
             '65500000-0000-4000-8001-000000000032', 'chess_playing', 7,
             'migration-directional-seed', 'migration-cast-seed',
             'migration-trajectory-seed', NULL, NULL,
             '2.2.0-rc.1', 'webchess-lifecycle-v2.5',
             'circular-direct-king-v1', 'engine-v2',
             'independent-three-shuffle-v1', 1,
             'webchess-portia-v5', 'webchess-portia-review-v3',
             'webchess-gate-v5', 'webchess-retry-v2',
             'webchess-charlotte-v4', 'webchess-charlotte-result-v1',
             'webchess-wilbur-v1')
        `,
        values: [owner],
      })

      await expect(runMigrations(
        upgrade.adapter,
        durableWebChessMigrations.slice(0, directionalMigrationIndex + 1),
      )).resolves.toEqual({
        applied: ['0017_trajectory_directional_record'],
        alreadyApplied: priorMigrations.map((migration) => migration.id),
      })

      const legacy = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT lifecycle_version, terminal_fingerprint,
            trajectory_directional_record_version,
            trajectory_directional_record_digest,
            trajectory_directional_record
          FROM lifecycle_runs
          WHERE id = '65500000-0000-4000-8001-000000000031'
        `,
      })
      expect(legacy.rows).toEqual([{
        lifecycle_version: 'webchess-lifecycle-v2.4',
        terminal_fingerprint: 'f'.repeat(64),
        trajectory_directional_record_version: null,
        trajectory_directional_record_digest: null,
        trajectory_directional_record: null,
      }])

      const directionalConstraints = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'lifecycle_runs'::regclass
            AND conname LIKE 'lifecycle_runs_trajectory_directional_record_%'
          ORDER BY conname
        `,
      })
      expect(directionalConstraints.rows.map((row) => row.conname)).toEqual([
        'lifecycle_runs_trajectory_directional_record_binding_valid',
        'lifecycle_runs_trajectory_directional_record_complete',
        'lifecycle_runs_trajectory_directional_record_provenance_valid',
        'lifecycle_runs_trajectory_directional_record_shape_valid',
      ])
      const lifecycleConstraintCount = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT count(*)::integer AS count
          FROM pg_constraint
          WHERE conrelid = 'lifecycle_runs'::regclass
        `,
      })
      expect(lifecycleConstraintCount.rows).toEqual([{ count: 30 }])

      await expect(upgrade.adapter.query({
        text: `
          UPDATE lifecycle_runs
          SET lifecycle_version = 'webchess-lifecycle-v2.5'
          WHERE id = '65500000-0000-4000-8001-000000000031'
        `,
      })).rejects.toMatchObject({
        constraint:
          'lifecycle_runs_trajectory_directional_record_binding_valid',
      })
      await expect(upgrade.adapter.query({
        text: `
          UPDATE lifecycle_runs
          SET trajectory_directional_record_version =
            'webchess-directional-record-v1'
          WHERE id = '65500000-0000-4000-8001-000000000032'
        `,
      })).rejects.toMatchObject({
        constraint: 'lifecycle_runs_trajectory_directional_record_complete',
      })

      const directionalVersion = 'webchess-directional-record-v1'
      const directionalDigest = '2'.repeat(64)
      const invalidDirectionalRecords = [
        {
          case: 'missing version',
          record: { digest: directionalDigest },
        },
        {
          case: 'missing digest',
          record: { version: directionalVersion },
        },
        {
          case: 'JSON-null version',
          record: { version: null, digest: directionalDigest },
        },
        {
          case: 'JSON-null digest',
          record: { version: directionalVersion, digest: null },
        },
        {
          case: 'non-string version',
          record: { version: 1, digest: directionalDigest },
        },
        {
          case: 'non-string digest',
          record: { version: directionalVersion, digest: 2 },
        },
        {
          case: 'mismatched version',
          record: {
            version: 'webchess-directional-record-v0',
            digest: directionalDigest,
          },
        },
        {
          case: 'mismatched digest',
          record: { version: directionalVersion, digest: '3'.repeat(64) },
        },
      ]
      for (const invalid of invalidDirectionalRecords) {
        await expect(upgrade.adapter.query({
          text: `
            UPDATE lifecycle_runs
            SET state = 'chess_terminal', revision = revision + 1,
              terminal_fingerprint = repeat('1', 64),
              survivor_set = '[]'::jsonb,
              trajectory_directional_record_version = $1::text,
              trajectory_directional_record_digest = $2::char(64),
              trajectory_directional_record = $3::jsonb
            WHERE id = '65500000-0000-4000-8001-000000000032'
          `,
          values: [
            directionalVersion,
            directionalDigest,
            JSON.stringify(invalid.record),
          ],
        }), invalid.case).rejects.toMatchObject({
          constraint:
            'lifecycle_runs_trajectory_directional_record_shape_valid',
        })
      }

      await expect(upgrade.adapter.query({
        text: `
          UPDATE lifecycle_runs
          SET state = 'chess_terminal', revision = revision + 1,
            terminal_fingerprint = repeat('1', 64), survivor_set = '[]'::jsonb,
            trajectory_directional_record_version =
              'webchess-directional-record-v1',
            trajectory_directional_record_digest = repeat('2', 64),
            trajectory_directional_record = jsonb_build_object(
              'version', 'webchess-directional-record-v1',
              'digest', repeat('2', 64),
              'padding', repeat('x', 4000001)
            )
          WHERE id = '65500000-0000-4000-8001-000000000032'
        `,
      })).rejects.toMatchObject({
        constraint: 'lifecycle_runs_trajectory_directional_record_shape_valid',
      })
      await expect(upgrade.adapter.query({
        text: `
          UPDATE lifecycle_runs
          SET state = 'chess_terminal', revision = revision + 1,
            terminal_fingerprint = repeat('1', 64), survivor_set = '[]'::jsonb,
            trajectory_directional_record_version =
              'webchess-directional-record-v1',
            trajectory_directional_record_digest = repeat('2', 64),
            trajectory_directional_record = jsonb_build_object(
              'version', 'webchess-directional-record-v1',
              'digest', repeat('2', 64)
            )
          WHERE id = '65500000-0000-4000-8001-000000000032'
        `,
      })).resolves.toMatchObject({ rowCount: 1 })
      await expect(upgrade.adapter.query({
        text: `
          UPDATE lifecycle_runs
          SET terminal_fingerprint = repeat('3', 64)
          WHERE id = '65500000-0000-4000-8001-000000000032'
        `,
      })).rejects.toMatchObject({ code: '23514' })
    } finally {
      await upgrade.dispose()
    }
  })

  it('backfills legacy research as opted out and enforces the 0015 consent boundary', async () => {
    const upgrade = await createPostgresTestDatabase(
      'direct_page_research_upgrade',
    )
    try {
      const directPageMigrationIndex = durableWebChessMigrations.findIndex(
        (migration) => migration.id === '0015_direct_page_research_evidence',
      )
      const priorMigrations = durableWebChessMigrations.slice(
        0,
        directPageMigrationIndex,
      )
      await runMigrations(upgrade.adapter, priorMigrations)
      await upgrade.adapter.query({
        text: `
          INSERT INTO user_controls (clerk_user_id)
          VALUES ('user_direct_page_research_upgrade')
        `,
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO games (
            id, clerk_user_id, status, problem, problem_sha256,
            event_version, rules_version, engine_version, cast_version,
            software_version
          )
          VALUES (
            '65500000-0000-4000-8000-000000000001',
            'user_direct_page_research_upgrade', 'dividing',
            'How should historical research remain fail closed?',
            repeat('a', 64), 1, 'rules-test', 'engine-test',
            'cast-test', 'software-test'
          )
        `,
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO research_requests (
            id, clerk_user_id, game_id, stage, policy_version,
            reason, status, result_limit, source_limit, timeout_ms,
            synthesis_character_limit, completed_at
          )
          VALUES (
            '65500000-0000-4000-8000-000000000002',
            'user_direct_page_research_upgrade',
            '65500000-0000-4000-8000-000000000001',
            'portia', 'research-policy-direct-page-upgrade-test',
            'No search was run for this historical fixture.',
            'not_needed', 5, 5, 150000, 12000, now()
          )
        `,
      })

      await expect(
        runMigrations(
          upgrade.adapter,
          durableWebChessMigrations.slice(0, directPageMigrationIndex + 1),
        ),
      ).resolves.toEqual({
        applied: ['0015_direct_page_research_evidence'],
        alreadyApplied: priorMigrations.map((migration) => migration.id),
      })

      const backfilled = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT research_consent_version, research_consent_decision,
            research_consent_recorded_at, fetch_failures
          FROM research_requests
          WHERE id = '65500000-0000-4000-8000-000000000002'
        `,
      })
      expect(backfilled.rows).toEqual([{
        research_consent_version: 'legacy-no-research-consent-v0',
        research_consent_decision: 'no_external_research',
        research_consent_recorded_at: null,
        fetch_failures: [],
      }])

      await expect(upgrade.adapter.query({
        text: `
          UPDATE research_requests
          SET research_consent_version = 'webchess-research-consent-v1',
            research_consent_recorded_at = now()
          WHERE id = '65500000-0000-4000-8000-000000000002'
        `,
      })).resolves.toMatchObject({ rowCount: 1 })
      await expect(upgrade.adapter.query({
        text: `
          UPDATE research_requests
          SET status = 'searching', attempt_count = 1,
            query = 'A query must not appear after an explicit opt-out.'
          WHERE id = '65500000-0000-4000-8000-000000000002'
        `,
      })).rejects.toMatchObject({
        constraint: 'research_requests_opt_out_shape',
      })
      await expect(upgrade.adapter.query({
        text: `
          UPDATE research_requests
          SET fetch_failures = '[{},{},{},{}]'::jsonb
          WHERE id = '65500000-0000-4000-8000-000000000002'
        `,
      })).rejects.toMatchObject({
        constraint: 'research_requests_json_shapes',
      })
    } finally {
      await upgrade.dispose()
    }
  })

  it('refreshes only unfinished Charlotte-capable runs while preserving terminal histories and artifacts', async () => {
    const upgrade = await createPostgresTestDatabase('charlotte_upgrade')
    try {
      const boundedCharlotteIndex = durableWebChessMigrations.findIndex(
        (migration) => migration.id === '0007_bounded_charlotte_attempts',
      )
      const priorMigrations = durableWebChessMigrations.slice(
        0,
        boundedCharlotteIndex,
      )
      await runMigrations(
        upgrade.adapter,
        priorMigrations,
      )
      const owner = 'user_charlotte_migration_upgrade'
      await upgrade.adapter.query({
        text: `INSERT INTO user_controls (clerk_user_id) VALUES ($1::text)`,
        values: [owner],
      })
      await upgrade.adapter.query({
        text: `
          WITH division AS (
            SELECT jsonb_agg('{}'::jsonb) AS items
            FROM generate_series(1, 64)
          )
          INSERT INTO games (
            id, clerk_user_id, is_current, revision, status, problem,
            problem_sha256, division_seed, division_facets, problem_parts,
            division_model, division_prompt_version, division_prompt_sha256,
            division_digest, rules_version, engine_version, cast_version,
            event_version, software_version
          )
          SELECT fixture.id::uuid, $1::text, false, 1, 'mapped',
            'How should this migration preserve bounded Charlotte history?',
            repeat('a', 64), 'migration-seed', division.items, division.items,
            'gpt-5.6-sol', 'webchess-division-v2', repeat('b', 64),
            repeat('c', 64), 'rules-v1', 'engine-v1', 'cast-v1', 1, '2.0.0'
          FROM division
          CROSS JOIN (VALUES
            ('66000000-0000-4000-8000-000000000001'),
            ('66000000-0000-4000-8000-000000000002'),
            ('66000000-0000-4000-8000-000000000003')
          ) AS fixture(id)
        `,
        values: [owner],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO lifecycle_runs (
            id, clerk_user_id, game_id, root_run_id, state,
            division_seed, cast_seed, trajectory_seed,
            software_version, lifecycle_version, rules_version,
            engine_version, cast_version, event_version,
            portia_prompt_version, portia_contract_version,
            gate_algorithm_version, retry_policy_version,
            charlotte_prompt_version, charlotte_contract_version,
            wilbur_record_version
          )
          SELECT fixture.id::uuid, $1::text, fixture.game_id::uuid,
            fixture.id::uuid, fixture.state,
            'migration-seed', 'migration-cast', 'migration-trajectory',
            '2.0.0', 'webchess-lifecycle-v2.2', 'rules-v1',
            'engine-v1', 'cast-v1', 1,
            'webchess-portia-v3', 'webchess-portia-review-v2',
            'webchess-gate-v3', 'webchess-retry-v2',
            'webchess-charlotte-v3', 'webchess-charlotte-result-v1',
            'webchess-wilbur-v1'
          FROM (VALUES
            ('67000000-0000-4000-8000-000000000001',
             '66000000-0000-4000-8000-000000000001', 'charlotte_running'),
            ('67000000-0000-4000-8000-000000000002',
             '66000000-0000-4000-8000-000000000002', 'insufficient_basis'),
            ('67000000-0000-4000-8000-000000000003',
             '66000000-0000-4000-8000-000000000003', 'charlotte_complete')
          ) AS fixture(id, game_id, state)
        `,
        values: [owner],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO model_requests (
            id, clerk_user_id, game_id, operation, idempotency_key,
            request_sha256, status, model, prompt_version, software_version,
            provider_started_at, completed_at, response_sha256, result_payload
          )
          VALUES
            ('68000000-0000-4000-8000-000000000001', $1::text,
             '66000000-0000-4000-8000-000000000001', 'charlotte',
             '68000000-0000-4000-8001-000000000001', repeat('1', 64),
             'in_progress', 'gpt-5.6-sol', 'webchess-charlotte-v3',
             '2.0.0', now(), NULL, NULL, NULL),
            ('68000000-0000-4000-8000-000000000002', $1::text,
             '66000000-0000-4000-8000-000000000003', 'charlotte',
             '68000000-0000-4000-8001-000000000002', repeat('2', 64),
             'succeeded', 'gpt-5.6-sol', 'webchess-charlotte-v3',
             '2.0.0', now(), now(), repeat('3', 64), '{}'::jsonb)
        `,
        values: [owner],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO charlotte_results (
            id, clerk_user_id, lifecycle_run_id, model_request_id,
            input_digest, output_digest, prompt_version, contract_version,
            result, rendered_answer
          )
          VALUES (
            '69000000-0000-4000-8000-000000000001', $1::text,
            '67000000-0000-4000-8000-000000000003',
            '68000000-0000-4000-8000-000000000002',
            repeat('2', 64), repeat('3', 64), 'webchess-charlotte-v3',
            'webchess-charlotte-result-v1', '{}'::jsonb,
            repeat('Historical Charlotte result remains immutable. ', 3)
          )
        `,
        values: [owner],
      })

      await expect(
        runMigrations(upgrade.adapter, durableWebChessMigrations),
      ).resolves.toEqual({
        applied: [
          '0007_bounded_charlotte_attempts',
          '0008_visible_research_broker',
          '0009_expand_research_timeout_ceiling',
          '0010_player_visible_answer_prompt',
          '0011_extend_research_timeout_ceiling',
          '0012_unique_wilbur_charlotte_actions',
          '0013_wilbur_mutation_requests',
          '0014_web_memory_feedback',
          '0015_direct_page_research_evidence',
          '0016_extend_research_timeout_to_five_minutes',
          '0017_trajectory_directional_record',
          '0018_align_answer_prompt_durable_limit',
          '0019_durable_answer_operation_deadline',
        ],
        alreadyApplied: priorMigrations.map((migration) => migration.id),
      })

      const runs = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT state, lifecycle_version, charlotte_prompt_version,
            charlotte_active_model_request_id,
            charlotte_failed_attempt_count, charlotte_failure_limit
          FROM lifecycle_runs
          WHERE clerk_user_id = $1::text
          ORDER BY game_id
        `,
        values: [owner],
      })
      expect(runs.rows).toEqual([
        {
          state: 'charlotte_pending',
          lifecycle_version: 'webchess-lifecycle-v2.3',
          charlotte_prompt_version: 'webchess-charlotte-v4',
          charlotte_active_model_request_id: null,
          charlotte_failed_attempt_count: 0,
          charlotte_failure_limit: 3,
        },
        {
          state: 'insufficient_basis',
          lifecycle_version: 'webchess-lifecycle-v2.2',
          charlotte_prompt_version: 'webchess-charlotte-v3',
          charlotte_active_model_request_id: null,
          charlotte_failed_attempt_count: 0,
          charlotte_failure_limit: 3,
        },
        {
          state: 'charlotte_complete',
          lifecycle_version: 'webchess-lifecycle-v2.2',
          charlotte_prompt_version: 'webchess-charlotte-v3',
          charlotte_active_model_request_id: null,
          charlotte_failed_attempt_count: 0,
          charlotte_failure_limit: 3,
        },
      ])
      const preserved = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT
            (SELECT count(*)::integer FROM model_requests) AS request_count,
            (SELECT count(*)::integer FROM charlotte_results) AS result_count,
            (SELECT prompt_version FROM charlotte_results LIMIT 1) AS result_prompt
        `,
      })
      expect(preserved.rows).toEqual([
        {
          request_count: 2,
          result_count: 1,
          result_prompt: 'webchess-charlotte-v3',
        },
      ])
    } finally {
      await upgrade.dispose()
    }
  })

  it('preserves legacy Wilbur rows while binding and freezing every new Charlotte action', async () => {
    const upgrade = await createPostgresTestDatabase(
      'wilbur_charlotte_binding_upgrade',
    )
    try {
      const bindingMigrationIndex = durableWebChessMigrations.findIndex(
        (migration) => migration.id === '0012_unique_wilbur_charlotte_actions',
      )
      const priorMigrations = durableWebChessMigrations.slice(
        0,
        bindingMigrationIndex,
      )
      await runMigrations(upgrade.adapter, priorMigrations)

      const owner = 'user_wilbur_binding_migration'
      const gameId = '71000000-0000-4000-8000-000000000001'
      const runId = '71000000-0000-4000-8000-000000000002'
      const legacyActionId = '71000000-0000-4000-8000-000000000003'
      await upgrade.adapter.query({
        text: `
          INSERT INTO user_controls (clerk_user_id)
          VALUES ($1::text)
        `,
        values: [owner],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO games (
            id, clerk_user_id, status, problem, problem_sha256,
            event_version, rules_version, engine_version, cast_version,
            software_version
          )
          VALUES (
            $1::uuid, $2::text, 'dividing',
            'How should this migration preserve a legacy Wilbur action?',
            repeat('a', 64), 1, 'rules-test', 'engine-test',
            'cast-test', 'software-test'
          )
        `,
        values: [gameId, owner],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO lifecycle_runs (
            id, clerk_user_id, game_id, root_run_id, state,
            division_seed, cast_seed, trajectory_seed,
            software_version, lifecycle_version, rules_version,
            engine_version, cast_version, event_version,
            portia_prompt_version, portia_contract_version,
            gate_algorithm_version, retry_policy_version,
            charlotte_prompt_version, charlotte_contract_version,
            wilbur_record_version
          )
          VALUES (
            $1::uuid, $2::text, $3::uuid, $1::uuid, 'wilbur_planning',
            'division-seed', 'cast-seed', 'trajectory-seed',
            'software-test', 'lifecycle-test', 'rules-test',
            'engine-test', 'cast-test', 1,
            'portia-prompt-test', 'portia-contract-test',
            'gate-test', 'retry-test', 'charlotte-prompt-test',
            'charlotte-contract-test', 'wilbur-record-test'
          )
        `,
        values: [runId, owner, gameId],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO wilbur_actions (
            id, clerk_user_id, lifecycle_run_id, charlotte_action_index,
            idempotency_key, request_digest, actor, action,
            tested_assumption, expected_observation, decision_threshold,
            review_horizon, status, record_version
          )
          VALUES (
            $1::uuid, $2::text, $3::uuid, 0,
            '71000000-0000-4000-8000-000000000004', repeat('b', 64),
            'Legacy owner', 'Run the legacy bounded action.',
            'The legacy action tests a bounded assumption.',
            'The legacy action records one direct observation.',
            'Continue only if the declared legacy threshold is met.',
            'Within one week', 'planned', 'wilbur-record-test'
          )
        `,
        values: [legacyActionId, owner, runId],
      })

      await expect(
        runMigrations(upgrade.adapter, durableWebChessMigrations),
      ).resolves.toEqual({
        applied: [
          '0012_unique_wilbur_charlotte_actions',
          '0013_wilbur_mutation_requests',
          '0014_web_memory_feedback',
          '0015_direct_page_research_evidence',
          '0016_extend_research_timeout_to_five_minutes',
          '0017_trajectory_directional_record',
          '0018_align_answer_prompt_durable_limit',
          '0019_durable_answer_operation_deadline',
        ],
        alreadyApplied: priorMigrations.map((migration) => migration.id),
      })

      const legacy = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT charlotte_binding_version
          FROM wilbur_actions
          WHERE id = $1::uuid
        `,
        values: [legacyActionId],
      })
      expect(legacy.rows).toEqual([{ charlotte_binding_version: null }])

      await expect(
        upgrade.adapter.query({
          text: `
          UPDATE wilbur_actions
          SET status = 'in_progress', revision = revision + 1,
            updated_at = now()
          WHERE id = $1::uuid
        `,
          values: [legacyActionId],
        }),
      ).resolves.toMatchObject({ rowCount: 1 })
      await expect(
        upgrade.adapter.query({
          text: `
          UPDATE wilbur_actions
          SET actor = 'Rewritten owner'
          WHERE id = $1::uuid
        `,
          values: [legacyActionId],
        }),
      ).rejects.toMatchObject({ code: '23514' })
      await expect(
        upgrade.adapter.query({
          text: `
          UPDATE wilbur_actions
          SET charlotte_binding_version =
            'webchess-charlotte-action-binding-v1'
          WHERE id = $1::uuid
        `,
          values: [legacyActionId],
        }),
      ).rejects.toMatchObject({ code: '23514' })

      const insertCurrent = (
        id: string,
        idempotencyKey: string,
        actionIndex: number | null,
        bindingVersion: string | null,
        status = 'planned',
        revision = 0,
      ) =>
        upgrade.adapter.query({
          text: `
          INSERT INTO wilbur_actions (
            id, clerk_user_id, lifecycle_run_id, charlotte_action_index,
            idempotency_key, request_digest, actor, action,
            tested_assumption, expected_observation, decision_threshold,
            review_horizon, status, record_version,
            charlotte_binding_version, revision
          )
          VALUES (
            $1::uuid, $2::text, $3::uuid, $4::smallint,
            $5::uuid, repeat('c', 64),
            'Current owner', 'Run the current bounded action.',
            'The current action tests a bounded assumption.',
            'The current action records one direct observation.',
            'Continue only if the declared current threshold is met.',
            'Within one week', $7::text, 'wilbur-record-test', $6::text,
            $8::bigint
          )
        `,
          values: [
            id,
            owner,
            runId,
            actionIndex,
            idempotencyKey,
            bindingVersion,
            status,
            revision,
          ],
        })

      const currentActionId = '71000000-0000-4000-8000-000000000005'
      await expect(
        insertCurrent(
          currentActionId,
          '71000000-0000-4000-8000-000000000006',
          0,
          null,
        ),
      ).resolves.toMatchObject({ rowCount: 1 })
      const current = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT charlotte_binding_version
          FROM wilbur_actions
          WHERE id = $1::uuid
        `,
        values: [currentActionId],
      })
      expect(current.rows).toEqual([
        {
          charlotte_binding_version: 'webchess-charlotte-action-binding-v1',
        },
      ])

      for (const assignment of [
        "id = '71000000-0000-4000-8000-000000000099'::uuid",
        "clerk_user_id = 'rewritten_owner'",
        "lifecycle_run_id = '71000000-0000-4000-8000-000000000098'::uuid",
        'charlotte_action_index = 1',
        'charlotte_binding_version = NULL',
        "idempotency_key = '71000000-0000-4000-8000-000000000097'::uuid",
        "request_digest = repeat('d', 64)",
        "actor = 'Rewritten owner'",
        "action = 'Rewrite the bounded action.'",
        "tested_assumption = 'Rewrite the tested assumption.'",
        "expected_observation = 'Rewrite the expected observation.'",
        "decision_threshold = 'Rewrite the decision threshold.'",
        "review_horizon = 'Within two weeks'",
        "record_version = 'rewritten-record-version'",
        "created_at = created_at - interval '1 second'",
      ]) {
        await expect(
          upgrade.adapter.query({
            text: `
            UPDATE wilbur_actions
            SET ${assignment}, revision = revision + 1,
              updated_at = now()
            WHERE id = $1::uuid
          `,
            values: [currentActionId],
          }),
        ).rejects.toMatchObject({ code: '23514' })
      }

      for (const assignment of [
        'revision = revision',
        'revision = revision + 2',
        "revision = revision + 1, updated_at = updated_at - interval '1 second'",
      ]) {
        await expect(
          upgrade.adapter.query({
            text: `
              UPDATE wilbur_actions
              SET status = 'in_progress', ${assignment}
              WHERE id = $1::uuid
            `,
            values: [currentActionId],
          }),
        ).rejects.toMatchObject({ code: '23514' })
      }

      await expect(
        insertCurrent(
          '71000000-0000-4000-8000-000000000007',
          '71000000-0000-4000-8000-000000000008',
          0,
          null,
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'wilbur_actions_one_per_charlotte_suggestion',
      })
      await expect(
        insertCurrent(
          '71000000-0000-4000-8000-000000000009',
          '71000000-0000-4000-8000-000000000010',
          null,
          null,
        ),
      ).rejects.toMatchObject({ code: '23514' })
      await expect(
        insertCurrent(
          '71000000-0000-4000-8000-000000000011',
          '71000000-0000-4000-8000-000000000012',
          1,
          'obsolete-binding-version',
        ),
      ).rejects.toMatchObject({ code: '23514' })
      await expect(
        insertCurrent(
          '71000000-0000-4000-8000-000000000014',
          '71000000-0000-4000-8000-000000000015',
          2,
          null,
          'completed',
        ),
      ).rejects.toMatchObject({ code: '23514' })
      await expect(
        insertCurrent(
          '71000000-0000-4000-8000-000000000016',
          '71000000-0000-4000-8000-000000000017',
          3,
          null,
          'planned',
          1,
        ),
      ).rejects.toMatchObject({ code: '23514' })

      const mutationKey = '71000000-0000-4000-8000-000000000013'
      await upgrade.adapter.query({
        text: `
          INSERT INTO wilbur_mutation_requests (
            clerk_user_id, idempotency_key, operation, request_digest,
            target_game_id, rate_kind, reserved_future_rows,
            reserved_text_bytes
          )
          VALUES (
            $1::text, $2::uuid, 'create_action', repeat('d', 64),
            $3::uuid, 'action', 2, 256
          )
        `,
        values: [owner, mutationKey, gameId],
      })

      for (const assignment of [
        "clerk_user_id = 'rewritten_owner'",
        "idempotency_key = '71000000-0000-4000-8000-000000000018'::uuid",
        "operation = 'update_action'",
        "request_digest = repeat('e', 64)",
        "target_game_id = '71000000-0000-4000-8000-000000000019'::uuid",
        `target_action_id = '${currentActionId}'::uuid`,
        "rate_kind = 'observation'",
        "created_at = created_at - interval '1 second'",
      ]) {
        await expect(
          upgrade.adapter.query({
            text: `
              UPDATE wilbur_mutation_requests
              SET ${assignment}
              WHERE clerk_user_id = $1::text
                AND idempotency_key = $2::uuid
            `,
            values: [owner, mutationKey],
          }),
        ).rejects.toMatchObject({ code: '23514' })
      }

      for (const reservation of [255, 257]) {
        await expect(
          upgrade.adapter.query({
            text: `
              UPDATE wilbur_mutation_requests
              SET reserved_text_bytes = $3::bigint
              WHERE clerk_user_id = $1::text
                AND idempotency_key = $2::uuid
            `,
            values: [owner, mutationKey, reservation],
          }),
        ).rejects.toMatchObject({ code: '23514' })
      }

      await expect(
        upgrade.adapter.query({
          text: `
            UPDATE wilbur_mutation_requests
            SET updated_at = updated_at - interval '1 second'
            WHERE clerk_user_id = $1::text
              AND idempotency_key = $2::uuid
          `,
          values: [owner, mutationKey],
        }),
      ).rejects.toMatchObject({ code: '23514' })

      await expect(
        upgrade.adapter.query({
          text: `
          UPDATE wilbur_mutation_requests
          SET rate_admitted_at = now(), status = 'committed',
            result_entity_id = $3::uuid, result_revision = 0,
            result_status = 'planned', result_updated_at = now(),
            reserved_future_rows = 0, reserved_text_bytes = 0,
            updated_at = now()
          WHERE clerk_user_id = $1::text
            AND idempotency_key = $2::uuid
        `,
          values: [owner, mutationKey, currentActionId],
        }),
      ).rejects.toMatchObject({ code: '23514' })

      await expect(
        upgrade.adapter.query({
          text: `
            UPDATE wilbur_mutation_requests
            SET rate_admitted_at = now(), updated_at = now()
            WHERE clerk_user_id = $1::text
              AND idempotency_key = $2::uuid
          `,
          values: [owner, mutationKey],
        }),
      ).resolves.toMatchObject({ rowCount: 1 })

      await expect(
        upgrade.adapter.query({
          text: `
            UPDATE wilbur_mutation_requests
            SET rate_admitted_at = rate_admitted_at + interval '1 second',
              updated_at = now()
            WHERE clerk_user_id = $1::text
              AND idempotency_key = $2::uuid
          `,
          values: [owner, mutationKey],
        }),
      ).rejects.toMatchObject({ code: '23514' })

      await expect(
        upgrade.adapter.query({
          text: `
            UPDATE wilbur_mutation_requests
            SET status = 'committed',
              result_entity_id = $3::uuid, result_revision = 0,
              result_status = 'planned', result_updated_at = now(),
              reserved_future_rows = 0, reserved_text_bytes = 0,
              updated_at = now()
            WHERE clerk_user_id = $1::text
              AND idempotency_key = $2::uuid
          `,
          values: [owner, mutationKey, currentActionId],
        }),
      ).resolves.toMatchObject({ rowCount: 1 })

      await expect(
        upgrade.adapter.query({
          text: `
            UPDATE wilbur_mutation_requests
            SET status = 'pending', result_entity_id = NULL,
              result_revision = NULL, result_status = NULL,
              result_updated_at = NULL, reserved_future_rows = 2,
              reserved_text_bytes = 256, updated_at = now()
            WHERE clerk_user_id = $1::text
              AND idempotency_key = $2::uuid
          `,
          values: [owner, mutationKey],
        }),
      ).rejects.toMatchObject({ code: '23514' })

      await expect(
        upgrade.adapter.query({
          text: `
            UPDATE wilbur_mutation_requests
            SET result_status = 'completed', updated_at = now()
            WHERE clerk_user_id = $1::text
              AND idempotency_key = $2::uuid
          `,
          values: [owner, mutationKey],
        }),
      ).rejects.toMatchObject({ code: '23514' })

      await expect(
        upgrade.adapter.query({
          text: `
            INSERT INTO wilbur_mutation_requests (
              clerk_user_id, idempotency_key, operation, request_digest,
              target_game_id, rate_kind, rate_admitted_at,
              reserved_future_rows, reserved_text_bytes
            )
            VALUES (
              $1::text, '71000000-0000-4000-8000-000000000020',
              'create_action', repeat('f', 64), $2::uuid, 'action', now(),
              2, 256
            )
          `,
          values: [owner, gameId],
        }),
      ).rejects.toMatchObject({ code: '23514' })

      await expect(
        upgrade.adapter.query({
          text: `
            INSERT INTO wilbur_mutation_requests (
              clerk_user_id, idempotency_key, operation, request_digest,
              target_game_id, rate_kind, rate_admitted_at,
              reserved_future_rows, reserved_text_bytes, status,
              result_entity_id, result_revision, result_status,
              result_updated_at
            )
            VALUES (
              $1::text, '71000000-0000-4000-8000-000000000021',
              'create_action', repeat('f', 64), $2::uuid, 'action', now(),
              0, 0, 'committed', $3::uuid, 0, 'planned', now()
            )
          `,
          values: [owner, gameId, currentActionId],
        }),
      ).rejects.toMatchObject({ code: '23514' })

      await expect(
        upgrade.adapter.query({
          text: `
            INSERT INTO wilbur_mutation_requests (
              clerk_user_id, idempotency_key, operation, request_digest,
              target_game_id, rate_kind, denial_code,
              reserved_future_rows, reserved_text_bytes, status
            )
            VALUES (
              $1::text, '71000000-0000-4000-8000-000000000022',
              'create_action', repeat('f', 64), $2::uuid, 'action',
              'quota_exceeded', 0, 0, 'denied'
            )
          `,
          values: [owner, gameId],
        }),
      ).rejects.toMatchObject({ code: '23514' })

      await upgrade.adapter.query({
        text: `DELETE FROM games WHERE id = $1::uuid`,
        values: [gameId],
      })
      const cascaded = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT count(*)::integer AS mutation_count
          FROM wilbur_mutation_requests
          WHERE clerk_user_id = $1::text
        `,
        values: [owner],
      })
      expect(cascaded.rows).toEqual([{ mutation_count: 0 }])
    } finally {
      await upgrade.dispose()
    }
  })

  it('upgrades exact 0013 state into owner-scoped Web memory with replay-safe follow-ups', async () => {
    const upgrade = await createPostgresTestDatabase('web_memory_upgrade')
    try {
      const webMemoryMigrationIndex = durableWebChessMigrations.findIndex(
        (migration) => migration.id === '0014_web_memory_feedback',
      )
      expect(webMemoryMigrationIndex).toBeGreaterThan(0)
      const priorMigrations = durableWebChessMigrations.slice(
        0,
        webMemoryMigrationIndex,
      )
      const webMemoryUpgradeMigrations = durableWebChessMigrations.slice(
        0,
        webMemoryMigrationIndex + 1,
      )
      await runMigrations(upgrade.adapter, priorMigrations)

      const owner = 'user_web_memory_upgrade'
      const otherOwner = 'user_web_memory_upgrade_other'
      const targetGameId = '73000000-0000-4000-8000-000000000001'
      const sourceGameId = '73000000-0000-4000-8000-000000000002'
      const otherGameId = '73000000-0000-4000-8000-000000000003'
      const sourceRunId = '73000000-0000-4000-8000-000000000004'
      const otherRunId = '73000000-0000-4000-8000-000000000005'
      const sourceActionId = '73000000-0000-4000-8000-000000000006'
      const otherActionId = '73000000-0000-4000-8000-000000000007'
      const oldMutationKey = '73000000-0000-4000-8000-000000000008'
      const newMutationKey = '73000000-0000-4000-8000-000000000009'
      const followUpAt = '2026-09-15T19:00:00.000Z'

      await upgrade.adapter.query({
        text: `
          INSERT INTO user_controls (clerk_user_id)
          VALUES ($1::text), ($2::text)
        `,
        values: [owner, otherOwner],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO games (
            id, clerk_user_id, is_current, status, problem, problem_sha256,
            event_version, rules_version, engine_version, cast_version,
            software_version
          )
          VALUES
            ($1::uuid, $4::text, true, 'dividing',
             'How should a later case use selected prior observations?',
             repeat('a', 64), 1, 'rules-test', 'engine-test',
             'cast-test', 'software-test'),
            ($2::uuid, $4::text, false, 'dividing',
             'How can one bounded trial generate useful direct evidence?',
             repeat('b', 64), 1, 'rules-test', 'engine-test',
             'cast-test', 'software-test'),
            ($3::uuid, $5::text, true, 'dividing',
             'How should another owner preserve a separate observation?',
             repeat('c', 64), 1, 'rules-test', 'engine-test',
             'cast-test', 'software-test')
        `,
        values: [
          targetGameId,
          sourceGameId,
          otherGameId,
          owner,
          otherOwner,
        ],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO lifecycle_runs (
            id, clerk_user_id, game_id, root_run_id, state,
            division_seed, cast_seed, trajectory_seed,
            software_version, lifecycle_version, rules_version,
            engine_version, cast_version, event_version,
            portia_prompt_version, portia_contract_version,
            gate_algorithm_version, retry_policy_version,
            charlotte_prompt_version, charlotte_contract_version,
            wilbur_record_version
          )
          VALUES
            ($1::uuid, $3::text, $5::uuid, $1::uuid, 'wilbur_observed',
             'division-seed', 'cast-seed', 'trajectory-seed',
             'software-test', 'lifecycle-test', 'rules-test',
             'engine-test', 'cast-test', 1,
             'portia-test', 'portia-contract-test', 'gate-test',
             'retry-test', 'charlotte-test', 'charlotte-contract-test',
             'wilbur-record-test'),
            ($2::uuid, $4::text, $6::uuid, $2::uuid, 'wilbur_observed',
             'division-seed', 'cast-seed', 'trajectory-seed',
             'software-test', 'lifecycle-test', 'rules-test',
             'engine-test', 'cast-test', 1,
             'portia-test', 'portia-contract-test', 'gate-test',
             'retry-test', 'charlotte-test', 'charlotte-contract-test',
             'wilbur-record-test')
        `,
        values: [
          sourceRunId,
          otherRunId,
          owner,
          otherOwner,
          sourceGameId,
          otherGameId,
        ],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO wilbur_actions (
            id, clerk_user_id, lifecycle_run_id, charlotte_action_index,
            idempotency_key, request_digest, actor, action,
            tested_assumption, expected_observation, decision_threshold,
            review_horizon, status, record_version
          )
          VALUES
            ($1::uuid, $3::text, $5::uuid, 0,
             '73000000-0000-4000-8000-000000000010', repeat('d', 64),
             'The accountable owner',
             'Run one limited observation without expanding the scope.',
             'A reversible trial can produce a useful signal safely.',
             'A measurable signal appears inside the review horizon.',
             'Continue only when the declared signal appears.',
             'Within fourteen days', 'planned', 'wilbur-record-test'),
            ($2::uuid, $4::text, $6::uuid, 0,
             '73000000-0000-4000-8000-000000000011', repeat('e', 64),
             'The other accountable owner',
             'Run one separate observation for the other owner.',
             'A separate trial can produce a useful private signal.',
             'A separate measurable signal appears during the review.',
             'Continue only when the separate declared signal appears.',
             'Within fourteen days', 'planned', 'wilbur-record-test')
        `,
        values: [
          sourceActionId,
          otherActionId,
          owner,
          otherOwner,
          sourceRunId,
          otherRunId,
        ],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO wilbur_observations (
            id, clerk_user_id, action_id, idempotency_key, request_digest,
            observed_at, observation, evidence_classification,
            expected_effect, unexpected_effect, stakeholder_response,
            assumption_result, next_decision, record_version
          )
          SELECT
            ('74000000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid,
            $1::text, $2::uuid,
            ('75000000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid,
            repeat('f', 64), now(),
            'The bounded observation produced a direct useful signal.',
            'Measured result',
            'The expected signal appeared inside the review horizon.',
            'One participant requested a clearer explanation.',
            'Participants retained agency and reported no lasting harm.',
            'supported',
            'Repeat once with broader stakeholder review before scaling.',
            'wilbur-record-test'
          FROM generate_series(1, 9) AS item
        `,
        values: [owner, sourceActionId],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO wilbur_observations (
            id, clerk_user_id, action_id, idempotency_key, request_digest,
            observed_at, observation, evidence_classification,
            expected_effect, unexpected_effect, stakeholder_response,
            assumption_result, next_decision, record_version
          )
          VALUES (
            '76000000-0000-4000-8000-000000000001', $1::text, $2::uuid,
            '76000000-0000-4000-8000-000000000002', repeat('a', 64), now(),
            'The other owner recorded a separate private observation.',
            'Measured result', 'The other expected signal appeared.',
            'No unexpected effect was reported.',
            'The other stakeholders retained agency.', 'supported',
            'Keep the other observation private.', 'wilbur-record-test'
          )
        `,
        values: [otherOwner, otherActionId],
      })
      await upgrade.adapter.query({
        text: `
          INSERT INTO wilbur_mutation_requests (
            clerk_user_id, idempotency_key, operation, request_digest,
            target_game_id, target_action_id, rate_kind,
            reserved_future_rows, reserved_text_bytes
          )
          VALUES
            ($1::text, $2::uuid, 'update_action', repeat('b', 64),
             $4::uuid, $5::uuid, 'action', 1, 0),
            ($1::text, $3::uuid, 'update_action', repeat('c', 64),
             $4::uuid, $5::uuid, 'action', 1, 0)
        `,
        values: [
          owner,
          oldMutationKey,
          newMutationKey,
          sourceGameId,
          sourceActionId,
        ],
      })
      await upgrade.adapter.query({
        text: `
          UPDATE wilbur_mutation_requests
          SET rate_admitted_at = now(), updated_at = now()
          WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid
        `,
        values: [owner, oldMutationKey],
      })
      await upgrade.adapter.query({
        text: `
          UPDATE wilbur_mutation_requests
          SET status = 'committed', result_entity_id = $3::uuid,
            result_revision = 0, result_status = 'planned',
            result_updated_at = now(), reserved_future_rows = 0,
            updated_at = now()
          WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid
        `,
        values: [owner, oldMutationKey, sourceActionId],
      })

      await expect(
        runMigrations(upgrade.adapter, webMemoryUpgradeMigrations),
      ).resolves.toEqual({
        applied: ['0014_web_memory_feedback'],
        alreadyApplied: priorMigrations.map((migration) => migration.id),
      })

      const legacySnapshot = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT result_follow_up_at
          FROM wilbur_mutation_requests
          WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid
        `,
        values: [owner, oldMutationKey],
      })
      expect(legacySnapshot.rows).toEqual([{ result_follow_up_at: null }])

      await expect(upgrade.adapter.query({
        text: `
          UPDATE wilbur_actions
          SET follow_up_at = $2::timestamptz, revision = revision + 1,
            updated_at = greatest(updated_at, now())
          WHERE id = $1::uuid
        `,
        values: [sourceActionId, followUpAt],
      })).resolves.toMatchObject({ rowCount: 1 })
      await expect(upgrade.adapter.query({
        text: `
          UPDATE wilbur_actions
          SET action = 'Rewrite immutable historical action text.',
            revision = revision + 1, updated_at = greatest(updated_at, now())
          WHERE id = $1::uuid
        `,
        values: [sourceActionId],
      })).rejects.toMatchObject({ code: '23514' })

      await upgrade.adapter.query({
        text: `
          UPDATE wilbur_mutation_requests
          SET rate_admitted_at = now(), updated_at = now()
          WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid
        `,
        values: [owner, newMutationKey],
      })
      await upgrade.adapter.query({
        text: `
          UPDATE wilbur_mutation_requests
          SET status = 'committed', result_entity_id = $3::uuid,
            result_revision = 1, result_status = 'planned',
            result_follow_up_at = $4::timestamptz,
            result_updated_at = now(), reserved_future_rows = 0,
            updated_at = now()
          WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid
        `,
        values: [owner, newMutationKey, sourceActionId, followUpAt],
      })
      const currentSnapshot = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT result_revision, result_status,
            to_char(
              result_follow_up_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ) AS result_follow_up_at
          FROM wilbur_mutation_requests
          WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid
        `,
        values: [owner, newMutationKey],
      })
      expect(currentSnapshot.rows).toEqual([{
        result_revision: '1',
        result_status: 'planned',
        result_follow_up_at: followUpAt,
      }])

      await upgrade.adapter.query({
        text: `
          INSERT INTO web_memory_links (
            id, clerk_user_id, target_game_id, source_observation_id,
            selection_ordinal, consent_version
          )
          SELECT gen_random_uuid(), $1::text, $2::uuid,
            ('74000000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid,
            item - 1, 'webchess-web-memory-consent-v1'
          FROM generate_series(1, 8) AS item
        `,
        values: [owner, targetGameId],
      })
      const linked = await upgrade.adapter.query<SqlRow>({
        text: `
          SELECT count(*)::integer AS link_count,
            array_agg(selection_ordinal ORDER BY selection_ordinal) AS ordinals
          FROM web_memory_links
          WHERE target_game_id = $1::uuid
        `,
        values: [targetGameId],
      })
      expect(linked.rows).toEqual([{
        link_count: 8,
        ordinals: [0, 1, 2, 3, 4, 5, 6, 7],
      }])

      const linkAttempt = (
        targetId: string,
        observationId: string,
        ordinal: number,
      ) => upgrade.adapter.query({
        text: `
          INSERT INTO web_memory_links (
            id, clerk_user_id, target_game_id, source_observation_id,
            selection_ordinal, consent_version
          )
          VALUES (
            gen_random_uuid(), $1::text, $2::uuid, $3::uuid, $4::smallint,
            'webchess-web-memory-consent-v1'
          )
        `,
        values: [owner, targetId, observationId, ordinal],
      })
      await expect(linkAttempt(
        targetGameId,
        '74000000-0000-4000-8000-000000000009',
        8,
      )).rejects.toMatchObject({
        code: '23514',
        constraint: 'web_memory_links_selection_ordinal_valid',
      })
      await expect(linkAttempt(
        targetGameId,
        '74000000-0000-4000-8000-000000000009',
        7,
      )).rejects.toMatchObject({
        code: '23505',
        constraint: 'web_memory_links_target_game_id_selection_ordinal_key',
      })
      await expect(linkAttempt(
        sourceGameId,
        '76000000-0000-4000-8000-000000000001',
        0,
      )).rejects.toMatchObject({
        code: '23503',
        constraint: 'web_memory_links_source_owner_fkey',
      })
      await expect(linkAttempt(
        otherGameId,
        '74000000-0000-4000-8000-000000000009',
        0,
      )).rejects.toMatchObject({
        code: '23503',
        constraint: 'web_memory_links_target_owner_fkey',
      })
    } finally {
      await upgrade.dispose()
    }
  })

  it('installs the release uniqueness and Charlotte-binding boundaries', async () => {
    const indexes = await database.adapter.query<SqlRow>({
      text: `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname IN (
            'games_one_current_per_user',
            'model_requests_one_succeeded_operation_per_game',
            'wilbur_actions_one_per_charlotte_suggestion',
            'wilbur_mutation_requests_pkey'
          )
        ORDER BY indexname
      `,
    })

    expect(indexes.rows).toHaveLength(4)
    const byName = Object.fromEntries(
      indexes.rows.map((row) => [String(row.indexname), String(row.indexdef)]),
    )
    expect(byName.games_one_current_per_user).toContain('WHERE is_current')
    expect(byName.model_requests_one_succeeded_operation_per_game).toContain(
      "WHERE ((game_id IS NOT NULL) AND (status = 'succeeded'::text))",
    )
    expect(byName.wilbur_actions_one_per_charlotte_suggestion).toContain(
      'UNIQUE INDEX wilbur_actions_one_per_charlotte_suggestion',
    )
    expect(byName.wilbur_actions_one_per_charlotte_suggestion).toContain(
      '(lifecycle_run_id, charlotte_action_index)',
    )
    expect(byName.wilbur_actions_one_per_charlotte_suggestion).toContain(
      "WHERE (charlotte_binding_version = 'webchess-charlotte-action-binding-v1'::text)",
    )
    expect(byName.wilbur_mutation_requests_pkey).toContain(
      'UNIQUE INDEX wilbur_mutation_requests_pkey',
    )
    expect(byName.wilbur_mutation_requests_pkey).toContain(
      '(clerk_user_id, idempotency_key)',
    )

    const binding = await database.adapter.query<SqlRow>({
      text: `
        SELECT
          columns.is_nullable,
          triggers.tgenabled,
          procedures.proname,
          languages.lanname,
          pg_catalog.pg_get_function_result(procedures.oid)
            AS function_result
        FROM information_schema.columns AS columns
        JOIN pg_catalog.pg_class AS relations
          ON relations.relname = columns.table_name
        JOIN pg_catalog.pg_namespace AS namespaces
          ON namespaces.oid = relations.relnamespace
          AND namespaces.nspname = columns.table_schema
        JOIN pg_catalog.pg_trigger AS triggers
          ON triggers.tgrelid = relations.oid
          AND triggers.tgname =
            'wilbur_actions_charlotte_binding_guard'
        JOIN pg_catalog.pg_proc AS procedures
          ON procedures.oid = triggers.tgfoid
        JOIN pg_catalog.pg_language AS languages
          ON languages.oid = procedures.prolang
        WHERE columns.table_schema = current_schema()
          AND columns.table_name = 'wilbur_actions'
          AND columns.column_name = 'charlotte_binding_version'
      `,
    })
    expect(binding.rows).toEqual([
      {
        is_nullable: 'YES',
        tgenabled: 'O',
        proname: 'webchess_guard_wilbur_charlotte_binding',
        lanname: 'plpgsql',
        function_result: 'trigger',
      },
    ])
  })

  it('enforces persisted replay-version and event-shape constraints', async () => {
    await database.adapter.query({
      text: `
        INSERT INTO user_controls (clerk_user_id)
        VALUES ('user_migration_constraints')
      `,
    })

    await expect(
      database.adapter.query({
        text: `
          INSERT INTO games (
            id,
            clerk_user_id,
            status,
            problem,
            problem_sha256,
            event_version,
            rules_version,
            engine_version,
            cast_version,
            software_version
          )
          VALUES (
            '10000000-0000-4000-8000-000000000001',
            'user_migration_constraints',
            'dividing',
            'A sufficiently long integration problem',
            repeat('a', 64),
            0,
            'rules-test',
            'engine-test',
            'cast-test',
            'software-test'
          )
        `,
      }),
    ).rejects.toMatchObject({
      constraint: 'games_event_version_positive',
    })

    await database.adapter.query({
      text: `
        INSERT INTO games (
          id,
          clerk_user_id,
          status,
          problem,
          problem_sha256,
          event_version,
          rules_version,
          engine_version,
          cast_version,
          software_version
        )
        VALUES (
          '10000000-0000-4000-8000-000000000001',
          'user_migration_constraints',
          'dividing',
          'A sufficiently long integration problem',
          repeat('a', 64),
          1,
          'rules-test',
          'engine-test',
          'cast-test',
          'software-test'
        )
      `,
    })

    await expect(
      database.adapter.query({
        text: `
          INSERT INTO game_events (
            game_id,
            ply,
            kind,
            source,
            side,
            game_revision
          )
          VALUES (
            '10000000-0000-4000-8000-000000000001',
            1,
            'pass',
            'client',
            'white',
            1
          )
        `,
      }),
    ).rejects.toMatchObject({
      constraint: 'game_events_source_integrity',
    })

    await database.adapter.query({
      text: `
        INSERT INTO game_events (
          game_id,
          ply,
          kind,
          source,
          side,
          game_revision
        )
        VALUES (
          '10000000-0000-4000-8000-000000000001',
          1,
          'pass',
          'server',
          'white',
          1
        )
      `,
    })
    const persistedPass = await database.adapter.query({
      text: `
        SELECT
          kind,
          source,
          piece_id,
          idempotency_key,
          request_sha256
        FROM game_events
        WHERE game_id = '10000000-0000-4000-8000-000000000001'
          AND ply = 1
      `,
    })
    expect(persistedPass.rows).toEqual([
      {
        kind: 'pass',
        source: 'server',
        piece_id: null,
        idempotency_key: null,
        request_sha256: null,
      },
    ])

    await expect(
      database.adapter.query({
        text: `
          INSERT INTO game_events (
            game_id,
            ply,
            kind,
            source,
            side,
            piece_id,
            from_ring,
            from_sector,
            to_ring,
            to_sector,
            idempotency_key,
            request_sha256,
            game_revision
          )
          VALUES (
            '10000000-0000-4000-8000-000000000001',
            2,
            'move',
            'client',
            'white',
            'white-pawn-1',
            NULL,
            0,
            4,
            0,
            '10000000-0000-4000-8000-000000000004',
            repeat('c', 64),
            2
          )
        `,
      }),
    ).rejects.toMatchObject({
      constraint: 'game_events_move_or_pass_shape',
    })

    await expect(
      database.adapter.query({
        text: `
          INSERT INTO game_events (
            game_id,
            ply,
            kind,
            source,
            side,
            piece_id,
            from_ring,
            from_sector,
            to_ring,
            to_sector,
            idempotency_key,
            request_sha256,
            game_revision
          )
          VALUES (
            '10000000-0000-4000-8000-000000000001',
            3,
            'move',
            'client',
            'white',
            'white-pawn-1',
            5,
            0,
            4,
            0,
            '10000000-0000-4000-8000-000000000005',
            NULL,
            3
          )
        `,
      }),
    ).rejects.toMatchObject({
      constraint: 'game_events_source_integrity',
    })

    await expect(
      database.adapter.query({
        text: `
          INSERT INTO model_requests (
            id,
            clerk_user_id,
            operation,
            idempotency_key,
            request_sha256,
            status,
            model,
            prompt_version,
            software_version,
            input_tokens
          )
          VALUES (
            '10000000-0000-4000-8000-000000000002',
            'user_migration_constraints',
            'division',
            '10000000-0000-4000-8000-000000000003',
            repeat('b', 64),
            'reserved',
            'gpt-5.6-sol',
            'division-v1',
            'integration-test',
            1
          )
        `,
      }),
    ).rejects.toMatchObject({
      constraint: 'model_requests_usage_fields_match_reported',
    })
  })
})
