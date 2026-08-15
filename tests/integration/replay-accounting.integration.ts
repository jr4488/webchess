import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { composeProblemParts } from '../../src/lib/division'
import { CURRENT_GAME_VERSIONS } from '../../src/lib/game-contract'
import { sha256Hex } from '../../src/server/db'
import {
  computeDivisionDigest,
  DurableGameRepository,
} from '../../src/server/games'
import {
  createUsageController,
} from '../../src/server/usage'
import type {
  ConsumeReplayGameStartInput,
  UsageConfig,
} from '../../src/server/usage'
import { makeProblemFacets } from '../../src/test/fixtures'
import {
  createPostgresTestDatabase,
} from './postgres-test-database'
import type { PostgresTestDatabase } from './postgres-test-database'

const NOW = new Date('2026-07-26T20:45:00.000Z')
const OWNER = 'user_atomic_replay'
const SOURCE_ID = '21000000-0000-4000-8000-000000000001'
const TARGET_ID = '22000000-0000-4000-8000-000000000001'
const OTHER_TARGET_ID = '22000000-0000-4000-8000-000000000002'

const CONFIG: UsageConfig = {
  hmacSecret: 'atomic-replay-rate-secret-material-32-bytes',
  deletionHmacSecret:
    'atomic-replay-deletion-secret-material-32-bytes',
  dailyGameLimit: 20,
  dailyModelRequestLimit: 100,
  dailyGlobalModelRequestLimit: 200,
  hourlyModelRequestLimit: 20,
  hourlyIpModelRequestLimit: 40,
  hourlyGameStartLimit: 20,
  hourlyIpGameStartLimit: 40,
  hourlyGameMoveLimit: 600,
  hourlyIpGameMoveLimit: 1_200,
  hourlyAccountExportLimit: 2,
  hourlyIpAccountExportLimit: 10,
  hourlyWilburActionLimit: 120,
  hourlyIpWilburActionLimit: 240,
  hourlyWilburObservationLimit: 60,
  hourlyIpWilburObservationLimit: 120,
  concurrentModelLimit: 1,
  globalModelConcurrentLimit: 4,
  modelLeaseSeconds: 180,
}

type ReplaySourceStatus =
  | 'completed'
  | 'answering'
  | 'answer_failed'
  | 'answered'
  | 'mapped'

let database: PostgresTestDatabase

beforeEach(async () => {
  database = await createPostgresTestDatabase('atomic_replay')
  await database.migrate()
})

afterEach(async () => {
  await database.dispose()
})

function controller() {
  return createUsageController({
    db: database.adapter,
    config: CONFIG,
    now: () => new Date(NOW),
    randomUuid: () => '23000000-0000-4000-8000-000000000001',
  })
}

function replayInput(
  overrides: Partial<ConsumeReplayGameStartInput> = {},
): ConsumeReplayGameStartInput {
  return {
    userId: OWNER,
    sourceGameId: SOURCE_ID,
    expectedRevision: 7,
    idempotencyKey: TARGET_ID,
    ipAddress: '198.51.100.91',
    ...overrides,
  }
}

