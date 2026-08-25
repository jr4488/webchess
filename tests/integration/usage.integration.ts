import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'

import { composeProblemParts } from '../../src/lib/division'
import { RESEARCH_CONSENT_VERSION } from '../../src/lib/research'
import { DurableGameRepository } from '../../src/server/games'
import {
  createUsageController,
  hashDeletedUserKey,
} from '../../src/server/usage'
import type { UsageConfig } from '../../src/server/usage'
import { makeProblemFacets } from '../../src/test/fixtures'
import {
  createPostgresTestDatabase,
} from './postgres-test-database'
import type { PostgresTestDatabase } from './postgres-test-database'

const NOW = new Date('2026-07-26T19:12:34.000Z')
const OWNER = 'user_usage_integration'
const OTHER_OWNER = 'user_usage_integration_other'
const REQUEST_ID = '11000000-0000-4000-8000-000000000001'
const OTHER_REQUEST_ID = '11000000-0000-4000-8000-000000000002'
const THIRD_REQUEST_ID = '11000000-0000-4000-8000-000000000003'
const FOURTH_REQUEST_ID = '11000000-0000-4000-8000-000000000004'
const FIFTH_REQUEST_ID = '11000000-0000-4000-8000-000000000005'
const SIXTH_REQUEST_ID = '11000000-0000-4000-8000-000000000006'
const IDEMPOTENCY_KEY = '12000000-0000-4000-8000-000000000001'
const OTHER_IDEMPOTENCY_KEY = '12000000-0000-4000-8000-000000000002'
const THIRD_IDEMPOTENCY_KEY = '12000000-0000-4000-8000-000000000003'
const FOURTH_IDEMPOTENCY_KEY = '12000000-0000-4000-8000-000000000004'
const FIFTH_IDEMPOTENCY_KEY = '12000000-0000-4000-8000-000000000005'
const SIXTH_IDEMPOTENCY_KEY = '12000000-0000-4000-8000-000000000006'
const LEASE_TOKEN = '13000000-0000-4000-8000-000000000001'
const MATURE_GAME_ID = '14000000-0000-4000-8000-000000000001'
const MATURE_RUN_ID = '14000000-0000-4000-8000-000000000002'
const MATURE_PORTIA_REQUEST_ID = '14000000-0000-4000-8000-000000000003'
const MATURE_CHARLOTTE_REQUEST_ID = '14000000-0000-4000-8000-000000000004'
const MATURE_PORTIA_REVIEW_ID = '14000000-0000-4000-8000-000000000005'
const MATURE_GATE_ID = '14000000-0000-4000-8000-000000000006'
const MATURE_CHARLOTTE_RESULT_ID = '14000000-0000-4000-8000-000000000007'
const MATURE_ACTIVE_REQUEST_ID = '14000000-0000-4000-8000-000000000008'
const MATURE_ACTIVE_LEASE_TOKEN = '14000000-0000-4000-8000-000000000009'
const WILBUR_RATE_ACTION_ID = '14000000-0000-4000-8000-00000000000a'
const SHA256 = 'a'.repeat(64)
const NO_EXTERNAL_RESEARCH_CONSENT = {
  version: RESEARCH_CONSENT_VERSION,
  decision: 'no_external_research' as const,
}

let wilburRateKeySequence = 0

const DEFAULT_CONFIG: UsageConfig = {
  hmacSecret: 'integration-secret-material-32-bytes-minimum',
  deletionHmacSecret:
    'integration-deletion-secret-material-32-bytes-minimum',
  dailyGameLimit: 10,
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

let database: PostgresTestDatabase

beforeEach(async () => {
  database = await createPostgresTestDatabase('usage')
  await database.migrate()
  wilburRateKeySequence = 0
})

afterEach(async () => {
  await database.dispose()
})

function controller(
  config: UsageConfig = DEFAULT_CONFIG,
  now: (() => Date) | null = () => new Date(NOW),
) {
  const dependencies = {
    db: database.adapter,
    config,
    randomUuid: () => LEASE_TOKEN,
  }
  return createUsageController(
    now === null ? dependencies : { ...dependencies, now },
  )
}

async function holdUsageReservationLock(): Promise<{
  release(): Promise<void>
}> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for the lock-wait regression.')
  }
  const client = new Client({
    connectionString,
    options: `-c search_path=${database.schema},public`,
  })
  await client.connect()
  await client.query('BEGIN')
  await client.query(`
    SELECT pg_advisory_xact_lock(
      hashtextextended('webchess-usage-reservation-v1', 0)
    )
  `)
  let released = false
  return {
    async release() {
      if (released) return
      released = true
      try {
        await client.query('COMMIT')
      } finally {
        await client.end()
      }
    },
  }
}

async function waitUntilAfter(deadline: Date): Promise<void> {
  const delay = Math.max(0, deadline.valueOf() - Date.now() + 100)
  await new Promise((resolve) => setTimeout(resolve, delay))
}

function divisionReservation(
  overrides: Partial<Parameters<
    ReturnType<typeof controller>['reserveModelRequest']
  >[0]> = {},
) {
  return {
    requestId: REQUEST_ID,
    gameId: null,
    userId: OWNER,
    operation: 'division' as const,
    idempotencyKey: IDEMPOTENCY_KEY,
    requestSha256: SHA256,
    provider: 'openai',
    model: 'gpt-5.6-sol',
    promptVersion: 'division-v1',
    softwareVersion: 'integration-test',
    countsAsGameStart: true,
    ipAddress: '203.0.113.10',
    ...overrides,
  }
}

function answerReservation(
  overrides: Partial<Parameters<
    ReturnType<typeof controller>['reserveModelRequest']
  >[0]> = {},
) {
  return divisionReservation({
    gameId: MATURE_GAME_ID,
    operation: 'answer',
    promptVersion: 'answer-v1',
    countsAsGameStart: false,
    operationDeadlineAt: new Date(NOW.valueOf() + 300_000),
    leaseExpiresAtCap: new Date(NOW.valueOf() + 335_000),
    ...overrides,
  })
}

