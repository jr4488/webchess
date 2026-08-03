import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { SqlRow } from '../../src/server/db'
import { runMigrations } from '../../src/server/db/migrations'
import {
  createPostgresTestDatabase,
  durableWebChessMigrations,
} from './postgres-test-database'
import type { PostgresTestDatabase } from './postgres-test-database'

let database: PostgresTestDatabase

beforeAll(async () => {
  database = await createPostgresTestDatabase('migration')
})

afterAll(async () => {
  await database.dispose()
})

describe('durable WebChess migration on PostgreSQL 17', () => {
  it('applies the canonical migration atomically and replays it idempotently', async () => {
    await expect(database.migrate()).resolves.toEqual({
      applied: [
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
      ],
      alreadyApplied: [],
    })
    await expect(database.migrate()).resolves.toEqual({
      applied: [],
      alreadyApplied: [
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
      ],
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
      'webchess_schema_migrations',
      'wilbur_actions',
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

  it('expands the research timeout ceiling without changing the applied 0008 migration', async () => {
    const upgrade = await createPostgresTestDatabase(
      'research_timeout_upgrade',
    )
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

      await expect(runMigrations(
        upgrade.adapter,
        durableWebChessMigrations.slice(0, timeoutMigrationIndex + 1),
      )).resolves.toEqual({
        applied: ['0009_expand_research_timeout_ceiling'],
        alreadyApplied: priorMigrations.map((migration) => migration.id),
      })

      await expect(upgrade.adapter.query({
        text: `
          UPDATE research_requests
          SET timeout_ms = 120000
          WHERE id = '65000000-0000-4000-8000-000000000002'
        `,
      })).resolves.toMatchObject({ rowCount: 1 })
      await expect(upgrade.adapter.query({
        text: `
          UPDATE research_requests
          SET timeout_ms = 120001
          WHERE id = '65000000-0000-4000-8000-000000000002'
        `,
      })).rejects.toMatchObject({
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

  it('refreshes only unfinished Charlotte-capable runs while preserving terminal histories and artifacts', async () => {
    const upgrade = await createPostgresTestDatabase('charlotte_upgrade')
    try {
      await runMigrations(
        upgrade.adapter,
        durableWebChessMigrations.slice(0, -4),
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

      await expect(runMigrations(
        upgrade.adapter,
        durableWebChessMigrations,
      )).resolves.toEqual({
        applied: [
          '0007_bounded_charlotte_attempts',
          '0008_visible_research_broker',
          '0009_expand_research_timeout_ceiling',
          '0010_player_visible_answer_prompt',
        ],
        alreadyApplied: durableWebChessMigrations
          .slice(0, -4)
          .map((migration) => migration.id),
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
      expect(preserved.rows).toEqual([{
        request_count: 2,
        result_count: 1,
        result_prompt: 'webchess-charlotte-v3',
      }])
    } finally {
      await upgrade.dispose()
    }
  })

  it('installs the current-game and succeeded-operation uniqueness boundaries', async () => {
    const indexes = await database.adapter.query<SqlRow>({
      text: `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname IN (
            'games_one_current_per_user',
            'model_requests_one_succeeded_operation_per_game'
          )
        ORDER BY indexname
      `,
    })

    expect(indexes.rows).toHaveLength(2)
    expect(indexes.rows[0]?.indexdef).toContain(
      'WHERE is_current',
    )
    expect(indexes.rows[1]?.indexdef).toContain(
      "WHERE ((game_id IS NOT NULL) AND (status = 'succeeded'::text))",
    )
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