async function seedGame(input: {
  readonly id: string
  readonly ownerId?: string
  readonly status: ReplaySourceStatus
  readonly revision?: number
  readonly sourceGameId?: string | null
  readonly isCurrent?: boolean
  readonly problem?: string
}): Promise<void> {
  const ownerId = input.ownerId ?? OWNER
  const problem =
    input.problem ?? 'How can replay creation remain one atomic operation?'
  const problemSha256 = sha256Hex(problem)
  const seed = `atomic-replay/${input.id}`
  const facets = makeProblemFacets('Atomic replay integration facet')
  const parts = composeProblemParts(facets, seed)
  const model = 'gpt-5.6-sol'
  const promptVersion = 'division-v1'
  const promptSha256 = sha256Hex('atomic replay integration prompt')
  const divisionDigest = computeDivisionDigest({
    problemSha256,
    seed,
    facets,
    parts,
    model,
    promptVersion,
    promptSha256,
  })
  const isTerminal = [
    'completed',
    'answering',
    'answer_failed',
    'answered',
  ].includes(input.status)

  await database.adapter.query({
    text: `
      INSERT INTO user_controls (clerk_user_id, last_seen_at, updated_at)
      VALUES ($1::text, $2::timestamptz, $2::timestamptz)
      ON CONFLICT (clerk_user_id) DO NOTHING
    `,
    values: [ownerId, NOW.toISOString()],
  })
  await database.adapter.query({
    text: `
      INSERT INTO games (
        id,
        clerk_user_id,
        source_game_id,
        is_current,
        revision,
        status,
        problem,
        problem_sha256,
        division_seed,
        division_facets,
        problem_parts,
        division_model,
        division_prompt_version,
        division_prompt_sha256,
        division_digest,
        event_version,
        rules_version,
        engine_version,
        cast_version,
        software_version,
        outcome,
        answer_payload,
        created_at,
        updated_at,
        completed_at,
        answered_at
      )
      VALUES (
        $1::uuid,
        $2::text,
        $3::uuid,
        $4::boolean,
        $5::bigint,
        $6::text,
        $7::text,
        $8::text,
        $9::text,
        $10::jsonb,
        $11::jsonb,
        $12::text,
        $13::text,
        $14::text,
        $15::text,
        $16::smallint,
        $17::text,
        $18::text,
        $19::text,
        'integration-test',
        $20::jsonb,
        $21::jsonb,
        $22::timestamptz,
        $22::timestamptz,
        $23::timestamptz,
        $24::timestamptz
      )
    `,
    values: [
      input.id,
      ownerId,
      input.sourceGameId ?? null,
      input.isCurrent ?? true,
      input.revision ?? 7,
      input.status,
      problem,
      problemSha256,
      seed,
      JSON.stringify(facets),
      JSON.stringify(parts),
      model,
      promptVersion,
      promptSha256,
      divisionDigest,
      CURRENT_GAME_VERSIONS.event,
      CURRENT_GAME_VERSIONS.rules,
      CURRENT_GAME_VERSIONS.engine,
      CURRENT_GAME_VERSIONS.cast,
      isTerminal
        ? JSON.stringify({ winner: 'white', reason: 'king_captured' })
        : null,
      input.status === 'answered'
        ? JSON.stringify({
            answer: 'A durable answer.',
            model,
            prompt: 'Answer prompt.',
          })
        : null,
      NOW.toISOString(),
      isTerminal ? NOW.toISOString() : null,
      input.status === 'answered' ? NOW.toISOString() : null,
    ],
  })
}

async function replayState() {
  const result = await database.adapter.query<{
    readonly requests: number
    readonly starts: number
    readonly rate_count: number
    readonly target_count: number
    readonly current_game_id: string | null
  }>({
    text: `
      SELECT
        (
          SELECT count(*)::integer
          FROM game_start_requests
          WHERE clerk_user_id = $1::text
        ) AS requests,
        (
          SELECT coalesce(sum(used), 0)::integer
          FROM usage_buckets
          WHERE
            subject_type = 'user'
            AND subject_key = $1::text
            AND metric = 'game_starts'
        ) AS starts,
        (
          SELECT coalesce(sum(count), 0)::integer
          FROM rate_buckets
          WHERE action = 'game_start'
        ) AS rate_count,
        (
          SELECT count(*)::integer
          FROM games
          WHERE id = $2::uuid
        ) AS target_count,
        (
          SELECT id::text
          FROM games
          WHERE clerk_user_id = $1::text AND is_current
        ) AS current_game_id
    `,
    values: [OWNER, TARGET_ID],
  })
  const row = result.rows[0]
  if (!row) {
    throw new Error('Replay state query returned no row.')
  }
  return row
}