async function createDivisionShell(
  ownerId: string,
  gameId: string,
  problem: string,
) {
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
      INSERT INTO model_requests (
        id,
        clerk_user_id,
        game_id,
        operation,
        idempotency_key,
        request_sha256,
        status,
        provider,
        model,
        prompt_version,
        software_version,
        created_at,
        updated_at
      )
      VALUES (
        $1::uuid,
        $2::text,
        NULL,
        'division',
        $1::uuid,
        $3::text,
        'reserved',
        'openai',
        'gpt-5.6-sol',
        'division-v1',
        'integration-test',
        $4::timestamptz,
        $4::timestamptz
      )
    `,
    values: [gameId, ownerId, SHA256, NOW.toISOString()],
  })
  const games = new DurableGameRepository(database.adapter)
  const created = await games.getOrCreateDivision({
    ownerId,
    gameId,
    problem,
    softwareVersion: 'integration-test',
    researchConsent: NO_EXTERNAL_RESEARCH_CONSENT,
  })
  await database.adapter.query({
    text: `
      DELETE FROM model_requests
      WHERE id = $1::uuid
    `,
    values: [gameId],
  })
  return created
}

async function createTerminalReplaySource(
  ownerId: string,
  gameId: string,
  problem: string,
): Promise<void> {
  await createDivisionShell(ownerId, gameId, problem)
  const facets = makeProblemFacets('Replay integration facet')
  const seed = `replay-integration/${gameId}`
  const parts = composeProblemParts(facets, seed)
  await database.adapter.query({
    text: `
      UPDATE games
      SET
        status = 'completed',
        division_seed = $2::text,
        division_facets = $3::jsonb,
        problem_parts = $4::jsonb,
        division_model = 'gpt-5.6-sol',
        division_prompt_version = 'division-v1',
        division_prompt_sha256 = $5::text,
        division_digest = $6::text,
        outcome = '{"winner":"white","reason":"king_captured"}'::jsonb,
        completed_at = $7::timestamptz,
        updated_at = $7::timestamptz
      WHERE id = $1::uuid
    `,
    values: [
      gameId,
      seed,
      JSON.stringify(facets),
      JSON.stringify(parts),
      'b'.repeat(64),
      'c'.repeat(64),
      NOW.toISOString(),
    ],
  })
}

async function createMatureLifecycleArtifacts(): Promise<void> {
  await createTerminalReplaySource(
    OWNER,
    MATURE_GAME_ID,
    'How should mature lifecycle data survive until account deletion commits?',
  )
  await database.adapter.query({
    text: `
      INSERT INTO model_requests (
        id, clerk_user_id, game_id, operation, idempotency_key,
        request_sha256, status, provider, model, prompt_version,
        software_version, result_payload, completed_at, created_at, updated_at
      )
      VALUES
        (
          $1::uuid, $3::text, $4::uuid, 'portia', $1::uuid,
          $5::text, 'succeeded', 'openai', 'gpt-5.6-sol',
          'webchess-portia-v3', 'integration-test', '{}'::jsonb,
          $6::timestamptz, $6::timestamptz, $6::timestamptz
        ),
        (
          $2::uuid, $3::text, $4::uuid, 'charlotte', $2::uuid,
          $5::text, 'succeeded', 'openai', 'gpt-5.6-sol',
          'webchess-charlotte-v4', 'integration-test', '{}'::jsonb,
          $6::timestamptz, $6::timestamptz, $6::timestamptz
        )
    `,
    values: [
      MATURE_PORTIA_REQUEST_ID,
      MATURE_CHARLOTTE_REQUEST_ID,
      OWNER,
      MATURE_GAME_ID,
      SHA256,
      NOW.toISOString(),
    ],
  })
  await database.adapter.query({
    text: `
      INSERT INTO lifecycle_runs (
        id, clerk_user_id, game_id, root_run_id, state,
        division_seed, cast_seed, trajectory_seed,
        software_version, lifecycle_version, rules_version, engine_version,
        cast_version, event_version, portia_prompt_version,
        portia_contract_version, gate_algorithm_version, retry_policy_version,
        charlotte_prompt_version, charlotte_contract_version,
        wilbur_record_version
      )
      VALUES (
        $1::uuid, $2::text, $3::uuid, $1::uuid, 'charlotte_complete',
        'mature-division', 'mature-cast', 'mature-trajectory',
        'integration-test', 'webchess-lifecycle-v2.3', 'rules-v1', 'engine-v1',
        'cast-v1', 1, 'webchess-portia-v3',
        'webchess-portia-review-v2', 'webchess-gate-v3', 'retry-v1',
        'webchess-charlotte-v4', 'charlotte-contract-v1', 'wilbur-record-v1'
      )
    `,
    values: [MATURE_RUN_ID, OWNER, MATURE_GAME_ID],
  })
  await database.adapter.query({
    text: `
      INSERT INTO portia_reviews (
        id, clerk_user_id, lifecycle_run_id, model_request_id,
        input_digest, output_digest, prompt_version, contract_version, review
      )
      VALUES (
        $1::uuid, $2::text, $3::uuid, $4::uuid,
        $5::text, $6::text, 'webchess-portia-v3',
        'webchess-portia-review-v2', '{}'::jsonb
      )
    `,
    values: [
      MATURE_PORTIA_REVIEW_ID,
      OWNER,
      MATURE_RUN_ID,
      MATURE_PORTIA_REQUEST_ID,
      'd'.repeat(64),
      'e'.repeat(64),
    ],
  })
  await database.adapter.query({
    text: `
      INSERT INTO gate_decisions (
        id, clerk_user_id, lifecycle_run_id, algorithm_version,
        input_digest, passed, result
      )
      VALUES (
        $1::uuid, $2::text, $3::uuid, 'webchess-gate-v3',
        $4::text, true, '{}'::jsonb
      )
    `,
    values: [MATURE_GATE_ID, OWNER, MATURE_RUN_ID, 'd'.repeat(64)],
  })
  await database.adapter.query({
    text: `
      INSERT INTO charlotte_results (
        id, clerk_user_id, lifecycle_run_id, model_request_id,
        input_digest, output_digest, prompt_version, contract_version,
        result, rendered_answer
      )
      VALUES (
        $1::uuid, $2::text, $3::uuid, $4::uuid,
        $5::text, $6::text, 'webchess-charlotte-v4',
        'charlotte-contract-v1', '{}'::jsonb, $7::text
      )
    `,
    values: [
      MATURE_CHARLOTTE_RESULT_ID,
      OWNER,
      MATURE_RUN_ID,
      MATURE_CHARLOTTE_REQUEST_ID,
      'd'.repeat(64),
      'e'.repeat(64),
      'A mature Charlotte qualification remains immutable until the account owner requests complete deletion. '.repeat(2),
    ],
  })
}

async function createWilburRateTargets(): Promise<void> {
  await createMatureLifecycleArtifacts()
  await database.adapter.query({
    text: `
      INSERT INTO wilbur_actions (
        id, clerk_user_id, lifecycle_run_id, charlotte_action_index,
        idempotency_key, request_digest, actor, action,
        tested_assumption, expected_observation, decision_threshold,
        review_horizon, status, revision, record_version, created_at, updated_at
      )
      VALUES (
        $1::uuid, $2::text, $3::uuid, 0,
        $1::uuid, $4::char(64), 'Integration owner',
        'Run one bounded integration observation.',
        'The shared rate bucket remains isolated.',
        'One durable observation is recorded.',
        'Stop if the expected signal is absent.',
        'One integration window', 'planned', 0,
        'wilbur-record-v1', $5::timestamptz, $5::timestamptz
      )
    `,
    values: [
      WILBUR_RATE_ACTION_ID,
      OWNER,
      MATURE_RUN_ID,
      SHA256,
      NOW.toISOString(),
    ],
  })
}

async function claimWilburRateMutation(input: {
  readonly userId?: string
  readonly ipAddress: string
  readonly kind: 'action' | 'observation'
  readonly operation?: 'create_action' | 'append_observation'
  readonly idempotencyKey?: string
  readonly requestDigest?: string
  readonly ledgerTimestamp?: Date
}) {
  const userId = input.userId ?? OWNER
  const operation = input.operation ?? (
    input.kind === 'action' ? 'create_action' : 'append_observation'
  )
  const idempotencyKey = input.idempotencyKey ??
    `16000000-0000-4000-8000-${String(++wilburRateKeySequence).padStart(12, '0')}`
  const requestDigest = input.requestDigest ?? SHA256
  await database.adapter.query({
    text: `
      INSERT INTO user_controls (clerk_user_id, last_seen_at, updated_at)
      VALUES ($1::text, $2::timestamptz, $2::timestamptz)
      ON CONFLICT (clerk_user_id) DO NOTHING
    `,
    values: [userId, NOW.toISOString()],
  })
  await database.adapter.query({
    text: `
      INSERT INTO wilbur_mutation_requests (
        clerk_user_id, idempotency_key, operation, request_digest,
        target_game_id, target_action_id, rate_kind,
        reserved_future_rows, reserved_text_bytes, created_at, updated_at
      )
      VALUES (
        $1::text, $2::uuid, $3::text, $4::char(64),
        $5::uuid, $6::uuid, $7::text,
        2, 128, $8::timestamptz, $8::timestamptz
      )
    `,
    values: [
      userId,
      idempotencyKey,
      operation,
      requestDigest,
      MATURE_GAME_ID,
      operation === 'append_observation' ? WILBUR_RATE_ACTION_ID : null,
      input.kind,
      (input.ledgerTimestamp ?? NOW).toISOString(),
    ],
  })
  return {
    userId,
    ipAddress: input.ipAddress,
    kind: input.kind,
    operation,
    idempotencyKey,
    requestDigest,
  }
}

async function attachActiveMatureRequest(): Promise<void> {
  const expiresAt = new Date(NOW.valueOf() + 180_000)
  await database.adapter.query({
    text: `
      INSERT INTO model_requests (
        id, clerk_user_id, game_id, operation, idempotency_key,
        request_sha256, status, provider, model, prompt_version,
        software_version, provider_started_at, created_at, updated_at,
        operation_deadline_at
      )
      VALUES (
        $1::uuid, $2::text, $3::uuid, 'answer', $1::uuid,
        $4::text, 'in_progress', 'openai', 'gpt-5.6-sol',
        'answer-v1', 'integration-test', $5::timestamptz,
        $5::timestamptz, $5::timestamptz,
        $5::timestamptz + interval '145 seconds'
      )
    `,
    values: [
      MATURE_ACTIVE_REQUEST_ID,
      OWNER,
      MATURE_GAME_ID,
      'f'.repeat(64),
      NOW.toISOString(),
    ],
  })
  await database.adapter.query({
    text: `
      UPDATE model_concurrency_slots
      SET
        request_id = $1::uuid,
        clerk_user_id = $2::text,
        lease_token = $3::uuid,
        lease_expires_at = $4::timestamptz
      WHERE slot = 1
    `,
    values: [
      MATURE_ACTIVE_REQUEST_ID,
      OWNER,
      MATURE_ACTIVE_LEASE_TOKEN,
      expiresAt.toISOString(),
    ],
  })
}

describe('durable usage accounting against PostgreSQL', () => {
  it('reserves, links, starts, settles, and recovers a paid result idempotently', async () => {
    const usage = controller()
    const reservationInput = divisionReservation()

    const reserved = await usage.reserveModelRequest(reservationInput)
    expect(reserved).toMatchObject({
      ok: true,
      kind: 'reserved',
      requestId: REQUEST_ID,
      gameId: null,
      status: 'reserved',
      leaseToken: LEASE_TOKEN,
    })

    await expect(
      usage.reserveModelRequest(reservationInput),
    ).resolves.toMatchObject({
      ok: true,
      kind: 'existing',
      requestId: REQUEST_ID,
      status: 'reserved',
      leaseToken: LEASE_TOKEN,
    })
    await expect(usage.getUsageSummary(OWNER)).resolves.toMatchObject({
      modelOperations: { used: 0, reserved: 1 },
      gameStarts: { used: 0, reserved: 1 },
      activeModelRequests: 1,
    })

    const games = new DurableGameRepository(database.adapter)
    const created = await games.getOrCreateDivision({
      ownerId: OWNER,
      gameId: REQUEST_ID,
      problem: 'How can this integration remain durable across retries?',
      softwareVersion: 'integration-test',
      researchConsent: NO_EXTERNAL_RESEARCH_CONSENT,
    })
    expect(created.created).toBe(true)

    await expect(
      usage.attachModelRequestGame({
        userId: OWNER,
        requestId: REQUEST_ID,
        gameId: REQUEST_ID,
      }),
    ).resolves.toEqual({ ok: true, attached: true })
    await expect(
      usage.attachModelRequestGame({
        userId: OWNER,
        requestId: REQUEST_ID,
        gameId: REQUEST_ID,
      }),
    ).resolves.toEqual({ ok: true, attached: false })

    await expect(
      usage.beginProviderCall({
        userId: OWNER,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toEqual({
      ok: true,
      status: 'in_progress',
      alreadyStarted: false,
    })
    await expect(
      usage.beginProviderCall({
        userId: OWNER,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toEqual({
      ok: true,
      status: 'in_progress',
      alreadyStarted: true,
    })

    const settlement = {
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
      outcome: 'succeeded' as const,
      providerResponseId: 'resp_integration',
      responseSha256: 'b'.repeat(64),
      resultPayload: {
        kind: 'division',
        gameId: REQUEST_ID,
      },
      usage: {
        reported: true,
        inputTokens: 120,
        cachedInputTokens: 30,
        cacheWriteInputTokens: 0,
        outputTokens: 45,
        reasoningTokens: 18,
        totalTokens: 165,
      },
    }
    await expect(
      usage.settleModelRequest(settlement),
    ).resolves.toEqual({
      ok: true,
      status: 'succeeded',
      alreadySettled: false,
    })
    await expect(
      usage.settleModelRequest(settlement),
    ).resolves.toEqual({
      ok: true,
      status: 'succeeded',
      alreadySettled: true,
    })

    await expect(
      usage.getModelRequestResult({
        userId: OWNER,
        requestId: REQUEST_ID,
      }),
    ).resolves.toEqual({
      found: true,
      requestId: REQUEST_ID,
      gameId: REQUEST_ID,
      operation: 'division',
      requestSha256: SHA256,
      promptVersion: 'division-v1',
      status: 'succeeded',
      resultPayload: {
        kind: 'division',
        gameId: REQUEST_ID,
      },
    })
    await expect(
      usage.getModelRequestByIdempotencyKey({
        userId: OWNER,
        operation: 'division',
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).resolves.toMatchObject({
      found: true,
      requestId: REQUEST_ID,
      gameId: REQUEST_ID,
      operation: 'division',
    })
    await expect(
      usage.getModelRequestByIdempotencyKey({
        userId: OTHER_OWNER,
        operation: 'division',
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).resolves.toEqual({ found: false })
    await expect(
      usage.getLatestModelRequestForGame({
        userId: OWNER,
        gameId: REQUEST_ID,
        operation: 'division',
      }),
    ).resolves.toMatchObject({
      found: true,
      requestId: REQUEST_ID,
      status: 'succeeded',
    })
    await expect(usage.getUsageSummary(OWNER)).resolves.toMatchObject({
      modelOperations: { used: 1, reserved: 0 },
      gameStarts: { used: 1, reserved: 0 },
      activeModelRequests: 0,
    })

    const persisted = await database.adapter.query({
      text: `
        SELECT
          status,
          provider_response_id,
          usage_reported,
          input_tokens,
          cached_input_tokens,
          cache_write_input_tokens,
          output_tokens,
          reasoning_tokens,
          total_tokens,
          result_payload
        FROM model_requests
        WHERE id = $1::uuid
      `,
      values: [REQUEST_ID],
    })
    expect(persisted.rows).toEqual([
      {
        status: 'succeeded',
        provider_response_id: 'resp_integration',
        usage_reported: true,
        input_tokens: '120',
        cached_input_tokens: '30',
        cache_write_input_tokens: '0',
        output_tokens: '45',
        reasoning_tokens: '18',
        total_tokens: '165',
        result_payload: {
          kind: 'division',
          gameId: REQUEST_ID,
        },
      },
    ])

    const persistedRates = await database.adapter.query({
      text: `
        SELECT key_hash
        FROM rate_buckets
        ORDER BY key_type
      `,
    })
    expect(persistedRates.rows).toHaveLength(4)
    for (const row of persistedRates.rows) {
      expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(row.key_hash).not.toContain('203.0.113.10')
      expect(row.key_hash).not.toContain(OWNER)
    }
  })

  it('persists a billable failed-response provider ID and compares it idempotently', async () => {
    const usage = controller()
    await expect(
      usage.reserveModelRequest(divisionReservation()),
    ).resolves.toMatchObject({ ok: true, kind: 'reserved' })
    await expect(
      usage.beginProviderCall({
        userId: OWNER,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toMatchObject({ ok: true, status: 'in_progress' })

    const failure = {
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
      outcome: 'failed' as const,
      failureCode: 'provider_contract_invalid',
      providerResponseId: 'resp_failed_integration',
      providerHttpStatus: 422,
    }
    await expect(usage.settleModelRequest(failure)).resolves.toEqual({
      ok: true,
      status: 'failed',
      alreadySettled: false,
    })
    await expect(usage.settleModelRequest(failure)).resolves.toEqual({
      ok: true,
      status: 'failed',
      alreadySettled: true,
    })
    await expect(
      usage.settleModelRequest({
        ...failure,
        providerResponseId: 'resp_changed',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'SETTLEMENT_CONFLICT',
      httpStatus: 409,
    })

    const persisted = await database.adapter.query({
      text: `
        SELECT
          status,
          provider_response_id,
          response_sha256,
          result_payload,
          failure_code,
          provider_http_status
        FROM model_requests
        WHERE id = $1::uuid
      `,
      values: [REQUEST_ID],
    })
    expect(persisted.rows).toEqual([
      {
        status: 'failed',
        provider_response_id: 'resp_failed_integration',
        response_sha256: null,
        result_payload: null,
        failure_code: 'provider_contract_invalid',
        provider_http_status: 422,
      },
    ])
  })

  it('fenced provider-not-started rollback refunds a begun request and frees its slot idempotently', async () => {
    const usage = controller()
    await expect(
      usage.reserveModelRequest(divisionReservation()),
    ).resolves.toMatchObject({ ok: true, kind: 'reserved' })
    await expect(usage.beginProviderCall({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
    })).resolves.toMatchObject({
      ok: true,
      status: 'in_progress',
      alreadyStarted: false,
    })

    await expect(usage.releaseReservation({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
      reason: 'client_disconnected',
    })).resolves.toEqual({
      ok: false,
      code: 'INVALID_REQUEST_STATE',
      httpStatus: 409,
    })
    await expect(usage.releaseReservation({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
      reason: 'provider_not_started',
    })).resolves.toEqual({ ok: true, released: true })
    await expect(usage.releaseReservation({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
      reason: 'provider_not_started',
    })).resolves.toEqual({ ok: true, released: false })

    await expect(usage.getUsageSummary(OWNER)).resolves.toMatchObject({
      modelOperations: { used: 0, reserved: 0 },
      gameStarts: { used: 0, reserved: 0 },
      activeModelRequests: 0,
    })
    const persisted = await database.adapter.query({
      text: `
        SELECT
          requests.status,
          requests.failure_code,
          requests.provider_started_at,
          count(slots.request_id)::integer AS occupied_slots
        FROM model_requests AS requests
        LEFT JOIN model_concurrency_slots AS slots
          ON slots.request_id = requests.id
        WHERE requests.id = $1::uuid
        GROUP BY
          requests.status,
          requests.failure_code,
          requests.provider_started_at
      `,
      values: [REQUEST_ID],
    })
    expect(persisted.rows).toEqual([{
      status: 'failed',
      failure_code: 'released_provider_not_started',
      provider_started_at: null,
      occupied_slots: 0,
    }])
  })

  it('rechecks deletion, suspension, and temporary blocks before provider work starts', async () => {
    const usage = controller()
    await usage.reserveModelRequest(divisionReservation())

    await database.adapter.query({
      text: `
        UPDATE user_controls
        SET suspended = true, reason_code = 'test_suspension'
        WHERE clerk_user_id = $1::text
      `,
      values: [OWNER],
    })
    await expect(
      usage.beginProviderCall({
        userId: OWNER,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'ACCOUNT_SUSPENDED',
      httpStatus: 403,
    })

    await database.adapter.query({
      text: `
        UPDATE user_controls
        SET
          suspended = false,
          blocked_until = $2::timestamptz,
          reason_code = 'test_block'
        WHERE clerk_user_id = $1::text
      `,
      values: [
        OWNER,
        new Date(NOW.valueOf() + 60_000).toISOString(),
      ],
    })
    await expect(
      usage.beginProviderCall({
        userId: OWNER,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'ACCOUNT_TEMPORARILY_BLOCKED',
      httpStatus: 403,
    })

    await database.adapter.query({
      text: `
        UPDATE user_controls
        SET blocked_until = NULL, reason_code = NULL
        WHERE clerk_user_id = $1::text
      `,
      values: [OWNER],
    })
    await database.adapter.query({
      text: `
        INSERT INTO deleted_user_tombstones (user_key_hash, deleted_at)
        VALUES ($1::text, $2::timestamptz)
      `,
      values: [
        hashDeletedUserKey(DEFAULT_CONFIG.deletionHmacSecret, OWNER),
        NOW.toISOString(),
      ],
    })
    await expect(
      usage.beginProviderCall({
        userId: OWNER,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'ACCOUNT_DELETED',
      httpStatus: 403,
    })

    const unchanged = await database.adapter.query({
      text: `
        SELECT
          requests.status,
          requests.provider_started_at,
          buckets.used,
          buckets.reserved,
          count(slots.request_id)::integer AS occupied_slots
        FROM model_requests AS requests
        JOIN usage_buckets AS buckets
          ON buckets.subject_type = 'user'
          AND buckets.subject_key = requests.clerk_user_id
          AND buckets.metric = 'model_requests'
        LEFT JOIN model_concurrency_slots AS slots
          ON slots.request_id = requests.id
        WHERE requests.id = $1::uuid
        GROUP BY
          requests.status,
          requests.provider_started_at,
          buckets.used,
          buckets.reserved
      `,
      values: [REQUEST_ID],
    })
    expect(unchanged.rows).toEqual([
      {
        status: 'reserved',
        provider_started_at: null,
        used: '0',
        reserved: '1',
        occupied_slots: 1,
      },
    ])
  })

  it('enforces begin and settlement lease boundaries while preserving committed retry idempotency', async () => {
    let currentTime = new Date(NOW)
    const usage = controller(
      DEFAULT_CONFIG,
      () => new Date(currentTime),
    )

    await usage.reserveModelRequest(divisionReservation())
    await usage.beginProviderCall({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
    })
    const settledFailure = {
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
      outcome: 'failed' as const,
      failureCode: 'provider_contract_invalid',
      providerResponseId: 'resp_before_expiry',
      providerHttpStatus: 422,
    }
    currentTime = new Date(NOW.valueOf() + 179_999)
    await expect(
      usage.settleModelRequest(settledFailure),
    ).resolves.toEqual({
      ok: true,
      status: 'failed',
      alreadySettled: false,
    })

    currentTime = new Date(NOW)
    await usage.reserveModelRequest(
      divisionReservation({
        requestId: OTHER_REQUEST_ID,
        idempotencyKey: OTHER_IDEMPOTENCY_KEY,
        requestSha256: 'd'.repeat(64),
      }),
    )
    await usage.beginProviderCall({
      userId: OWNER,
      requestId: OTHER_REQUEST_ID,
      leaseToken: LEASE_TOKEN,
    })
    currentTime = new Date(NOW.valueOf() + 180_000)
    await expect(
      usage.settleModelRequest({
        ...settledFailure,
        requestId: OTHER_REQUEST_ID,
        providerResponseId: 'resp_at_expiry',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'LEASE_EXPIRED',
      httpStatus: 410,
    })
    await expect(usage.reconcileExpiredLeases()).resolves.toEqual({
      expiredRequests: 1,
      clearedSlots: 1,
    })

    currentTime = new Date(NOW.valueOf() + 180_001)
    await expect(
      usage.settleModelRequest(settledFailure),
    ).resolves.toEqual({
      ok: true,
      status: 'failed',
      alreadySettled: true,
    })

    currentTime = new Date(NOW)
    await usage.reserveModelRequest(
      divisionReservation({
        requestId: THIRD_REQUEST_ID,
        idempotencyKey: THIRD_IDEMPOTENCY_KEY,
        requestSha256: 'e'.repeat(64),
      }),
    )
    currentTime = new Date(NOW.valueOf() + 180_000)
    await expect(
      usage.beginProviderCall({
        userId: OWNER,
        requestId: THIRD_REQUEST_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'LEASE_EXPIRED',
      httpStatus: 410,
    })

    const expired = await database.adapter.query({
      text: `
        SELECT status
        FROM model_requests
        WHERE id = $1::uuid
      `,
      values: [OTHER_REQUEST_ID],
    })
    expect(expired.rows).toEqual([{ status: 'indeterminate' }])
  })

  it('renews one Answer request lease without consuming a second model operation', async () => {
    let currentTime = new Date(NOW)
    const usage = controller(
      { ...DEFAULT_CONFIG, modelLeaseSeconds: 335 },
      () => new Date(currentTime),
    )
    const reservationInput = answerReservation()
    await createDivisionShell(
      OWNER,
      MATURE_GAME_ID,
      'Can a two-turn Answer complete within one bounded operation?',
    )

    await expect(
      usage.reserveModelRequest(reservationInput),
    ).resolves.toMatchObject({
      ok: true,
      kind: 'reserved',
      requestId: REQUEST_ID,
      status: 'reserved',
      leaseToken: LEASE_TOKEN,
    })
    await expect(
      usage.beginProviderCall({
        userId: OWNER,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toEqual({
      ok: true,
      status: 'in_progress',
      alreadyStarted: false,
    })

    currentTime = new Date(NOW.valueOf() + 120_000)
    await expect(
      usage.beginProviderCall({
        userId: OWNER,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toEqual({
      ok: true,
      status: 'in_progress',
      alreadyStarted: true,
    })

    const renewed = await database.adapter.query({
      text: `
        SELECT
          requests.status,
          requests.provider_started_at,
          slots.lease_expires_at
        FROM model_requests AS requests
        JOIN model_concurrency_slots AS slots
          ON slots.request_id = requests.id
        WHERE requests.id = $1::uuid
      `,
      values: [REQUEST_ID],
    })
    expect(renewed.rows).toEqual([
      {
        status: 'in_progress',
        provider_started_at: NOW,
        lease_expires_at: new Date(NOW.valueOf() + 335_000),
      },
    ])

    currentTime = new Date(NOW.valueOf() + 299_999)
    await expect(
      usage.settleModelRequest({
        userId: OWNER,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
        outcome: 'succeeded',
        providerResponseId: 'resp_answer_after_renewal',
        responseSha256: 'b'.repeat(64),
        resultPayload: {
          kind: 'answer',
          gameId: MATURE_GAME_ID,
        },
        usage: {
          reported: true,
          inputTokens: 200,
          cachedInputTokens: 40,
          cacheWriteInputTokens: 0,
          outputTokens: 80,
          reasoningTokens: 30,
          totalTokens: 280,
        },
      }),
    ).resolves.toEqual({
      ok: true,
      status: 'succeeded',
      alreadySettled: false,
    })

    await expect(usage.getUsageSummary(OWNER)).resolves.toMatchObject({
      modelOperations: { used: 1, reserved: 0 },
      gameStarts: { used: 0, reserved: 0 },
      activeModelRequests: 0,
    })
    const persisted = await database.adapter.query({
      text: `
        SELECT
          status,
          provider_started_at,
          completed_at,
          (
            SELECT count(*)::integer
            FROM model_requests
            WHERE clerk_user_id = $2::text
          ) AS request_count,
          (
            SELECT count(*)::integer
            FROM model_concurrency_slots
            WHERE request_id IS NOT NULL
          ) AS occupied_slots
        FROM model_requests
        WHERE id = $1::uuid
      `,
      values: [REQUEST_ID, OWNER],
    })
    expect(persisted.rows).toEqual([
      {
        status: 'succeeded',
        provider_started_at: NOW,
        completed_at: currentTime,
        request_count: 1,
        occupied_slots: 0,
      },
    ])
  })

  it('reconciles an Answer lease beyond 300 seconds without duplicate usage or stale settlement', async () => {
    let currentTime = new Date(NOW)
    const usage = controller(
      { ...DEFAULT_CONFIG, modelLeaseSeconds: 335 },
      () => new Date(currentTime),
    )
    const reservationInput = answerReservation()
    await createDivisionShell(
      OWNER,
      MATURE_GAME_ID,
      'How does an interrupted Answer release its durable slot?',
    )

    await usage.reserveModelRequest(reservationInput)
    await usage.beginProviderCall({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
    })
    currentTime = new Date(NOW.valueOf() + 120_000)
    await expect(
      usage.beginProviderCall({
        userId: OWNER,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: 'in_progress',
      alreadyStarted: true,
    })

    currentTime = new Date(NOW.valueOf() + 299_999)
    await expect(usage.reconcileExpiredLeases()).resolves.toEqual({
      expiredRequests: 0,
      clearedSlots: 0,
    })
    currentTime = new Date(NOW.valueOf() + 300_000)
    await expect(usage.reconcileExpiredLeases()).resolves.toEqual({
      expiredRequests: 1,
      clearedSlots: 1,
    })
    await expect(usage.reconcileExpiredLeases()).resolves.toEqual({
      expiredRequests: 0,
      clearedSlots: 0,
    })

    const reconciled = await database.adapter.query({
      text: `
        SELECT
          requests.status,
          requests.failure_code,
          requests.provider_started_at,
          requests.completed_at,
          (
            SELECT count(*)::integer
            FROM model_concurrency_slots
            WHERE request_id IS NOT NULL
          ) AS occupied_slots
        FROM model_requests AS requests
        WHERE requests.id = $1::uuid
      `,
      values: [REQUEST_ID],
    })
    expect(reconciled.rows).toEqual([
      {
        status: 'indeterminate',
        failure_code: 'answer_operation_timeout',
        provider_started_at: NOW,
        completed_at: currentTime,
        occupied_slots: 0,
      },
    ])

    await expect(
      usage.settleModelRequest({
        userId: OWNER,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
        outcome: 'succeeded',
        providerResponseId: 'resp_stale_after_expiry',
        responseSha256: 'c'.repeat(64),
        resultPayload: {
          kind: 'answer',
          gameId: MATURE_GAME_ID,
        },
        usage: {
          reported: true,
          inputTokens: 200,
          cachedInputTokens: 40,
          cacheWriteInputTokens: 0,
          outputTokens: 80,
          reasoningTokens: 30,
          totalTokens: 280,
        },
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'LEASE_EXPIRED',
      httpStatus: 410,
    })
    await expect(
      usage.reserveModelRequest(reservationInput),
    ).resolves.toEqual({
      ok: true,
      kind: 'existing',
      requestId: REQUEST_ID,
      gameId: MATURE_GAME_ID,
      status: 'indeterminate',
      leaseToken: null,
      leaseExpiresAt: null,
    })
    await expect(usage.getUsageSummary(OWNER)).resolves.toMatchObject({
      modelOperations: { used: 1, reserved: 0 },
      gameStarts: { used: 0, reserved: 0 },
      activeModelRequests: 0,
    })

    const accounting = await database.adapter.query({
      text: `
        SELECT
          (SELECT count(*)::integer FROM model_requests) AS requests,
          (
            SELECT used
            FROM usage_buckets
            WHERE
              subject_type = 'user'
              AND subject_key = $1::text
              AND metric = 'model_requests'
          ) AS model_used,
          (
            SELECT max(count)::integer
            FROM rate_buckets
            WHERE action = 'model'
          ) AS maximum_rate_count
      `,
      values: [OWNER],
    })
    expect(accounting.rows).toEqual([
      {
        requests: 1,
        model_used: '1',
        maximum_rate_count: 1,
      },
    ])
  })

  it('reconciles a crashed Answer at its fixed cap after late initial and corrective turns', async () => {
    let currentTime = new Date(NOW)
    const recoveryCap = new Date(NOW.valueOf() + 335_000)
    const usage = controller(
      { ...DEFAULT_CONFIG, modelLeaseSeconds: 335 },
      () => new Date(currentTime),
    )
    const reservationInput = answerReservation({
      operationDeadlineAt: new Date(recoveryCap.valueOf() - 35_000),
      leaseExpiresAtCap: recoveryCap,
    })
    await createDivisionShell(
      OWNER,
      MATURE_GAME_ID,
      'How does a late interrupted Answer release its durable slot?',
    )

    currentTime = new Date(NOW.valueOf() + 250_000)
    await expect(usage.reserveModelRequest(reservationInput)).resolves.toMatchObject({
      ok: true,
      kind: 'reserved',
      leaseExpiresAt: recoveryCap.toISOString(),
    })

    await expect(usage.beginProviderCall({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
    })).resolves.toMatchObject({
      ok: true,
      alreadyStarted: false,
    })

    currentTime = new Date(NOW.valueOf() + 299_000)
    await expect(usage.beginProviderCall({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
    })).resolves.toMatchObject({
      ok: true,
      alreadyStarted: true,
    })

    const active = await database.adapter.query({
      text: `
        SELECT slots.lease_expires_at
        FROM model_concurrency_slots AS slots
        WHERE slots.request_id = $1::uuid
      `,
      values: [REQUEST_ID],
    })
    expect(active.rows).toEqual([{ lease_expires_at: recoveryCap }])

    const operationDeadlineAt = new Date(recoveryCap.valueOf() - 35_000)
    currentTime = new Date(operationDeadlineAt.valueOf() - 1)
    await expect(usage.reconcileExpiredLeases()).resolves.toEqual({
      expiredRequests: 0,
      clearedSlots: 0,
    })
    currentTime = operationDeadlineAt
    await expect(usage.reconcileExpiredLeases()).resolves.toEqual({
      expiredRequests: 1,
      clearedSlots: 1,
    })

    await expect(usage.reserveModelRequest(reservationInput)).resolves.toEqual({
      ok: true,
      kind: 'existing',
      requestId: REQUEST_ID,
      gameId: MATURE_GAME_ID,
      status: 'indeterminate',
      leaseToken: null,
      leaseExpiresAt: null,
    })

    const lateSuccess = {
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
      outcome: 'succeeded' as const,
      providerResponseId: 'resp_after_watchdog_cleanup',
      responseSha256: '6'.repeat(64),
      resultPayload: { answer: 'must remain discarded after timeout' },
      usage: {
        reported: true,
        inputTokens: 144,
        cachedInputTokens: 21,
        cacheWriteInputTokens: 5,
        outputTokens: 55,
        reasoningTokens: 13,
        totalTokens: 199,
      },
    }
    await expect(usage.settleModelRequest(lateSuccess)).resolves.toEqual({
      ok: false,
      code: 'LEASE_EXPIRED',
      httpStatus: 410,
    })
    await expect(usage.settleModelRequest(lateSuccess)).resolves.toEqual({
      ok: false,
      code: 'LEASE_EXPIRED',
      httpStatus: 410,
    })
    await expect(usage.settleModelRequest({
      ...lateSuccess,
      providerResponseId: 'resp_conflicting_provider_operation',
    })).resolves.toEqual({
      ok: false,
      code: 'SETTLEMENT_CONFLICT',
      httpStatus: 409,
    })

    const persisted = await database.adapter.query({
      text: `
        SELECT
          requests.status,
          requests.failure_code,
          requests.provider_response_id,
          requests.response_sha256,
          requests.result_payload,
          requests.usage_reported,
          requests.input_tokens,
          requests.cached_input_tokens,
          requests.cache_write_input_tokens,
          requests.output_tokens,
          requests.reasoning_tokens,
          requests.total_tokens,
          (
            SELECT count(*)::integer
            FROM model_requests
            WHERE
              clerk_user_id = $2::text
              AND game_id = $3::uuid
              AND operation = 'answer'
          ) AS request_count,
          (
            SELECT used
            FROM usage_buckets
            WHERE
              subject_type = 'user'
              AND subject_key = $2::text
              AND metric = 'model_requests'
          ) AS model_used,
          (
            SELECT max(count)::integer
            FROM rate_buckets
            WHERE action = 'model'
          ) AS maximum_rate_count,
          (
            SELECT count(*)::integer
            FROM model_concurrency_slots
            WHERE request_id IS NOT NULL
          ) AS occupied_slots
        FROM model_requests AS requests
        WHERE requests.id = $1::uuid
      `,
      values: [REQUEST_ID, OWNER, MATURE_GAME_ID],
    })
    expect(persisted.rows).toEqual([{
      status: 'indeterminate',
      failure_code: 'answer_operation_timeout',
      provider_response_id: 'resp_after_watchdog_cleanup',
      response_sha256: null,
      result_payload: null,
      usage_reported: true,
      input_tokens: '144',
      cached_input_tokens: '21',
      cache_write_input_tokens: '5',
      output_tokens: '55',
      reasoning_tokens: '13',
      total_tokens: '199',
      request_count: 1,
      model_used: '1',
      maximum_rate_count: 1,
      occupied_slots: 0,
    }])
  })

  it('fences a late Answer success at the logical deadline before lease expiry', async () => {
    let currentTime = new Date(NOW)
    const usage = controller(
      { ...DEFAULT_CONFIG, modelLeaseSeconds: 335 },
      () => new Date(currentTime),
    )
    const reservationInput = answerReservation()
    await createDivisionShell(
      OWNER,
      MATURE_GAME_ID,
      'Can a late provider response overwrite the durable Answer deadline?',
    )

    await usage.reserveModelRequest(reservationInput)
    await usage.beginProviderCall({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
    })
    currentTime = new Date(NOW.valueOf() + 300_000)

    const lateSuccess = {
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
      outcome: 'succeeded' as const,
      providerResponseId: 'resp_at_logical_deadline',
      responseSha256: '7'.repeat(64),
      resultPayload: {
        kind: 'answer',
        gameId: MATURE_GAME_ID,
      },
      usage: {
        reported: true,
        inputTokens: 200,
        cachedInputTokens: 40,
        cacheWriteInputTokens: 0,
        outputTokens: 80,
        reasoningTokens: 30,
        totalTokens: 280,
      },
    }
    await expect(usage.settleModelRequest(lateSuccess)).resolves.toEqual({
      ok: false,
      code: 'LEASE_EXPIRED',
      httpStatus: 410,
    })

    const settled = await database.adapter.query({
      text: `
        SELECT
          requests.status,
          requests.failure_code,
          requests.completed_at,
          slots.lease_expires_at,
          (
            SELECT count(*)::integer
            FROM model_requests
            WHERE clerk_user_id = $2::text
              AND operation = 'answer'
          ) AS request_count,
          (
            SELECT used
            FROM usage_buckets
            WHERE subject_type = 'user'
              AND subject_key = $2::text
              AND metric = 'model_requests'
          ) AS model_used
        FROM model_requests AS requests
        LEFT JOIN model_concurrency_slots AS slots
          ON slots.request_id = requests.id
        WHERE requests.id = $1::uuid
      `,
      values: [REQUEST_ID, OWNER],
    })
    expect(settled.rows).toEqual([{
      status: 'indeterminate',
      failure_code: 'answer_operation_timeout',
      completed_at: currentTime,
      lease_expires_at: null,
      request_count: 1,
      model_used: '1',
    }])

    await expect(usage.reconcileExpiredLeases()).resolves.toEqual({
      expiredRequests: 0,
      clearedSlots: 0,
    })
    await expect(usage.settleModelRequest(lateSuccess)).resolves.toEqual({
      ok: false,
      code: 'LEASE_EXPIRED',
      httpStatus: 410,
    })
  })

  it('rechecks PostgreSQL time after a lock wait and never starts Answer late', async () => {
    const usage = controller(
      { ...DEFAULT_CONFIG, modelLeaseSeconds: 335 },
      null,
    )
    const operationDeadlineAt = new Date(Date.now() + 1_500)
    await createDivisionShell(
      OWNER,
      MATURE_GAME_ID,
      'Can a pre-deadline caller start provider work after waiting on the lock?',
    )
    await usage.reserveModelRequest(answerReservation({
      operationDeadlineAt,
      leaseExpiresAtCap: new Date(operationDeadlineAt.valueOf() + 35_000),
    }))

    const lock = await holdUsageReservationLock()
    const transition = usage.beginProviderCall({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
    })
    try {
      await waitUntilAfter(operationDeadlineAt)
    } finally {
      await lock.release()
    }

    await expect(transition).resolves.toEqual({
      ok: false,
      code: 'LEASE_EXPIRED',
      httpStatus: 410,
    })
    await expect(usage.reconcileExpiredLeases()).resolves.toEqual({
      expiredRequests: 1,
      clearedSlots: 1,
    })

    const persisted = await database.adapter.query({
      text: `
        SELECT
          requests.status,
          requests.failure_code,
          requests.provider_started_at,
          (
            SELECT count(*)::integer
            FROM model_concurrency_slots
            WHERE request_id IS NOT NULL
          ) AS occupied_slots
        FROM model_requests AS requests
        WHERE requests.id = $1::uuid
      `,
      values: [REQUEST_ID],
    })
    expect(persisted.rows).toEqual([{
      status: 'failed',
      failure_code: 'answer_operation_timeout_before_provider',
      provider_started_at: null,
      occupied_slots: 0,
    }])
  })

  it('rechecks PostgreSQL time after a reconciliation lock wait', async () => {
    const usage = controller(
      { ...DEFAULT_CONFIG, modelLeaseSeconds: 335 },
      null,
    )
    const operationDeadlineAt = new Date(Date.now() + 1_500)
    await createDivisionShell(
      OWNER,
      MATURE_GAME_ID,
      'Can reconciliation cross the logical deadline while waiting on its lock?',
    )
    await usage.reserveModelRequest(answerReservation({
      operationDeadlineAt,
      leaseExpiresAtCap: new Date(operationDeadlineAt.valueOf() + 35_000),
    }))
    await usage.beginProviderCall({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
    })

    const lock = await holdUsageReservationLock()
    const reconciliation = usage.reconcileExpiredLeases()
    try {
      await waitUntilAfter(operationDeadlineAt)
    } finally {
      await lock.release()
    }

    await expect(reconciliation).resolves.toEqual({
      expiredRequests: 1,
      clearedSlots: 1,
    })
    const persisted = await database.adapter.query({
      text: `
        SELECT status, failure_code,
          (
            SELECT count(*)::integer
            FROM model_concurrency_slots
            WHERE request_id IS NOT NULL
          ) AS occupied_slots
        FROM model_requests
        WHERE id = $1::uuid
      `,
      values: [REQUEST_ID],
    })
    expect(persisted.rows).toEqual([{
      status: 'indeterminate',
      failure_code: 'answer_operation_timeout',
      occupied_slots: 0,
    }])
  })

  it('uses post-lock time to fence late success and retain provider usage provenance', async () => {
    const usage = controller(
      { ...DEFAULT_CONFIG, modelLeaseSeconds: 335 },
      null,
    )
    const operationDeadlineAt = new Date(Date.now() + 1_500)
    await createDivisionShell(
      OWNER,
      MATURE_GAME_ID,
      'Can a blocked success cross the logical Answer deadline?',
    )
    await usage.reserveModelRequest(answerReservation({
      operationDeadlineAt,
      leaseExpiresAtCap: new Date(operationDeadlineAt.valueOf() + 35_000),
    }))
    await usage.beginProviderCall({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
    })

    const lateSuccess = {
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
      outcome: 'succeeded' as const,
      providerResponseId: 'resp_after_lock_wait',
      responseSha256: '8'.repeat(64),
      resultPayload: { kind: 'answer', answer: 'must not persist' },
      usage: {
        reported: true,
        inputTokens: 321,
        cachedInputTokens: 12,
        cacheWriteInputTokens: 3,
        outputTokens: 89,
        reasoningTokens: 34,
        totalTokens: 410,
      },
    }
    const lock = await holdUsageReservationLock()
    const settlement = usage.settleModelRequest(lateSuccess)
    try {
      await waitUntilAfter(operationDeadlineAt)
    } finally {
      await lock.release()
    }

    await expect(settlement).resolves.toEqual({
      ok: false,
      code: 'LEASE_EXPIRED',
      httpStatus: 410,
    })
    const persisted = await database.adapter.query({
      text: `
        SELECT
          status,
          failure_code,
          provider_response_id,
          response_sha256,
          result_payload,
          usage_reported,
          input_tokens,
          cached_input_tokens,
          cache_write_input_tokens,
          output_tokens,
          reasoning_tokens,
          total_tokens,
          (
            SELECT count(*)::integer
            FROM model_concurrency_slots
            WHERE request_id IS NOT NULL
          ) AS occupied_slots
        FROM model_requests
        WHERE id = $1::uuid
      `,
      values: [REQUEST_ID],
    })
    expect(persisted.rows).toEqual([{
      status: 'indeterminate',
      failure_code: 'answer_operation_timeout',
      provider_response_id: 'resp_after_lock_wait',
      response_sha256: null,
      result_payload: null,
      usage_reported: true,
      input_tokens: '321',
      cached_input_tokens: '12',
      cache_write_input_tokens: '3',
      output_tokens: '89',
      reasoning_tokens: '34',
      total_tokens: '410',
      occupied_slots: 0,
    }])
    await expect(usage.reconcileExpiredLeases()).resolves.toEqual({
      expiredRequests: 0,
      clearedSlots: 0,
    })
    await expect(usage.settleModelRequest(lateSuccess)).resolves.toEqual({
      ok: false,
      code: 'LEASE_EXPIRED',
      httpStatus: 410,
    })
  })

  it('refunds an unstarted Answer reservation at its logical deadline', async () => {
    let currentTime = new Date(NOW)
    const usage = controller(
      { ...DEFAULT_CONFIG, modelLeaseSeconds: 335 },
      () => new Date(currentTime),
    )
    const reservationInput = answerReservation()
    await createDivisionShell(
      OWNER,
      MATURE_GAME_ID,
      'How should an unstarted Answer time out without a provider charge?',
    )

    await usage.reserveModelRequest(reservationInput)
    currentTime = new Date(NOW.valueOf() + 299_999)
    await expect(usage.reconcileExpiredLeases()).resolves.toEqual({
      expiredRequests: 0,
      clearedSlots: 0,
    })
    currentTime = new Date(NOW.valueOf() + 300_000)
    await expect(usage.reconcileExpiredLeases()).resolves.toEqual({
      expiredRequests: 1,
      clearedSlots: 1,
    })
    await expect(usage.reconcileExpiredLeases()).resolves.toEqual({
      expiredRequests: 0,
      clearedSlots: 0,
    })

    const settled = await database.adapter.query({
      text: `
        SELECT
          requests.status,
          requests.failure_code,
          requests.provider_started_at,
          requests.completed_at,
          (
            SELECT used
            FROM usage_buckets
            WHERE subject_type = 'user'
              AND subject_key = $2::text
              AND metric = 'model_requests'
          ) AS model_used,
          (
            SELECT reserved
            FROM usage_buckets
            WHERE subject_type = 'user'
              AND subject_key = $2::text
              AND metric = 'model_requests'
          ) AS model_reserved,
          (
            SELECT count(*)::integer
            FROM model_concurrency_slots
            WHERE request_id IS NOT NULL
          ) AS occupied_slots
        FROM model_requests AS requests
        WHERE requests.id = $1::uuid
      `,
      values: [REQUEST_ID, OWNER],
    })
    expect(settled.rows).toEqual([{
      status: 'failed',
      failure_code: 'answer_operation_timeout_before_provider',
      provider_started_at: null,
      completed_at: currentTime,
      model_used: '0',
      model_reserved: '0',
      occupied_slots: 0,
    }])

    await expect(usage.beginProviderCall({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
    })).resolves.toEqual({
      ok: false,
      code: 'INVALID_REQUEST_STATE',
      httpStatus: 409,
    })
  })

  it('releases a deadline-barred Answer with timeout provenance before dispatch', async () => {
    let currentTime = new Date(NOW)
    const usage = controller(
      { ...DEFAULT_CONFIG, modelLeaseSeconds: 335 },
      () => new Date(currentTime),
    )
    await createDivisionShell(
      OWNER,
      MATURE_GAME_ID,
      'Can provider dispatch begin at the durable Answer cutoff?',
    )
    await usage.reserveModelRequest(answerReservation())
    currentTime = new Date(NOW.valueOf() + 300_000)

    await expect(usage.beginProviderCall({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
    })).resolves.toEqual({
      ok: false,
      code: 'LEASE_EXPIRED',
      httpStatus: 410,
    })
    await expect(usage.releaseReservation({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
      reason: 'provider_not_started',
    })).resolves.toEqual({ ok: true, released: true })
    await expect(usage.releaseReservation({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
      reason: 'provider_not_started',
    })).resolves.toEqual({ ok: true, released: false })

    const settled = await database.adapter.query({
      text: `
        SELECT status, failure_code, provider_started_at,
          (
            SELECT used
            FROM usage_buckets
            WHERE subject_type = 'user'
              AND subject_key = $2::text
              AND metric = 'model_requests'
          ) AS model_used,
          (
            SELECT count(*)::integer
            FROM model_concurrency_slots
            WHERE request_id IS NOT NULL
          ) AS occupied_slots
        FROM model_requests
        WHERE id = $1::uuid
      `,
      values: [REQUEST_ID, OWNER],
    })
    expect(settled.rows).toEqual([{
      status: 'failed',
      failure_code: 'answer_operation_timeout_before_provider',
      provider_started_at: null,
      model_used: '0',
      occupied_slots: 0,
    }])
    await expect(usage.reconcileExpiredLeases()).resolves.toEqual({
      expiredRequests: 0,
      clearedSlots: 0,
    })
  })

  it('returns the same duplicate-success rejection on an exact settlement retry', async () => {
    await createDivisionShell(
      OWNER,
      REQUEST_ID,
      'Which duplicate model success should remain authoritative?',
    )
    await database.adapter.query({
      text: `
        INSERT INTO model_requests (
          id,
          clerk_user_id,
          game_id,
          operation,
          idempotency_key,
          request_sha256,
          status,
          provider,
          model,
          prompt_version,
          software_version,
          provider_response_id,
          response_sha256,
          result_payload,
          completed_at,
          created_at,
          updated_at,
          operation_deadline_at
        )
        VALUES
          (
            $1::uuid,
            $3::text,
            $4::uuid,
            'answer',
            $5::uuid,
            $7::text,
            'succeeded',
            'openai',
            'gpt-5.6-sol',
            'answer-v1',
            'integration-test',
            'resp_winner',
            $8::text,
            '{"kind":"answer","answer":"winner"}'::jsonb,
            $9::timestamptz,
            $9::timestamptz - interval '1 minute',
            $9::timestamptz,
            $9::timestamptz + interval '5 minutes'
          ),
          (
            $2::uuid,
            $3::text,
            $4::uuid,
            'answer',
            $6::uuid,
            $7::text,
            'in_progress',
            'openai',
            'gpt-5.6-sol',
            'answer-v1',
            'integration-test',
            NULL,
            NULL,
            NULL,
            NULL,
            $9::timestamptz,
            $9::timestamptz,
            $9::timestamptz + interval '145 seconds'
          )
      `,
      values: [
        OTHER_REQUEST_ID,
        THIRD_REQUEST_ID,
        OWNER,
        REQUEST_ID,
        OTHER_IDEMPOTENCY_KEY,
        THIRD_IDEMPOTENCY_KEY,
        SHA256,
        'b'.repeat(64),
        NOW.toISOString(),
      ],
    })
    await database.adapter.query({
      text: `
        UPDATE model_concurrency_slots
        SET
          request_id = $1::uuid,
          clerk_user_id = $2::text,
          lease_token = $3::uuid,
          lease_expires_at = $4::timestamptz
        WHERE slot = 1
      `,
      values: [
        THIRD_REQUEST_ID,
        OWNER,
        LEASE_TOKEN,
        new Date(NOW.valueOf() + 180_000).toISOString(),
      ],
    })

    let currentTime = new Date(NOW)
    const usage = controller(
      DEFAULT_CONFIG,
      () => new Date(currentTime),
    )
    const duplicate = {
      userId: OWNER,
      requestId: THIRD_REQUEST_ID,
      leaseToken: LEASE_TOKEN,
      outcome: 'succeeded' as const,
      providerResponseId: 'resp_duplicate',
      responseSha256: 'c'.repeat(64),
      resultPayload: {
        kind: 'answer',
        answer: 'duplicate',
      },
      usage: {
        reported: true,
        inputTokens: 25,
        cachedInputTokens: 5,
        cacheWriteInputTokens: 0,
        outputTokens: 10,
        reasoningTokens: 4,
        totalTokens: 35,
      },
    }
    await expect(usage.settleModelRequest(duplicate)).resolves.toEqual({
      ok: false,
      code: 'OPERATION_ALREADY_SUCCEEDED',
      httpStatus: 409,
    })
    const firstPersistence = await database.adapter.query({
      text: `
        SELECT
          status,
          failure_code,
          provider_response_id,
          updated_at,
          completed_at
        FROM model_requests
        WHERE id = $1::uuid
      `,
      values: [THIRD_REQUEST_ID],
    })

    currentTime = new Date(NOW.valueOf() + 60_000)
    await expect(usage.settleModelRequest(duplicate)).resolves.toEqual({
      ok: false,
      code: 'OPERATION_ALREADY_SUCCEEDED',
      httpStatus: 409,
    })
    const retriedPersistence = await database.adapter.query({
      text: `
        SELECT
          status,
          failure_code,
          provider_response_id,
          updated_at,
          completed_at
        FROM model_requests
        WHERE id = $1::uuid
      `,
      values: [THIRD_REQUEST_ID],
    })
    expect(retriedPersistence.rows).toEqual(firstPersistence.rows)
    expect(retriedPersistence.rows).toEqual([
      {
        status: 'rejected',
        failure_code: 'operation_already_succeeded',
        provider_response_id: 'resp_duplicate',
        updated_at: NOW,
        completed_at: NOW,
      },
    ])
    await expect(
      usage.settleModelRequest({
        ...duplicate,
        providerResponseId: 'resp_changed',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'SETTLEMENT_CONFLICT',
      httpStatus: 409,
    })
  })

  it('enforces daily, per-user concurrency, and deployment-wide limits durably', async () => {
    const dailyUsage = controller({
      ...DEFAULT_CONFIG,
      dailyGameLimit: 1,
    })
    await expect(
      dailyUsage.reserveModelRequest(divisionReservation()),
    ).resolves.toMatchObject({ ok: true, kind: 'reserved' })
    await expect(
      dailyUsage.reserveModelRequest(
        divisionReservation({
          requestId: OTHER_REQUEST_ID,
          idempotencyKey: OTHER_IDEMPOTENCY_KEY,
          requestSha256: 'b'.repeat(64),
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'GAME_START_DAILY_QUOTA_EXCEEDED',
      httpStatus: 429,
    })

    const otherUserUsage = controller({
      ...DEFAULT_CONFIG,
      dailyGlobalModelRequestLimit: 1,
    })
    await expect(
      otherUserUsage.reserveModelRequest(
        divisionReservation({
          requestId: OTHER_REQUEST_ID,
          userId: OTHER_OWNER,
          idempotencyKey: OTHER_IDEMPOTENCY_KEY,
          requestSha256: 'c'.repeat(64),
          ipAddress: '203.0.113.11',
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'MODEL_GLOBAL_DAILY_CAPACITY',
      httpStatus: 503,
    })
  })

  it('enforces durable user and IP move windows without storing raw identifiers', async () => {
    const usage = controller({
      ...DEFAULT_CONFIG,
      hourlyGameMoveLimit: 2,
      hourlyIpGameMoveLimit: 2,
    })

    await expect(
      usage.consumeGameMoveRate({
        userId: OWNER,
        ipAddress: '198.51.100.20',
      }),
    ).resolves.toMatchObject({
      ok: true,
      remaining: { user: 1, ip: 1 },
    })
    await expect(
      usage.consumeGameMoveRate({
        userId: OWNER,
        ipAddress: '198.51.100.20',
      }),
    ).resolves.toMatchObject({
      ok: true,
      remaining: { user: 0, ip: 0 },
    })
    await expect(
      usage.consumeGameMoveRate({
        userId: OWNER,
        ipAddress: '198.51.100.20',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'GAME_MOVE_HOURLY_RATE_LIMITED',
      httpStatus: 429,
    })

    const rows = await database.adapter.query({
      text: `
        SELECT key_type, key_hash, count
        FROM rate_buckets
        ORDER BY key_type
      `,
    })
    expect(rows.rows).toEqual([
      {
        key_type: 'ip',
        key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        count: 3,
      },
      {
        key_type: 'user',
        key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        count: 3,
      },
    ])
  })

  it('enforces durable account-export user and IP windows', async () => {
    const ipAddress = '198.51.100.44'
    const usage = controller({
      ...DEFAULT_CONFIG,
      hourlyAccountExportLimit: 2,
      hourlyIpAccountExportLimit: 2,
    })

    await expect(
      usage.consumeAccountExportRate({
        userId: OWNER,
        ipAddress,
      }),
    ).resolves.toMatchObject({
      ok: true,
      remaining: { user: 1, ip: 1 },
    })
    await expect(
      usage.consumeAccountExportRate({
        userId: OWNER,
        ipAddress,
      }),
    ).resolves.toMatchObject({
      ok: true,
      remaining: { user: 0, ip: 0 },
    })
    await expect(
      usage.consumeAccountExportRate({
        userId: OWNER,
        ipAddress,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'ACCOUNT_EXPORT_HOURLY_RATE_LIMITED',
      httpStatus: 429,
    })
    await expect(
      usage.consumeAccountExportRate({
        userId: OTHER_OWNER,
        ipAddress,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'IP_ACCOUNT_EXPORT_HOURLY_RATE_LIMITED',
      httpStatus: 429,
    })

    const persisted = await database.adapter.query({
      text: `
        SELECT key_type, count
        FROM rate_buckets
        WHERE action = 'account_export'
        ORDER BY key_type, count
      `,
    })
    expect(persisted.rows).toEqual([
      { key_type: 'ip', count: 4 },
      { key_type: 'user', count: 1 },
      { key_type: 'user', count: 3 },
    ])
  })

  it('keeps Wilbur action and observation user/IP windows independent', async () => {
    await createWilburRateTargets()
    const ipAddress = '198.51.100.45'
    const usage = controller({
      ...DEFAULT_CONFIG,
      hourlyWilburActionLimit: 2,
      hourlyIpWilburActionLimit: 3,
      hourlyWilburObservationLimit: 1,
      hourlyIpWilburObservationLimit: 2,
    })

    await expect(usage.consumeWilburMutationRate(
      await claimWilburRateMutation({
      ipAddress,
      kind: 'action',
      }),
    )).resolves.toMatchObject({
      ok: true,
      kind: 'consumed',
      remaining: { user: 1, ip: 2 },
    })
    await expect(usage.consumeWilburMutationRate(
      await claimWilburRateMutation({
      ipAddress,
      kind: 'action',
      }),
    )).resolves.toMatchObject({
      ok: true,
      remaining: { user: 0, ip: 1 },
    })
    await expect(usage.consumeWilburMutationRate(
      await claimWilburRateMutation({
      ipAddress,
      kind: 'action',
      }),
    )).resolves.toMatchObject({
      ok: false,
      code: 'WILBUR_ACTION_HOURLY_RATE_LIMITED',
      httpStatus: 429,
    })
    await expect(usage.consumeWilburMutationRate(
      await claimWilburRateMutation({
        userId: OTHER_OWNER,
        ipAddress,
        kind: 'action',
      }),
    )).resolves.toMatchObject({
      ok: true,
      remaining: { user: 1, ip: 0 },
    })
    await expect(usage.consumeWilburMutationRate(
      await claimWilburRateMutation({
      userId: OTHER_OWNER,
      ipAddress,
      kind: 'action',
      }),
    )).resolves.toMatchObject({
      ok: false,
      code: 'IP_WILBUR_ACTION_HOURLY_RATE_LIMITED',
      httpStatus: 429,
    })

    await expect(usage.consumeWilburMutationRate(
      await claimWilburRateMutation({
      ipAddress,
      kind: 'observation',
      }),
    )).resolves.toMatchObject({
      ok: true,
      remaining: { user: 0, ip: 1 },
    })
    await expect(usage.consumeWilburMutationRate(
      await claimWilburRateMutation({
      ipAddress,
      kind: 'observation',
      }),
    )).resolves.toMatchObject({
      ok: false,
      code: 'WILBUR_OBSERVATION_HOURLY_RATE_LIMITED',
      httpStatus: 429,
    })
    await expect(usage.consumeWilburMutationRate(
      await claimWilburRateMutation({
        userId: OTHER_OWNER,
        ipAddress,
        kind: 'observation',
      }),
    )).resolves.toMatchObject({
      ok: true,
      remaining: { user: 0, ip: 0 },
    })
    await expect(usage.consumeWilburMutationRate(
      await claimWilburRateMutation({
      userId: 'user_usage_integration_third',
      ipAddress,
      kind: 'observation',
      }),
    )).resolves.toMatchObject({
      ok: false,
      code: 'IP_WILBUR_OBSERVATION_HOURLY_RATE_LIMITED',
      httpStatus: 429,
    })

    const persisted = await database.adapter.query({
      text: `
        SELECT action, key_type, count
        FROM rate_buckets
        WHERE action IN ('wilbur_action', 'wilbur_observation')
        ORDER BY action, key_type, count
      `,
    })
    expect(persisted.rows).toEqual([
      { action: 'wilbur_action', key_type: 'ip', count: 4 },
      { action: 'wilbur_action', key_type: 'user', count: 2 },
      { action: 'wilbur_action', key_type: 'user', count: 3 },
      { action: 'wilbur_observation', key_type: 'ip', count: 3 },
      { action: 'wilbur_observation', key_type: 'user', count: 1 },
      { action: 'wilbur_observation', key_type: 'user', count: 1 },
      { action: 'wilbur_observation', key_type: 'user', count: 2 },
    ])
  })

  it('replays one Wilbur admission without debiting either bucket twice', async () => {
    await createWilburRateTargets()
    const usage = controller()
    const input = await claimWilburRateMutation({
      ipAddress: '198.51.100.48',
      kind: 'action',
    })

    await expect(usage.consumeWilburMutationRate(input)).resolves.toMatchObject({
      ok: true,
      kind: 'consumed',
    })
    await expect(usage.consumeWilburMutationRate(input)).resolves.toMatchObject({
      ok: true,
      kind: 'existing',
    })

    const persisted = await database.adapter.query({
      text: `
        SELECT key_type, count
        FROM rate_buckets
        WHERE action = 'wilbur_action'
        ORDER BY key_type
      `,
    })
    expect(persisted.rows).toEqual([
      { key_type: 'ip', count: 1 },
      { key_type: 'user', count: 1 },
    ])
    const ledger = await database.adapter.query({
      text: `
        SELECT status, rate_admitted_at IS NOT NULL AS admitted
        FROM wilbur_mutation_requests
        WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid
      `,
      values: [OWNER, input.idempotencyKey],
    })
    expect(ledger.rows).toEqual([{ status: 'pending', admitted: true }])
  })

  it('uses the database clock for Wilbur admission across app clock skew', async () => {
    await createWilburRateTargets()
    const clock = await database.adapter.query<{ database_now: Date }>({
      text: `SELECT clock_timestamp() AS database_now`,
    })
    const databaseNow = clock.rows[0]!.database_now

    for (const [idempotencyKey, skewMs, ipAddress] of [
      ['16000000-0000-4000-8000-000000000090', -30_000, '198.51.100.90'],
      ['16000000-0000-4000-8000-000000000091', 30_000, '198.51.100.91'],
    ] as const) {
      const usage = controller(
        DEFAULT_CONFIG,
        () => new Date(databaseNow.valueOf() + skewMs),
      )
      const input = await claimWilburRateMutation({
        ipAddress,
        kind: 'action',
        idempotencyKey,
        ledgerTimestamp: databaseNow,
      })

      await expect(
        usage.consumeWilburMutationRate(input),
      ).resolves.toMatchObject({ ok: true, kind: 'consumed' })
      await expect(database.adapter.query({
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
        values: [OWNER, idempotencyKey, WILBUR_RATE_ACTION_ID],
      })).resolves.toMatchObject({ rowCount: 1 })

      const persisted = await database.adapter.query({
        text: `
          SELECT
            status,
            rate_admitted_at IS NOT NULL AS admitted,
            rate_admitted_at <= updated_at AS monotone,
            updated_at <= clock_timestamp() AS not_future
          FROM wilbur_mutation_requests
          WHERE clerk_user_id = $1::text
            AND idempotency_key = $2::uuid
        `,
        values: [OWNER, idempotencyKey],
      })
      expect(persisted.rows).toEqual([{
        status: 'committed',
        admitted: true,
        monotone: true,
        not_future: true,
      }])
    }
  })

  it('rejects a changed Wilbur intent without debiting a rate bucket', async () => {
    await createWilburRateTargets()
    const usage = controller()
    const input = await claimWilburRateMutation({
      ipAddress: '198.51.100.49',
      kind: 'action',
    })

    await expect(usage.consumeWilburMutationRate({
      ...input,
      requestDigest: 'b'.repeat(64),
    })).resolves.toMatchObject({
      ok: false,
      code: 'IDEMPOTENCY_CONFLICT',
      httpStatus: 409,
    })
    const persisted = await database.adapter.query({
      text: `SELECT count(*)::integer AS count FROM rate_buckets`,
    })
    expect(persisted.rows).toEqual([{ count: 0 }])
  })

  it('replays a durable Wilbur denial without incrementing either bucket again', async () => {
    await createWilburRateTargets()
    const usage = controller({
      ...DEFAULT_CONFIG,
      hourlyWilburActionLimit: 0,
      hourlyIpWilburActionLimit: 10,
    })
    const input = await claimWilburRateMutation({
      ipAddress: '198.51.100.50',
      kind: 'action',
    })

    await expect(usage.consumeWilburMutationRate(input)).resolves.toMatchObject({
      ok: false,
      code: 'WILBUR_ACTION_HOURLY_RATE_LIMITED',
    })
    await expect(usage.consumeWilburMutationRate(input)).resolves.toMatchObject({
      ok: false,
      code: 'WILBUR_ACTION_HOURLY_RATE_LIMITED',
    })

    const persisted = await database.adapter.query({
      text: `
        SELECT key_type, count
        FROM rate_buckets
        WHERE action = 'wilbur_action'
        ORDER BY key_type
      `,
    })
    expect(persisted.rows).toEqual([{ key_type: 'user', count: 1 }])
    const ledger = await database.adapter.query({
      text: `
        SELECT
          status,
          denial_code,
          reserved_future_rows,
          reserved_text_bytes
        FROM wilbur_mutation_requests
        WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid
      `,
      values: [OWNER, input.idempotencyKey],
    })
    expect(ledger.rows).toEqual([{
      status: 'denied',
      denial_code: 'WILBUR_ACTION_HOURLY_RATE_LIMITED',
      reserved_future_rows: 0,
      reserved_text_bytes: '0',
    }])
  })

  it('serializes concurrent Wilbur admission without oversubscribing the user limit', async () => {
    await createWilburRateTargets()
    const usage = controller({
      ...DEFAULT_CONFIG,
      hourlyWilburActionLimit: 5,
      hourlyIpWilburActionLimit: 100,
    })
    const inputs = await Promise.all(
      Array.from({ length: 10 }, () => claimWilburRateMutation({
        ipAddress: '198.51.100.46',
        kind: 'action',
      })),
    )

    const results = await Promise.all(
      inputs.map((input) => usage.consumeWilburMutationRate(input)),
    )
    expect(results.filter((result) => result.ok)).toHaveLength(5)
    expect(results.filter((result) =>
      !result.ok && result.code === 'WILBUR_ACTION_HOURLY_RATE_LIMITED',
    )).toHaveLength(5)

    const persisted = await database.adapter.query({
      text: `
        SELECT key_type, count
        FROM rate_buckets
        WHERE action = 'wilbur_action'
        ORDER BY key_type
      `,
    })
    expect(persisted.rows).toEqual([
      { key_type: 'ip', count: 5 },
      { key_type: 'user', count: 10 },
    ])
  })

  it('denies Wilbur writes for suspended, blocked, and durably deleted users', async () => {
    await createWilburRateTargets()
    const usage = controller()
    const suspendedInput = await claimWilburRateMutation({
      ipAddress: '198.51.100.47',
      kind: 'action',
    })
    await database.adapter.query({
      text: `
        UPDATE user_controls
        SET suspended = true, updated_at = $2::timestamptz
        WHERE clerk_user_id = $1::text
      `,
      values: [OWNER, NOW.toISOString()],
    })

    await expect(usage.consumeWilburMutationRate(
      suspendedInput,
    )).resolves.toMatchObject({
      ok: false,
      code: 'ACCOUNT_SUSPENDED',
      httpStatus: 403,
    })

    await database.adapter.query({
      text: `
        UPDATE user_controls
        SET suspended = false
        WHERE clerk_user_id = $1::text
      `,
      values: [OWNER],
    })
    const blockedInput = await claimWilburRateMutation({
      ipAddress: '198.51.100.47',
      kind: 'observation',
    })
    const blockedUntil = new Date(NOW.valueOf() + 60_000)
    await database.adapter.query({
      text: `
        UPDATE user_controls
        SET suspended = false, blocked_until = $2::timestamptz
        WHERE clerk_user_id = $1::text
      `,
      values: [OWNER, blockedUntil.toISOString()],
    })
    await expect(usage.consumeWilburMutationRate(
      blockedInput,
    )).resolves.toMatchObject({
      ok: false,
      code: 'ACCOUNT_TEMPORARILY_BLOCKED',
      httpStatus: 403,
      retryAfterSeconds: 60,
    })

    await expect(
      usage.deleteAccountData(OWNER, { force: true }),
    ).resolves.toEqual({ ok: true, deleted: true })
    await expect(usage.consumeWilburMutationRate({
      userId: OWNER,
      ipAddress: '198.51.100.47',
      kind: 'action',
      operation: 'create_action',
      idempotencyKey: '16000000-0000-4000-8000-999999999999',
      requestDigest: SHA256,
    })).resolves.toMatchObject({
      ok: false,
      code: 'ACCOUNT_DELETED',
      httpStatus: 403,
    })
  })

  it('applies game-start rate limits to new divisions but not answers', async () => {
    await createDivisionShell(
      OWNER,
      REQUEST_ID,
      'Which answer should avoid the new-game start throttle?',
    )
    const usage = controller({
      ...DEFAULT_CONFIG,
      modelLeaseSeconds: 335,
      hourlyGameStartLimit: 1,
      hourlyIpGameStartLimit: 1,
    })
    const answerReservation = await usage.reserveModelRequest({
      ...divisionReservation({
        requestId: OTHER_REQUEST_ID,
        gameId: REQUEST_ID,
        operation: 'answer',
        idempotencyKey: OTHER_IDEMPOTENCY_KEY,
        requestSha256: 'f'.repeat(64),
        countsAsGameStart: false,
        operationDeadlineAt: new Date(NOW.valueOf() + 300_000),
        leaseExpiresAtCap: new Date(NOW.valueOf() + 335_000),
        ipAddress: '198.51.100.60',
      }),
    })
    expect(answerReservation).toMatchObject({ ok: true, kind: 'reserved' })
    if (!answerReservation.ok || !answerReservation.leaseToken) {
      throw new Error('Answer reservation did not return a lease.')
    }
    await usage.releaseReservation({
      userId: OWNER,
      requestId: OTHER_REQUEST_ID,
      leaseToken: answerReservation.leaseToken,
      reason: 'provider_not_started',
    })

    const firstDivision = await usage.reserveModelRequest(
      divisionReservation({
        requestId: THIRD_REQUEST_ID,
        idempotencyKey: THIRD_IDEMPOTENCY_KEY,
        requestSha256: '1'.repeat(64),
        ipAddress: '198.51.100.61',
      }),
    )
    expect(firstDivision).toMatchObject({ ok: true, kind: 'reserved' })
    if (!firstDivision.ok || !firstDivision.leaseToken) {
      throw new Error('Division reservation did not return a lease.')
    }
    await usage.releaseReservation({
      userId: OWNER,
      requestId: THIRD_REQUEST_ID,
      leaseToken: firstDivision.leaseToken,
      reason: 'provider_not_started',
    })
    await expect(
      usage.reserveModelRequest(
        divisionReservation({
          requestId: FOURTH_REQUEST_ID,
          idempotencyKey: FOURTH_IDEMPOTENCY_KEY,
          requestSha256: '2'.repeat(64),
          ipAddress: '198.51.100.62',
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'GAME_START_HOURLY_RATE_LIMITED',
      httpStatus: 429,
    })

    const otherUsage = controller({
      ...DEFAULT_CONFIG,
      hourlyGameStartLimit: 10,
      hourlyIpGameStartLimit: 1,
    })
    const sharedIp = '198.51.100.63'
    const otherFirst = await otherUsage.reserveModelRequest(
      divisionReservation({
        requestId: FIFTH_REQUEST_ID,
        userId: OTHER_OWNER,
        idempotencyKey: FIFTH_IDEMPOTENCY_KEY,
        requestSha256: '3'.repeat(64),
        ipAddress: sharedIp,
      }),
    )
    expect(otherFirst).toMatchObject({ ok: true, kind: 'reserved' })
    if (!otherFirst.ok || !otherFirst.leaseToken) {
      throw new Error('Other division reservation did not return a lease.')
    }
    await otherUsage.releaseReservation({
      userId: OTHER_OWNER,
      requestId: FIFTH_REQUEST_ID,
      leaseToken: otherFirst.leaseToken,
      reason: 'provider_not_started',
    })
    await expect(
      otherUsage.reserveModelRequest(
        divisionReservation({
          requestId: SIXTH_REQUEST_ID,
          userId: 'user_usage_integration_third',
          idempotencyKey: SIXTH_IDEMPOTENCY_KEY,
          requestSha256: '4'.repeat(64),
          ipAddress: sharedIp,
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'IP_GAME_START_HOURLY_RATE_LIMITED',
      httpStatus: 429,
    })
  })

  it('charges a replay game start exactly once and enforces account and daily boundaries', async () => {
    await createTerminalReplaySource(
      OWNER,
      REQUEST_ID,
      'Which replay start should count exactly once across retries?',
    )
    const usage = controller({
      ...DEFAULT_CONFIG,
      dailyGameLimit: 1,
      hourlyGameStartLimit: 10,
      hourlyIpGameStartLimit: 10,
    })
    const input = {
      userId: OWNER,
      sourceGameId: REQUEST_ID,
      expectedRevision: 0,
      idempotencyKey: IDEMPOTENCY_KEY,
      ipAddress: '198.51.100.30',
    }

    await expect(usage.consumeReplayGameStart(input)).resolves.toEqual({
      ok: true,
      kind: 'consumed',
      gameId: IDEMPOTENCY_KEY,
    })
    await expect(usage.consumeReplayGameStart(input)).resolves.toEqual({
      ok: true,
      kind: 'existing',
      gameId: IDEMPOTENCY_KEY,
    })
    const replayCurrentState = await database.adapter.query({
      text: `
        SELECT id::text, source_game_id::text, is_current
        FROM games
        WHERE clerk_user_id = $1::text
        ORDER BY id
      `,
      values: [OWNER],
    })
    expect(replayCurrentState.rows).toEqual([
      {
        id: REQUEST_ID,
        source_game_id: null,
        is_current: false,
      },
      {
        id: IDEMPOTENCY_KEY,
        source_game_id: REQUEST_ID,
        is_current: true,
      },
    ])
    await expect(
      usage.consumeReplayGameStart({
        ...input,
        expectedRevision: 1,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'IDEMPOTENCY_CONFLICT',
      httpStatus: 409,
    })
    await expect(
      usage.consumeReplayGameStart({
        ...input,
        idempotencyKey: OTHER_IDEMPOTENCY_KEY,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'GAME_START_DAILY_QUOTA_EXCEEDED',
      httpStatus: 429,
    })

    await database.adapter.query({
      text: `
        UPDATE user_controls
        SET
          suspended = true,
          reason_code = 'integration_suspension',
          updated_at = $2::timestamptz
        WHERE clerk_user_id = $1::text
      `,
      values: [OWNER, NOW.toISOString()],
    })
    await expect(
      usage.consumeReplayGameStart({
        ...input,
        idempotencyKey: THIRD_IDEMPOTENCY_KEY,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'ACCOUNT_SUSPENDED',
      httpStatus: 403,
    })
    await database.adapter.query({
      text: `
        UPDATE user_controls
        SET
          suspended = false,
          blocked_until = $2::timestamptz,
          reason_code = 'integration_temporary_block',
          updated_at = $3::timestamptz
        WHERE clerk_user_id = $1::text
      `,
      values: [
        OWNER,
        new Date(NOW.valueOf() + 60 * 60 * 1_000).toISOString(),
        NOW.toISOString(),
      ],
    })
    await expect(
      usage.consumeReplayGameStart({
        ...input,
        idempotencyKey: FOURTH_IDEMPOTENCY_KEY,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'ACCOUNT_TEMPORARILY_BLOCKED',
      httpStatus: 403,
    })

    const persisted = await database.adapter.query({
      text: `
        SELECT
          (
            SELECT count(*)::integer
            FROM game_start_requests
            WHERE clerk_user_id = $1::text
          ) AS requests,
          (
            SELECT used
            FROM usage_buckets
            WHERE
              subject_type = 'user'
              AND subject_key = $1::text
              AND metric = 'game_starts'
          ) AS used,
          (
            SELECT count
            FROM rate_buckets
            WHERE
              key_type = 'user'
              AND action = 'game_start'
          ) AS user_rate,
          (
            SELECT count
            FROM rate_buckets
            WHERE
              key_type = 'ip'
              AND action = 'game_start'
          ) AS ip_rate
      `,
      values: [OWNER],
    })
    expect(persisted.rows).toEqual([
      {
        requests: 1,
        used: '1',
        user_rate: 1,
        ip_rate: 1,
      },
    ])
  })

  it('enforces shared user and IP replay-start rate windows', async () => {
    await createTerminalReplaySource(
      OWNER,
      REQUEST_ID,
      'How should one owner share a replay start rate window?',
    )
    await createTerminalReplaySource(
      OTHER_OWNER,
      OTHER_REQUEST_ID,
      'How should two owners share one IP replay rate window?',
    )
    const ipAddress = '198.51.100.31'
    const userLimited = controller({
      ...DEFAULT_CONFIG,
      dailyGameLimit: 10,
      hourlyGameStartLimit: 1,
      hourlyIpGameStartLimit: 10,
    })
    await expect(
      userLimited.consumeReplayGameStart({
        userId: OWNER,
        sourceGameId: REQUEST_ID,
        expectedRevision: 0,
        idempotencyKey: IDEMPOTENCY_KEY,
        ipAddress,
      }),
    ).resolves.toEqual({
      ok: true,
      kind: 'consumed',
      gameId: IDEMPOTENCY_KEY,
    })
    await expect(
      userLimited.consumeReplayGameStart({
        userId: OWNER,
        sourceGameId: REQUEST_ID,
        expectedRevision: 0,
        idempotencyKey: OTHER_IDEMPOTENCY_KEY,
        ipAddress,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'GAME_START_HOURLY_RATE_LIMITED',
      httpStatus: 429,
    })

    const ipLimited = controller({
      ...DEFAULT_CONFIG,
      dailyGameLimit: 10,
      hourlyGameStartLimit: 10,
      hourlyIpGameStartLimit: 1,
    })
    await expect(
      ipLimited.consumeReplayGameStart({
        userId: OTHER_OWNER,
        sourceGameId: OTHER_REQUEST_ID,
        expectedRevision: 0,
        idempotencyKey: THIRD_IDEMPOTENCY_KEY,
        ipAddress,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'IP_GAME_START_HOURLY_RATE_LIMITED',
      httpStatus: 429,
    })

    const ledgers = await database.adapter.query({
      text: `
        SELECT clerk_user_id, count(*)::integer AS count
        FROM game_start_requests
        GROUP BY clerk_user_id
        ORDER BY clerk_user_id
      `,
    })
    expect(ledgers.rows).toEqual([{ clerk_user_id: OWNER, count: 1 }])
  })

  it('self-deletes mature Portia and Charlotte provenance before request ledgers', async () => {
    await createMatureLifecycleArtifacts()
    const usage = controller()

    await expect(usage.deleteAccountData(OWNER)).resolves.toEqual({
      ok: true,
      deleted: true,
    })

    const deleted = await database.adapter.query({
      text: `
        SELECT
          (SELECT count(*)::integer FROM games) AS games,
          (SELECT count(*)::integer FROM model_requests) AS requests,
          (SELECT count(*)::integer FROM lifecycle_runs) AS runs,
          (SELECT count(*)::integer FROM portia_reviews) AS portia,
          (SELECT count(*)::integer FROM gate_decisions) AS gates,
          (SELECT count(*)::integer FROM charlotte_results) AS charlotte,
          (SELECT count(*)::integer FROM deleted_user_tombstones) AS barriers,
          (
            SELECT suspended FROM user_controls
            WHERE clerk_user_id = $1::text
          ) AS suspended,
          (
            SELECT reason_code FROM user_controls
            WHERE clerk_user_id = $1::text
          ) AS reason_code
      `,
      values: [OWNER],
    })
    expect(deleted.rows).toEqual([{
      games: 0,
      requests: 0,
      runs: 0,
      portia: 0,
      gates: 0,
      charlotte: 0,
      barriers: 0,
      suspended: true,
      reason_code: 'ACCOUNT_DELETION_PENDING',
    }])
  })

  it('preserves mature provenance during active self-deletion and lets force win', async () => {
    await createMatureLifecycleArtifacts()
    await attachActiveMatureRequest()
    const usage = controller()

    await expect(usage.deleteAccountData(OWNER)).resolves.toEqual({
      ok: false,
      code: 'ACTIVE_MODEL_REQUEST',
      httpStatus: 409,
      retryAfterSeconds: 180,
    })
    const preserved = await database.adapter.query({
      text: `
        SELECT
          (SELECT count(*)::integer FROM games) AS games,
          (SELECT count(*)::integer FROM model_requests) AS requests,
          (SELECT count(*)::integer FROM lifecycle_runs) AS runs,
          (SELECT count(*)::integer FROM portia_reviews) AS portia,
          (SELECT count(*)::integer FROM gate_decisions) AS gates,
          (SELECT count(*)::integer FROM charlotte_results) AS charlotte,
          (
            SELECT count(*)::integer FROM model_concurrency_slots
            WHERE request_id IS NOT NULL
          ) AS occupied_slots
      `,
    })
    expect(preserved.rows).toEqual([{
      games: 1,
      requests: 3,
      runs: 1,
      portia: 1,
      gates: 1,
      charlotte: 1,
      occupied_slots: 1,
    }])

    await expect(
      usage.deleteAccountData(OWNER, { force: true }),
    ).resolves.toEqual({ ok: true, deleted: true })
    const forced = await database.adapter.query({
      text: `
        SELECT
          (SELECT count(*)::integer FROM user_controls) AS users,
          (SELECT count(*)::integer FROM games) AS games,
          (SELECT count(*)::integer FROM model_requests) AS requests,
          (SELECT count(*)::integer FROM lifecycle_runs) AS runs,
          (SELECT count(*)::integer FROM portia_reviews) AS portia,
          (SELECT count(*)::integer FROM charlotte_results) AS charlotte,
          (SELECT count(*)::integer FROM deleted_user_tombstones) AS barriers,
          (
            SELECT count(*)::integer FROM model_concurrency_slots
            WHERE request_id IS NOT NULL
          ) AS occupied_slots
      `,
    })
    expect(forced.rows).toEqual([{
      users: 0,
      games: 0,
      requests: 0,
      runs: 0,
      portia: 0,
      charlotte: 0,
      barriers: 1,
      occupied_slots: 0,
    }])
  })

  it('cancels reserved work for self-deletion and keeps a durable force-deletion barrier', async () => {
    const usage = controller()
    const reserved = await usage.reserveModelRequest(divisionReservation())
    expect(reserved).toMatchObject({
      ok: true,
      leaseToken: LEASE_TOKEN,
    })
    await expect(usage.deleteAccountData(OWNER)).resolves.toEqual({
      ok: true,
      deleted: true,
    })
    await expect(usage.deleteAccountData(OWNER)).resolves.toEqual({
      ok: true,
      deleted: true,
    })

    const retained = await database.adapter.query({
      text: `
        SELECT
          (SELECT count(*)::integer FROM user_controls) AS users,
          (
            SELECT suspended
            FROM user_controls
            WHERE clerk_user_id = $1::text
          ) AS suspended,
          (
            SELECT reason_code
            FROM user_controls
            WHERE clerk_user_id = $1::text
          ) AS reason_code,
          (SELECT count(*)::integer FROM games) AS games,
          (SELECT count(*)::integer FROM game_events) AS events,
          (SELECT count(*)::integer FROM model_requests) AS requests,
          (
            SELECT count(*)::integer
            FROM usage_buckets
            WHERE subject_type = 'user'
          ) AS user_usage,
          (
            SELECT count(*)::integer
            FROM rate_buckets
            WHERE key_type = 'user'
          ) AS user_rates,
          (
            SELECT count(*)::integer
            FROM model_concurrency_slots
            WHERE request_id IS NOT NULL
          ) AS occupied_slots
      `,
      values: [OWNER],
    })
    expect(retained.rows).toEqual([
      {
        users: 1,
        suspended: true,
        reason_code: 'ACCOUNT_DELETION_PENDING',
        games: 0,
        events: 0,
        requests: 0,
        user_usage: 0,
        user_rates: 0,
        occupied_slots: 0,
      },
    ])

    await expect(
      usage.reserveModelRequest(divisionReservation()),
    ).resolves.toMatchObject({
      ok: false,
      code: 'ACCOUNT_SUSPENDED',
      httpStatus: 403,
    })
    await expect(
      usage.consumeGameMoveRate({
        userId: OWNER,
        ipAddress: '198.51.100.20',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'ACCOUNT_SUSPENDED',
      httpStatus: 403,
    })
    await expect(
      usage.consumeAccountExportRate({
        userId: OWNER,
        ipAddress: '198.51.100.20',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'ACCOUNT_SUSPENDED',
      httpStatus: 403,
    })

    const afterDeniedReuse = await database.adapter.query({
      text: `
        SELECT
          (SELECT count(*)::integer FROM games) AS games,
          (SELECT count(*)::integer FROM model_requests) AS requests,
          (SELECT count(*)::integer FROM usage_buckets) AS usage,
          (
            SELECT count(*)::integer
            FROM rate_buckets
            WHERE key_type = 'user'
          ) AS user_rates
      `,
    })
    expect(afterDeniedReuse.rows).toEqual([
      {
        games: 0,
        requests: 0,
        usage: 1,
        user_rates: 0,
      },
    ])

    await expect(
      usage.deleteAccountData(OWNER, { force: true }),
    ).resolves.toEqual({
      ok: true,
      deleted: true,
    })
    await expect(
      usage.deleteAccountData(OWNER, { force: true }),
    ).resolves.toEqual({
      ok: true,
      deleted: false,
    })

    const forcedCleanup = await database.adapter.query({
      text: `
        SELECT
          (
            SELECT count(*)::integer
            FROM deleted_user_tombstones
          ) AS barriers,
          (
            SELECT user_key_hash
            FROM deleted_user_tombstones
            LIMIT 1
          ) AS barrier_hash,
          (SELECT count(*)::integer FROM user_controls) AS users,
          (SELECT count(*)::integer FROM games) AS games,
          (SELECT count(*)::integer FROM model_requests) AS requests,
          (
            SELECT count(*)::integer
            FROM usage_buckets
            WHERE subject_type = 'user'
          ) AS user_usage,
          (
            SELECT count(*)::integer
            FROM rate_buckets
            WHERE key_type = 'user'
          ) AS user_rates
      `,
    })
    expect(forcedCleanup.rows).toEqual([
      {
        barriers: 1,
        barrier_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        users: 0,
        games: 0,
        requests: 0,
        user_usage: 0,
        user_rates: 0,
      },
    ])
    expect(forcedCleanup.rows[0]?.barrier_hash).not.toContain(OWNER)

    await expect(
      usage.reserveModelRequest(divisionReservation()),
    ).resolves.toMatchObject({
      ok: false,
      code: 'ACCOUNT_DELETED',
      httpStatus: 403,
      retryAfterSeconds: null,
    })
    await expect(
      usage.consumeGameMoveRate({
        userId: OWNER,
        ipAddress: '198.51.100.21',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'ACCOUNT_DELETED',
      httpStatus: 403,
    })
    await expect(
      usage.consumeAccountExportRate({
        userId: OWNER,
        ipAddress: '198.51.100.21',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'ACCOUNT_DELETED',
      httpStatus: 403,
    })
    await expect(usage.getUsageSummary(OWNER)).resolves.toMatchObject({
      ok: false,
      code: 'ACCOUNT_DELETED',
      httpStatus: 403,
    })
    await expect(
      usage.consumeReplayGameStart({
        userId: OWNER,
        sourceGameId: REQUEST_ID,
        expectedRevision: 0,
        idempotencyKey: OTHER_IDEMPOTENCY_KEY,
        ipAddress: '198.51.100.21',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'ACCOUNT_DELETED',
      httpStatus: 403,
    })

    const afterBarrierDenials = await database.adapter.query({
      text: `
        SELECT
          (SELECT count(*)::integer FROM user_controls) AS users,
          (
            SELECT count(*)::integer
            FROM usage_buckets
            WHERE subject_type = 'user'
          ) AS user_usage,
          (
            SELECT count(*)::integer
            FROM rate_buckets
            WHERE key_type = 'user'
          ) AS user_rates,
          (SELECT count(*)::integer FROM game_start_requests) AS replays
      `,
    })
    expect(afterBarrierDenials.rows).toEqual([
      { users: 0, user_usage: 0, user_rates: 0, replays: 0 },
    ])
  })

  it('blocks self-deletion during provider work but force deletion wins and rejects late settlement', async () => {
    const usage = controller()
    await usage.reserveModelRequest(divisionReservation())
    const games = new DurableGameRepository(database.adapter)
    await games.getOrCreateDivision({
      ownerId: OWNER,
      gameId: REQUEST_ID,
      problem: 'Should forced deletion win while provider work is active?',
      softwareVersion: 'integration-test',
      researchConsent: NO_EXTERNAL_RESEARCH_CONSENT,
    })
    await usage.attachModelRequestGame({
      userId: OWNER,
      requestId: REQUEST_ID,
      gameId: REQUEST_ID,
    })
    await usage.beginProviderCall({
      userId: OWNER,
      requestId: REQUEST_ID,
      leaseToken: LEASE_TOKEN,
    })

    await expect(usage.deleteAccountData(OWNER)).resolves.toMatchObject({
      ok: false,
      code: 'ACTIVE_MODEL_REQUEST',
      httpStatus: 409,
      retryAfterSeconds: 180,
    })
    await expect(
      usage.deleteAccountData(OWNER, { force: true }),
    ).resolves.toEqual({
      ok: true,
      deleted: true,
    })
    await expect(
      usage.settleModelRequest({
        userId: OWNER,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
        outcome: 'failed',
        failureCode: 'late_after_force_delete',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'REQUEST_NOT_FOUND',
      httpStatus: 409,
    })
    await expect(
      usage.beginProviderCall({
        userId: OWNER,
        requestId: REQUEST_ID,
        leaseToken: LEASE_TOKEN,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'ACCOUNT_DELETED',
      httpStatus: 403,
    })

    const deleted = await database.adapter.query({
      text: `
        SELECT
          (SELECT count(*)::integer FROM deleted_user_tombstones)
            AS barriers,
          (SELECT count(*)::integer FROM user_controls) AS users,
          (SELECT count(*)::integer FROM games) AS games,
          (SELECT count(*)::integer FROM model_requests) AS requests,
          (
            SELECT count(*)::integer
            FROM model_concurrency_slots
            WHERE request_id IS NOT NULL
          ) AS occupied_slots
      `,
    })
    expect(deleted.rows).toEqual([
      {
        barriers: 1,
        users: 0,
        games: 0,
        requests: 0,
        occupied_slots: 0,
      },
    ])
  })
})
