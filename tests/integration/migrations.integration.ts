import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { SqlRow } from '../../src/server/db'
import {
  createPostgresTestDatabase,
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
      applied: ['0001_durable_webchess'],
      alreadyApplied: [],
    })
    await expect(database.migrate()).resolves.toEqual({
      applied: [],
      alreadyApplied: ['0001_durable_webchess'],
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
      'deleted_user_tombstones',
      'game_events',
      'game_start_requests',
      'games',
      'model_concurrency_slots',
      'model_requests',
      'rate_buckets',
      'usage_buckets',
      'user_controls',
      'webchess_schema_migrations',
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