describe('atomic replay accounting against PostgreSQL', () => {
  it('rejects an answering source without creating or charging a child', async () => {
    await seedGame({
      id: SOURCE_ID,
      status: 'answering',
    })

    await expect(
      controller().consumeReplayGameStart(replayInput()),
    ).resolves.toMatchObject({
      ok: false,
      code: 'GAME_INVALID_REPLAY_STATE',
      httpStatus: 409,
    })
    await expect(replayState()).resolves.toEqual({
      requests: 0,
      starts: 0,
      rate_count: 0,
      target_count: 0,
      current_game_id: SOURCE_ID,
    })
  })

  it('rejects a stale source revision without creating or charging a child', async () => {
    await seedGame({
      id: SOURCE_ID,
      status: 'completed',
      revision: 8,
    })

    await expect(
      controller().consumeReplayGameStart(replayInput()),
    ).resolves.toMatchObject({
      ok: false,
      code: 'GAME_REVISION_CONFLICT',
      httpStatus: 409,
    })
    await expect(replayState()).resolves.toEqual({
      requests: 0,
      starts: 0,
      rate_count: 0,
      target_count: 0,
      current_game_id: SOURCE_ID,
    })
  })

  it('leaves the current game and accounting untouched on target collision', async () => {
    await seedGame({
      id: SOURCE_ID,
      status: 'completed',
    })
    await seedGame({
      id: TARGET_ID,
      status: 'mapped',
      revision: 0,
      isCurrent: false,
      problem: 'This pre-existing target must cause an atomic collision.',
    })

    await expect(
      controller().consumeReplayGameStart(replayInput()),
    ).resolves.toMatchObject({
      ok: false,
      code: 'IDEMPOTENCY_CONFLICT',
      httpStatus: 409,
    })
    await expect(replayState()).resolves.toEqual({
      requests: 0,
      starts: 0,
      rate_count: 0,
      target_count: 1,
      current_game_id: SOURCE_ID,
    })
  })

  it('returns the same child on an exact retry without a second debit', async () => {
    await seedGame({
      id: SOURCE_ID,
      status: 'answer_failed',
    })
    const usage = controller()

    await expect(
      usage.consumeReplayGameStart(replayInput()),
    ).resolves.toEqual({
      ok: true,
      kind: 'consumed',
      gameId: TARGET_ID,
    })
    await expect(
      usage.consumeReplayGameStart(replayInput()),
    ).resolves.toEqual({
      ok: true,
      kind: 'existing',
      gameId: TARGET_ID,
    })
    await expect(replayState()).resolves.toEqual({
      requests: 1,
      starts: 1,
      rate_count: 2,
      target_count: 1,
      current_game_id: TARGET_ID,
    })

    const child = await new DurableGameRepository(
      database.adapter,
    ).getOwnedGame(OWNER, TARGET_ID)
    expect(child).toMatchObject({
      id: TARGET_ID,
      sourceGameId: SOURCE_ID,
      isCurrent: true,
      revision: 0,
      status: 'mapped',
      problem: 'How can replay creation remain one atomic operation?',
    })
  })

  it('serializes concurrent identical requests into one debit and one child', async () => {
    await seedGame({
      id: SOURCE_ID,
      status: 'answered',
    })

    const results = await Promise.all([
      controller().consumeReplayGameStart(replayInput()),
      controller().consumeReplayGameStart(replayInput()),
    ])
    expect(results).toEqual(
      expect.arrayContaining([
        {
          ok: true,
          kind: 'consumed',
          gameId: TARGET_ID,
        },
        {
          ok: true,
          kind: 'existing',
          gameId: TARGET_ID,
        },
      ]),
    )
    await expect(replayState()).resolves.toEqual({
      requests: 1,
      starts: 1,
      rate_count: 2,
      target_count: 1,
      current_game_id: TARGET_ID,
    })
  })

  it('finishes activation for a matching durable pending replay without another debit', async () => {
    await seedGame({
      id: SOURCE_ID,
      status: 'completed',
      isCurrent: false,
    })
    await seedGame({
      id: TARGET_ID,
      status: 'mapped',
      revision: 0,
      sourceGameId: SOURCE_ID,
      isCurrent: false,
    })
    await database.adapter.query({
      text: `
        INSERT INTO game_start_requests (
          idempotency_key,
          clerk_user_id,
          kind,
          source_game_id,
          expected_revision,
          created_at,
          updated_at,
          activated_at
        )
        VALUES (
          $1::uuid,
          $2::text,
          'replay',
          $3::uuid,
          7,
          $4::timestamptz,
          $4::timestamptz,
          NULL
        )
      `,
      values: [TARGET_ID, OWNER, SOURCE_ID, NOW.toISOString()],
    })
    await database.adapter.query({
      text: `
        INSERT INTO usage_buckets (
          subject_type,
          subject_key,
          metric,
          bucket_start,
          bucket_seconds,
          used,
          reserved,
          updated_at
        )
        VALUES (
          'user',
          $1::text,
          'game_starts',
          date_trunc('day', $2::timestamptz),
          86400,
          1,
          0,
          $2::timestamptz
        )
      `,
      values: [OWNER, NOW.toISOString()],
    })

    await expect(
      controller().consumeReplayGameStart(replayInput()),
    ).resolves.toEqual({
      ok: true,
      kind: 'existing',
      gameId: TARGET_ID,
    })
    await expect(replayState()).resolves.toEqual({
      requests: 1,
      starts: 1,
      rate_count: 0,
      target_count: 1,
      current_game_id: TARGET_ID,
    })

    const marker = await database.adapter.query<{
      readonly activated: boolean
    }>({
      text: `
        SELECT activated_at IS NOT NULL AS activated
        FROM game_start_requests
        WHERE idempotency_key = $1::uuid
      `,
      values: [TARGET_ID],
    })
    expect(marker.rows).toEqual([{ activated: true }])
  })

  it('returns an abandoned replay retry without recreating a current game', async () => {
    await seedGame({
      id: SOURCE_ID,
      status: 'completed',
    })
    const usage = controller()
    await expect(
      usage.consumeReplayGameStart(replayInput()),
    ).resolves.toEqual({
      ok: true,
      kind: 'consumed',
      gameId: TARGET_ID,
    })

    const repository = new DurableGameRepository(database.adapter)
    await expect(
      repository.abandonGame({
        ownerId: OWNER,
        gameId: TARGET_ID,
        expectedRevision: 0,
        idempotencyKey: OTHER_TARGET_ID,
      }),
    ).resolves.toMatchObject({
      id: TARGET_ID,
      status: 'abandoned',
      isCurrent: false,
    })

    await expect(
      usage.consumeReplayGameStart(replayInput()),
    ).resolves.toEqual({
      ok: true,
      kind: 'existing',
      gameId: TARGET_ID,
    })

    const state = await database.adapter.query<{
      readonly starts: number
      readonly current_count: number
      readonly target_status: string
      readonly target_is_current: boolean
      readonly activated: boolean
    }>({
      text: `
        SELECT
          (
            SELECT sum(used)::integer
            FROM usage_buckets
            WHERE
              subject_type = 'user'
              AND subject_key = $1::text
              AND metric = 'game_starts'
          ) AS starts,
          (
            SELECT count(*)::integer
            FROM games
            WHERE clerk_user_id = $1::text AND is_current
          ) AS current_count,
          (
            SELECT status
            FROM games
            WHERE id = $2::uuid
          ) AS target_status,
          (
            SELECT is_current
            FROM games
            WHERE id = $2::uuid
          ) AS target_is_current,
          (
            SELECT activated_at IS NOT NULL
            FROM game_start_requests
            WHERE idempotency_key = $2::uuid
          ) AS activated
      `,
      values: [OWNER, TARGET_ID],
    })
    expect(state.rows).toEqual([
      {
        starts: 1,
        current_count: 0,
        target_status: 'abandoned',
        target_is_current: false,
        activated: true,
      },
    ])
  })

  it('returns an older replay retry without replacing a newer current game', async () => {
    await seedGame({
      id: SOURCE_ID,
      status: 'completed',
    })
    const usage = controller()
    await expect(
      usage.consumeReplayGameStart(replayInput()),
    ).resolves.toEqual({
      ok: true,
      kind: 'consumed',
      gameId: TARGET_ID,
    })

    await database.adapter.query({
      text: `
        UPDATE games
        SET
          status = 'completed',
          outcome = '{"winner":"white","reason":"king_captured"}'::jsonb,
          completed_at = $2::timestamptz,
          updated_at = $2::timestamptz
        WHERE id = $1::uuid
      `,
      values: [TARGET_ID, NOW.toISOString()],
    })
    await expect(
      usage.consumeReplayGameStart({
        ...replayInput(),
        sourceGameId: TARGET_ID,
        expectedRevision: 0,
        idempotencyKey: OTHER_TARGET_ID,
      }),
    ).resolves.toEqual({
      ok: true,
      kind: 'consumed',
      gameId: OTHER_TARGET_ID,
    })

    const beforeRetry = await database.adapter.query<{
      readonly starts: number
      readonly current_game_id: string
    }>({
      text: `
        SELECT
          (
            SELECT sum(used)::integer
            FROM usage_buckets
            WHERE
              subject_type = 'user'
              AND subject_key = $1::text
              AND metric = 'game_starts'
          ) AS starts,
          (
            SELECT id::text
            FROM games
            WHERE clerk_user_id = $1::text AND is_current
          ) AS current_game_id
      `,
      values: [OWNER],
    })
    expect(beforeRetry.rows).toEqual([
      {
        starts: 2,
        current_game_id: OTHER_TARGET_ID,
      },
    ])

    await expect(
      usage.consumeReplayGameStart(replayInput()),
    ).resolves.toEqual({
      ok: true,
      kind: 'existing',
      gameId: TARGET_ID,
    })

    const afterRetry = await database.adapter.query<{
      readonly starts: number
      readonly current_game_id: string
      readonly older_is_current: boolean
      readonly activated: boolean
    }>({
      text: `
        SELECT
          (
            SELECT sum(used)::integer
            FROM usage_buckets
            WHERE
              subject_type = 'user'
              AND subject_key = $1::text
              AND metric = 'game_starts'
          ) AS starts,
          (
            SELECT id::text
            FROM games
            WHERE clerk_user_id = $1::text AND is_current
          ) AS current_game_id,
          (
            SELECT is_current
            FROM games
            WHERE id = $2::uuid
          ) AS older_is_current,
          (
            SELECT activated_at IS NOT NULL
            FROM game_start_requests
            WHERE idempotency_key = $2::uuid
          ) AS activated
      `,
      values: [OWNER, TARGET_ID],
    })
    expect(afterRetry.rows).toEqual([
      {
        starts: 2,
        current_game_id: OTHER_TARGET_ID,
        older_is_current: false,
        activated: true,
      },
    ])
  })

  it('does not let a mismatched retry mutate the successful replay', async () => {
    await seedGame({
      id: SOURCE_ID,
      status: 'completed',
    })
    const usage = controller()
    await expect(
      usage.consumeReplayGameStart(replayInput()),
    ).resolves.toMatchObject({
      ok: true,
      kind: 'consumed',
      gameId: TARGET_ID,
    })

    await expect(
      usage.consumeReplayGameStart(
        replayInput({
          expectedRevision: 8,
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'IDEMPOTENCY_CONFLICT',
      httpStatus: 409,
    })
    await expect(
      usage.consumeReplayGameStart(
        replayInput({
          idempotencyKey: OTHER_TARGET_ID,
        }),
      ),
    ).resolves.toMatchObject({
      ok: true,
      kind: 'consumed',
      gameId: OTHER_TARGET_ID,
    })

    const result = await database.adapter.query<{
      readonly requests: number
      readonly starts: number
      readonly current_game_id: string
    }>({
      text: `
        SELECT
          (
            SELECT count(*)::integer
            FROM game_start_requests
            WHERE clerk_user_id = $1::text
          ) AS requests,
          (
            SELECT sum(used)::integer
            FROM usage_buckets
            WHERE
              subject_type = 'user'
              AND subject_key = $1::text
              AND metric = 'game_starts'
          ) AS starts,
          (
            SELECT id::text
            FROM games
            WHERE clerk_user_id = $1::text AND is_current
          ) AS current_game_id
      `,
      values: [OWNER],
    })
    expect(result.rows).toEqual([
      {
        requests: 2,
        starts: 2,
        current_game_id: OTHER_TARGET_ID,
      },
    ])
  })
})
