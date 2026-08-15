// @vitest-environment node

import { describe, expect, it } from 'vitest'

import {
  deletedUserTombstoneRowSchema,
  gameEventRowSchema,
  gameRowSchema,
  gameStartRequestRowSchema,
  modelConcurrencySlotRowSchema,
  modelRequestRowSchema,
  parseOptionalResultRow,
  parseSingleResultRow,
  rateBucketRowSchema,
  usageBucketRowSchema,
  userControlsRowSchema,
  wilburActionRowSchema,
  wilburMutationRequestRowSchema,
} from './rows'
import type { SqlResult, SqlRow } from './sql'

const GAME_ID = '11111111-1111-4111-8111-111111111111'
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'
const IDEMPOTENCY_KEY = '33333333-3333-4333-8333-333333333333'
const LEASE_TOKEN = '44444444-4444-4444-8444-444444444444'
const HASH = 'a'.repeat(64)
const NOW = '2026-07-26T12:00:00.000Z'

function result(rows: readonly SqlRow[]): SqlResult {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    rows,
  }
}

describe('database row validators', () => {
  it('normalizes timestamps and PostgreSQL bigint strings', () => {
    expect(
      deletedUserTombstoneRowSchema.parse({
        user_key_hash: HASH,
        deleted_at: NOW,
      }).deleted_at,
    ).toEqual(new Date(NOW))

    const game = gameRowSchema.parse({
      id: GAME_ID,
      clerk_user_id: 'user_test',
      source_game_id: null,
      is_current: true,
      revision: '12',
      status: 'dividing',
      problem: 'How should I approach this decision?',
      problem_sha256: HASH,
      division_seed: null,
      division_facets: null,
      problem_parts: null,
      division_model: null,
      division_prompt_version: null,
      division_prompt_sha256: null,
      division_digest: null,
      rules_version: 'circular-v2',
      engine_version: 'engine-v2',
      cast_version: 'cast-v1',
      event_version: 1,
      software_version: '0.2.0',
      outcome: null,
      answer_payload: null,
      created_at: NOW,
      updated_at: NOW,
      completed_at: null,
      answered_at: null,
    })

    expect(game.revision).toBe(12n)
    expect(game.created_at).toBeInstanceOf(Date)
  })

  it('enforces post-division and answered-game fields', () => {
    const base = {
      id: GAME_ID,
      clerk_user_id: 'user_test',
      source_game_id: null,
      is_current: true,
      revision: 1,
      status: 'answered',
      problem: 'How should I approach this decision?',
      problem_sha256: HASH,
      division_seed: null,
      division_facets: null,
      problem_parts: null,
      division_model: null,
      division_prompt_version: null,
      division_prompt_sha256: null,
      division_digest: null,
      rules_version: 'circular-v2',
      engine_version: 'engine-v2',
      cast_version: 'cast-v1',
      event_version: 1,
      software_version: '0.2.0',
      outcome: null,
      answer_payload: null,
      created_at: NOW,
      updated_at: NOW,
      completed_at: null,
      answered_at: null,
    }

    const parsed = gameRowSchema.safeParse(base)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join('.'))
      expect(paths).toContain('division_digest')
      expect(paths).toContain('outcome')
      expect(paths).toContain('answer_payload')
    }
  })

  it('accepts a wholly pre-division abandoned row but rejects partial division material', () => {
    const abandoned = {
      id: GAME_ID,
      clerk_user_id: 'user_test',
      source_game_id: null,
      is_current: false,
      revision: 1,
      status: 'abandoned',
      problem: 'How should I approach this decision?',
      problem_sha256: HASH,
      division_seed: null,
      division_facets: null,
      problem_parts: null,
      division_model: null,
      division_prompt_version: null,
      division_prompt_sha256: null,
      division_digest: null,
      rules_version: 'circular-v2',
      engine_version: 'engine-v2',
      cast_version: 'cast-v1',
      event_version: 1,
      software_version: '0.2.0',
      outcome: null,
      answer_payload: null,
      created_at: NOW,
      updated_at: NOW,
      completed_at: null,
      answered_at: null,
    }

    expect(gameRowSchema.safeParse(abandoned).success).toBe(true)
    expect(
      gameRowSchema.safeParse({
        ...abandoned,
        division_seed: 'partial-seed',
      }).success,
    ).toBe(false)
    expect(
      gameRowSchema.safeParse({
        ...abandoned,
        answer_payload: { answer: 'Impossible pre-division answer.' },
      }).success,
    ).toBe(false)
  })

  it('accepts canonical client moves and forced server passes only', () => {
    const move = gameEventRowSchema.parse({
      game_id: GAME_ID,
      ply: 1,
      kind: 'move',
      source: 'client',
      side: 'white',
      piece_id: 'white-pawn-1',
      captured_piece_id: null,
      promoted_to: null,
      from_ring: 1,
      from_sector: 1,
      to_ring: 2,
      to_sector: 1,
      idempotency_key: IDEMPOTENCY_KEY,
      request_sha256: HASH,
      game_revision: '1',
      created_at: NOW,
    })
    expect(move.game_revision).toBe(1n)

    expect(
      gameEventRowSchema.safeParse({
        ...move,
        kind: 'pass',
        source: 'server',
        piece_id: null,
        idempotency_key: null,
        request_sha256: null,
      }).success,
    ).toBe(false)

    expect(
      gameEventRowSchema.safeParse({
        ...move,
        source: 'server',
        idempotency_key: null,
        request_sha256: null,
      }).success,
    ).toBe(false)
  })

  it('validates controls, usage, rate, request, and lease rows', () => {
    expect(
      userControlsRowSchema.parse({
        clerk_user_id: 'user_test',
        suspended: false,
        blocked_until: null,
        reason_code: null,
        daily_game_limit: 2,
        daily_model_request_limit: 100,
        hourly_model_request_limit: 20,
        concurrent_model_limit: 1,
        created_at: NOW,
        last_seen_at: NOW,
        updated_at: NOW,
      }).daily_game_limit,
    ).toBe(2)

    expect(
      modelRequestRowSchema.parse({
        id: REQUEST_ID,
        clerk_user_id: 'user_test',
        game_id: GAME_ID,
        operation: 'division',
        idempotency_key: IDEMPOTENCY_KEY,
        request_sha256: HASH,
        status: 'reserved',
        attempt: 1,
        provider: 'openai',
        model: 'gpt-5.6-sol',
        prompt_version: 'division-v1',
        software_version: '0.2.0',
        provider_response_id: null,
        response_sha256: null,
        result_payload: null,
        usage_reported: false,
        input_tokens: null,
        cached_input_tokens: null,
        cache_write_input_tokens: null,
        output_tokens: null,
        reasoning_tokens: null,
        total_tokens: null,
        provider_started_at: null,
        completed_at: null,
        failure_code: null,
        provider_http_status: null,
        created_at: NOW,
        updated_at: NOW,
      }).operation,
    ).toBe('division')

    const succeededRequest = {
      id: REQUEST_ID,
      clerk_user_id: 'user_test',
      game_id: GAME_ID,
      operation: 'answer',
      idempotency_key: IDEMPOTENCY_KEY,
      request_sha256: HASH,
      status: 'succeeded',
      attempt: 1,
      provider: 'openai',
      model: 'gpt-5.6-sol',
      prompt_version: 'answer-v1',
      software_version: '0.2.0',
      provider_response_id: 'resp_test',
      response_sha256: HASH,
      usage_reported: true,
      input_tokens: '10',
      cached_input_tokens: '0',
      cache_write_input_tokens: '2',
      output_tokens: '20',
      reasoning_tokens: '5',
      total_tokens: '30',
      provider_started_at: NOW,
      completed_at: NOW,
      failure_code: null,
      provider_http_status: 200,
      created_at: NOW,
      updated_at: NOW,
    }

    expect(
      modelRequestRowSchema.safeParse({
        ...succeededRequest,
        result_payload: null,
      }).success,
    ).toBe(false)
    expect(
      modelRequestRowSchema.parse({
        ...succeededRequest,
        result_payload: { kind: 'answer', answer: 'Validated result.' },
      }).result_payload,
    ).toEqual({ kind: 'answer', answer: 'Validated result.' })
    expect(
      modelRequestRowSchema.safeParse({
        ...succeededRequest,
        result_payload: { kind: 'answer', answer: 'Validated result.' },
        usage_reported: false,
      }).success,
    ).toBe(false)

    expect(
      usageBucketRowSchema.parse({
        subject_type: 'user',
        subject_key: 'user_test',
        metric: 'model_requests',
        bucket_start: NOW,
        bucket_seconds: 86_400,
        used: '4',
        reserved: '1',
        updated_at: NOW,
      }).reserved,
    ).toBe(1n)

    expect(
      gameStartRequestRowSchema.parse({
        idempotency_key: IDEMPOTENCY_KEY,
        clerk_user_id: 'user_test',
        kind: 'replay',
        source_game_id: GAME_ID,
        expected_revision: '12',
        created_at: NOW,
        updated_at: NOW,
        activated_at: null,
      }).expected_revision,
    ).toBe(12n)

    expect(
      rateBucketRowSchema.safeParse({
        key_type: 'ip',
        key_hash: HASH,
        action: 'game_start',
        window_start: NOW,
        window_seconds: 60,
        count: 1,
        expires_at: '2026-07-26T12:00:30.000Z',
      }).success,
    ).toBe(false)

    expect(
      modelConcurrencySlotRowSchema.parse({
        slot: 1,
        enabled: true,
        request_id: REQUEST_ID,
        clerk_user_id: 'user_test',
        lease_token: LEASE_TOKEN,
        lease_expires_at: '2026-07-26T12:05:00.000Z',
      }).request_id,
    ).toBe(REQUEST_ID)
  })

  it('enforces single-row result cardinality', () => {
    const row = {
      clerk_user_id: 'user_test',
      suspended: false,
      blocked_until: null,
      reason_code: null,
      daily_game_limit: null,
      daily_model_request_limit: null,
      hourly_model_request_limit: null,
      concurrent_model_limit: null,
      created_at: NOW,
      last_seen_at: NOW,
      updated_at: NOW,
    }

    expect(
      parseSingleResultRow(result([row]), userControlsRowSchema).clerk_user_id,
    ).toBe('user_test')
    expect(
      parseOptionalResultRow(result([]), userControlsRowSchema),
    ).toBeUndefined()
    expect(() =>
      parseSingleResultRow(result([]), userControlsRowSchema),
    ).toThrow(/exactly one/)
    expect(() =>
      parseOptionalResultRow(result([row, row]), userControlsRowSchema),
    ).toThrow(/at most one/)
  })

  it('parses current and legacy Wilbur bindings plus durable mutation rows', () => {
    const action = {
      id: REQUEST_ID,
      clerk_user_id: 'user_test',
      lifecycle_run_id: GAME_ID,
      charlotte_action_index: 0,
      idempotency_key: IDEMPOTENCY_KEY,
      request_digest: HASH,
      actor: 'A project owner',
      action: 'Run the smallest useful test.',
      tested_assumption: 'The proposed path is feasible.',
      expected_observation: 'The trial completes within the window.',
      decision_threshold: 'Continue only if the trial meets the threshold.',
      review_horizon: 'One week',
      status: 'planned',
      revision: '0',
      record_version: 'wilbur-v1',
      created_at: NOW,
      updated_at: NOW,
      charlotte_binding_version:
        'webchess-charlotte-action-binding-v1',
    }

    expect(
      wilburActionRowSchema.parse(action).charlotte_binding_version,
    ).toBe('webchess-charlotte-action-binding-v1')
    expect(
      wilburActionRowSchema.parse({
        ...action,
        charlotte_binding_version: null,
      }).charlotte_binding_version,
    ).toBeNull()

    const mutation = wilburMutationRequestRowSchema.parse({
      clerk_user_id: 'user_test',
      idempotency_key: IDEMPOTENCY_KEY,
      operation: 'create_action',
      request_digest: HASH,
      target_game_id: GAME_ID,
      target_action_id: null,
      rate_kind: 'action',
      rate_admitted_at: NOW,
      denial_code: null,
      retry_at: null,
      reserved_future_rows: 2,
      reserved_text_bytes: '314',
      status: 'pending',
      result_entity_id: null,
      result_revision: null,
      result_status: null,
      result_updated_at: null,
      created_at: NOW,
      updated_at: NOW,
    })

    expect(mutation.reserved_text_bytes).toBe(314n)
  })
})
