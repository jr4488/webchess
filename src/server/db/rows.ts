import { z } from 'zod'

import {
  ASSUMPTION_RESULTS,
  CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION,
  LIFECYCLE_STATES,
  WILBUR_ACTION_STATUSES,
} from '../../lib/lifecycle/contracts'
import type { SqlResult } from './sql'

const uuidSchema = z.string().uuid()
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const nonemptyTextSchema = z.string().min(1)
const jsonObjectSchema = z.record(z.string(), z.unknown())
const jsonArray64Schema = z.array(z.unknown()).length(64)

const timestampSchema = z.preprocess(
  (value) => (typeof value === 'string' ? new Date(value) : value),
  z.date(),
)

const bigintSchema = z
  .union([
    z.bigint(),
    z.number().int().safe(),
    z.string().regex(/^-?\d+$/),
  ])
  .transform((value) => BigInt(value))

const nonnegativeBigintSchema = bigintSchema.refine(
  (value) => value >= 0n,
  'Expected a nonnegative bigint.',
)

const positiveBigintSchema = bigintSchema.refine(
  (value) => value > 0n,
  'Expected a positive bigint.',
)

export const deletedUserTombstoneRowSchema = z.object({
  user_key_hash: sha256Schema,
  deleted_at: timestampSchema,
})

export const userControlsRowSchema = z.object({
  clerk_user_id: z.string().min(3).max(255),
  suspended: z.boolean(),
  blocked_until: timestampSchema.nullable(),
  reason_code: z.string().min(1).max(80).nullable(),
  daily_game_limit: z.number().int().positive().nullable(),
  daily_model_request_limit: z.number().int().positive().nullable(),
  hourly_model_request_limit: z.number().int().positive().nullable(),
  concurrent_model_limit: z.number().int().min(1).max(4).nullable(),
  created_at: timestampSchema,
  last_seen_at: timestampSchema,
  updated_at: timestampSchema,
})

export const gameStatusSchema = z.enum([
  'dividing',
  'division_failed',
  'mapped',
  'playing',
  'completed',
  'answering',
  'answer_failed',
  'answered',
  'abandoned',
  'integrity_error',
])

export const gameRowSchema = z
  .object({
    id: uuidSchema,
    clerk_user_id: z.string().min(3).max(255),
    source_game_id: uuidSchema.nullable(),
    is_current: z.boolean(),
    revision: nonnegativeBigintSchema,
    status: gameStatusSchema,
    problem: z.string().min(12).max(240),
    problem_sha256: sha256Schema,
    division_seed: z.string().min(1).max(512).nullable(),
    division_facets: jsonArray64Schema.nullable(),
    problem_parts: jsonArray64Schema.nullable(),
    division_model: z.string().min(1).max(120).nullable(),
    division_prompt_version: z.string().min(1).max(80).nullable(),
    division_prompt_sha256: sha256Schema.nullable(),
    division_digest: sha256Schema.nullable(),
    rules_version: z.string().min(1).max(80),
    engine_version: z.string().min(1).max(80),
    cast_version: z.string().min(1).max(80),
    event_version: z.number().int().positive(),
    software_version: z.string().min(1).max(120),
    outcome: jsonObjectSchema.nullable(),
    answer_payload: jsonObjectSchema.nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
    completed_at: timestampSchema.nullable(),
    answered_at: timestampSchema.nullable(),
  })
  .superRefine((row, context) => {
    if (row.status !== 'dividing' && row.status !== 'division_failed') {
      const divisionFields = [
        ['division_seed', row.division_seed],
        ['division_facets', row.division_facets],
        ['problem_parts', row.problem_parts],
        ['division_model', row.division_model],
        ['division_prompt_version', row.division_prompt_version],
        ['division_prompt_sha256', row.division_prompt_sha256],
        ['division_digest', row.division_digest],
      ] as const
      const abandonedBeforeDivision =
        row.status === 'abandoned' &&
        divisionFields.every(([, value]) => value === null)

      if (!abandonedBeforeDivision) {
        for (const [field, value] of divisionFields) {
          if (value === null) {
            context.addIssue({
              code: 'custom',
              message: `${field} is required for ${row.status} games.`,
              path: [field],
            })
          }
        }
      } else {
        for (const [field, value] of [
          ['outcome', row.outcome],
          ['answer_payload', row.answer_payload],
          ['completed_at', row.completed_at],
          ['answered_at', row.answered_at],
        ] as const) {
          if (value !== null) {
            context.addIssue({
              code: 'custom',
              message: `${field} must be empty for a pre-division abandoned game.`,
              path: [field],
            })
          }
        }
      }
    }

    if (
      ['completed', 'answering', 'answer_failed', 'answered'].includes(
        row.status,
      ) &&
      row.outcome === null
    ) {
      context.addIssue({
        code: 'custom',
        message: `outcome is required for ${row.status} games.`,
        path: ['outcome'],
      })
    }

    if (row.status === 'answered' && row.answer_payload === null) {
      context.addIssue({
        code: 'custom',
        message: 'answer_payload is required for answered games.',
        path: ['answer_payload'],
      })
    }
  })

export const gameEventKindSchema = z.enum(['move', 'pass'])
export const gameEventSourceSchema = z.enum(['client', 'server'])
export const gameSideSchema = z.enum(['white', 'black'])

export const gameEventRowSchema = z
  .object({
    game_id: uuidSchema,
    ply: z.number().int().min(1).max(256),
    kind: gameEventKindSchema,
    source: gameEventSourceSchema,
    side: gameSideSchema,
    piece_id: z.string().min(1).max(80).nullable(),
    captured_piece_id: z.string().min(1).max(80).nullable(),
    promoted_to: z.literal('queen').nullable(),
    from_ring: z.number().int().min(0).max(7).nullable(),
    from_sector: z.number().int().min(0).max(7).nullable(),
    to_ring: z.number().int().min(0).max(7).nullable(),
    to_sector: z.number().int().min(0).max(7).nullable(),
    idempotency_key: uuidSchema.nullable(),
    request_sha256: sha256Schema.nullable(),
    game_revision: positiveBigintSchema,
    created_at: timestampSchema,
  })
  .superRefine((row, context) => {
    const moveFields = [
      ['piece_id', row.piece_id],
      ['from_ring', row.from_ring],
      ['from_sector', row.from_sector],
      ['to_ring', row.to_ring],
      ['to_sector', row.to_sector],
    ] as const

    if (row.kind === 'move') {
      for (const [field, value] of moveFields) {
        if (value === null) {
          context.addIssue({
            code: 'custom',
            message: `${field} is required for a move event.`,
            path: [field],
          })
        }
      }
    } else {
      for (const [field, value] of [
        ...moveFields,
        ['captured_piece_id', row.captured_piece_id] as const,
        ['promoted_to', row.promoted_to] as const,
      ]) {
        if (value !== null) {
          context.addIssue({
            code: 'custom',
            message: `${field} must be null for a pass event.`,
            path: [field],
          })
        }
      }
    }

    if (
      row.source === 'client' &&
      (row.kind !== 'move' ||
        row.idempotency_key === null ||
        row.request_sha256 === null)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Client events must be idempotent moves with a request digest.',
      })
    }

    if (
      row.source === 'server' &&
      (row.kind !== 'pass' ||
        row.idempotency_key !== null ||
        row.request_sha256 !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Server events must be forced passes without client request fields.',
      })
    }
  })

export const modelOperationSchema = z.enum([
  'division',
  'answer',
  'portia',
  'charlotte',
])
export const modelRequestStatusSchema = z.enum([
  'reserved',
  'in_progress',
  'succeeded',
  'failed',
  'rejected',
  'indeterminate',
])

export const modelRequestRowSchema = z
  .object({
    id: uuidSchema,
    clerk_user_id: z.string().min(3).max(255),
    game_id: uuidSchema.nullable(),
    operation: modelOperationSchema,
    idempotency_key: uuidSchema,
    request_sha256: sha256Schema,
    status: modelRequestStatusSchema,
    attempt: z.number().int().positive(),
    provider: z.string().min(1).max(40),
    model: z.string().min(1).max(120),
    prompt_version: z.string().min(1).max(80),
    software_version: z.string().min(1).max(120),
    provider_response_id: z.string().min(1).max(255).nullable(),
    response_sha256: sha256Schema.nullable(),
    result_payload: jsonObjectSchema.nullable(),
    usage_reported: z.boolean(),
    input_tokens: nonnegativeBigintSchema.nullable(),
    cached_input_tokens: nonnegativeBigintSchema.nullable(),
    cache_write_input_tokens: nonnegativeBigintSchema.nullable(),
    output_tokens: nonnegativeBigintSchema.nullable(),
    reasoning_tokens: nonnegativeBigintSchema.nullable(),
    total_tokens: nonnegativeBigintSchema.nullable(),
    provider_started_at: timestampSchema.nullable(),
    completed_at: timestampSchema.nullable(),
    failure_code: z.string().min(1).max(80).nullable(),
    provider_http_status: z.number().int().min(100).max(599).nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .superRefine((row, context) => {
    if (row.status === 'succeeded' && row.result_payload === null) {
      context.addIssue({
        code: 'custom',
        message: 'result_payload is required for succeeded model requests.',
        path: ['result_payload'],
      })
    }

    if (row.status !== 'succeeded' && row.result_payload !== null) {
      context.addIssue({
        code: 'custom',
        message:
          'result_payload must be null until the model request succeeds.',
        path: ['result_payload'],
      })
    }

    const usageFields = [
      ['input_tokens', row.input_tokens],
      ['cached_input_tokens', row.cached_input_tokens],
      ['cache_write_input_tokens', row.cache_write_input_tokens],
      ['output_tokens', row.output_tokens],
      ['reasoning_tokens', row.reasoning_tokens],
      ['total_tokens', row.total_tokens],
    ] as const

    for (const [field, value] of usageFields) {
      if (row.usage_reported && value === null) {
        context.addIssue({
          code: 'custom',
          message: `${field} is required when provider usage was reported.`,
          path: [field],
        })
      }

      if (!row.usage_reported && value !== null) {
        context.addIssue({
          code: 'custom',
          message: `${field} must be null when provider usage was not reported.`,
          path: [field],
        })
      }
    }
  })

export const usageBucketRowSchema = z.object({
  subject_type: z.enum(['user', 'global']),
  subject_key: z.string().min(1).max(255),
  metric: z.enum(['game_starts', 'model_requests']),
  bucket_start: timestampSchema,
  bucket_seconds: z.number().int().positive(),
  used: nonnegativeBigintSchema,
  reserved: nonnegativeBigintSchema,
  updated_at: timestampSchema,
})

export const gameStartRequestRowSchema = z.object({
  idempotency_key: uuidSchema,
  clerk_user_id: z.string().min(3).max(255),
  kind: z.literal('replay'),
  source_game_id: uuidSchema,
  expected_revision: nonnegativeBigintSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  activated_at: timestampSchema.nullable(),
})

export const rateBucketRowSchema = z
  .object({
    key_type: z.enum(['user', 'ip']),
    key_hash: sha256Schema,
    action: z.enum([
      'model',
      'division',
      'answer',
      'portia',
      'charlotte',
      'game_start',
      'game_move',
      'account_export',
      'wilbur_action',
      'wilbur_observation',
    ]),
    window_start: timestampSchema,
    window_seconds: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    expires_at: timestampSchema,
  })
  .refine(
    (row) =>
      row.expires_at.getTime() >=
      row.window_start.getTime() + row.window_seconds * 1_000,
    {
      message: 'expires_at must cover the complete rate window.',
      path: ['expires_at'],
    },
  )

export const modelConcurrencySlotRowSchema = z
  .object({
    slot: z.number().int().min(1).max(4),
    enabled: z.boolean(),
    request_id: uuidSchema.nullable(),
    clerk_user_id: z.string().min(3).max(255).nullable(),
    lease_token: uuidSchema.nullable(),
    lease_expires_at: timestampSchema.nullable(),
  })
  .refine(
    (row) => {
      const leaseValues = [
        row.request_id,
        row.clerk_user_id,
        row.lease_token,
        row.lease_expires_at,
      ]
      const populated = leaseValues.filter((value) => value !== null).length
      return populated === 0 || populated === leaseValues.length
    },
    {
      message: 'A model concurrency lease must be wholly empty or populated.',
    },
  )

export const lifecycleRunRowSchema = z.object({
  id: uuidSchema,
  clerk_user_id: z.string().min(3).max(255),
  game_id: uuidSchema,
  root_run_id: uuidSchema,
  parent_run_id: uuidSchema.nullable(),
  state: z.enum(LIFECYCLE_STATES),
  revision: nonnegativeBigintSchema,
  field_generation: z.number().int().positive(),
  game_attempt: z.number().int().positive(),
  same_field_retry_count: z.number().int().min(0).max(2),
  field_regeneration_count: z.number().int().min(0).max(1),
  division_seed: z.string().min(1).max(512),
  cast_seed: z.string().min(1).max(512),
  trajectory_seed: z.string().min(1).max(512),
  retry_reason: z.string().min(8).max(2_000).nullable(),
  terminal_fingerprint: sha256Schema.nullable(),
  answer_prompt_digest: sha256Schema.nullable(),
  survivor_set: z.array(z.unknown()).nullable(),
  portia_current_candidate_id: z.string().min(3).max(220).nullable(),
  portia_active_model_request_id: uuidSchema.nullable(),
  portia_failed_attempt_count: z.number().int().min(0).max(10),
  portia_failure_limit: z.number().int().min(1).max(10),
  portia_completed_candidate_ids: z.array(z.string().min(3).max(220)),
  portia_assessment_drafts: z.array(z.unknown()),
  charlotte_active_model_request_id: uuidSchema.nullable(),
  charlotte_failed_attempt_count: z.number().int().min(0).max(10),
  charlotte_failure_limit: z.number().int().min(1).max(10),
  software_version: z.string().min(1).max(120),
  lifecycle_version: z.string().min(1).max(80),
  rules_version: z.string().min(1).max(80),
  engine_version: z.string().min(1).max(80),
  cast_version: z.string().min(1).max(80),
  event_version: z.number().int().positive(),
  portia_prompt_version: z.string().min(1).max(80),
  portia_contract_version: z.string().min(1).max(80),
  gate_algorithm_version: z.string().min(1).max(80),
  retry_policy_version: z.string().min(1).max(80),
  charlotte_prompt_version: z.string().min(1).max(80),
  charlotte_contract_version: z.string().min(1).max(80),
  wilbur_record_version: z.string().min(1).max(80),
  created_at: timestampSchema,
  updated_at: timestampSchema,
})

export const portiaReviewRowSchema = z.object({
  id: uuidSchema,
  clerk_user_id: z.string().min(3).max(255),
  lifecycle_run_id: uuidSchema,
  model_request_id: uuidSchema,
  input_digest: sha256Schema,
  output_digest: sha256Schema,
  prompt_version: z.string().min(1).max(80),
  contract_version: z.string().min(1).max(80),
  review: jsonObjectSchema,
  created_at: timestampSchema,
})

export const gateDecisionRowSchema = z.object({
  id: uuidSchema,
  clerk_user_id: z.string().min(3).max(255),
  lifecycle_run_id: uuidSchema,
  algorithm_version: z.string().min(1).max(80),
  input_digest: sha256Schema,
  passed: z.boolean(),
  result: jsonObjectSchema,
  answer_user_prompt: z.string().min(1).max(200_000).nullable(),
  answer_user_prompt_sha256: sha256Schema.nullable(),
  created_at: timestampSchema,
})

export const charlotteResultRowSchema = z.object({
  id: uuidSchema,
  clerk_user_id: z.string().min(3).max(255),
  lifecycle_run_id: uuidSchema,
  model_request_id: uuidSchema,
  input_digest: sha256Schema,
  output_digest: sha256Schema,
  prompt_version: z.string().min(1).max(80),
  contract_version: z.string().min(1).max(80),
  result: jsonObjectSchema,
  rendered_answer: z.string().min(100).max(20_000),
  created_at: timestampSchema,
})

export const wilburActionRowSchema = z.object({
  id: uuidSchema,
  clerk_user_id: z.string().min(3).max(255),
  lifecycle_run_id: uuidSchema,
  charlotte_action_index: z.number().int().min(0).max(2).nullable(),
  idempotency_key: uuidSchema,
  request_digest: sha256Schema,
  actor: z.string().min(2).max(240),
  action: z.string().min(8).max(2_000),
  tested_assumption: z.string().min(8).max(1_000),
  expected_observation: z.string().min(8).max(1_000),
  decision_threshold: z.string().min(8).max(1_000),
  review_horizon: z.string().min(2).max(240),
  status: z.enum(WILBUR_ACTION_STATUSES),
  revision: nonnegativeBigintSchema,
  record_version: z.string().min(1).max(80),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  charlotte_binding_version: z
    .literal(CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION)
    .nullable(),
})

export const wilburObservationRowSchema = z.object({
  id: uuidSchema,
  clerk_user_id: z.string().min(3).max(255),
  action_id: uuidSchema,
  idempotency_key: uuidSchema,
  request_digest: sha256Schema,
  observed_at: timestampSchema,
  observation: z.string().min(3).max(4_000),
  evidence_classification: z.string().min(3).max(240),
  expected_effect: z.string().min(1).max(2_000),
  unexpected_effect: z.string().min(1).max(2_000),
  stakeholder_response: z.string().min(1).max(2_000),
  assumption_result: z.enum(ASSUMPTION_RESULTS),
  next_decision: z.string().min(3).max(2_000),
  record_version: z.string().min(1).max(80),
  created_at: timestampSchema,
})

export const wilburMutationRequestRowSchema = z.object({
  clerk_user_id: z.string().min(3).max(255),
  idempotency_key: uuidSchema,
  operation: z.enum([
    'create_action',
    'update_action',
    'append_observation',
  ]),
  request_digest: sha256Schema,
  target_game_id: uuidSchema,
  target_action_id: uuidSchema.nullable(),
  rate_kind: z.enum(['action', 'observation']),
  rate_admitted_at: timestampSchema.nullable(),
  denial_code: z.string().min(1).max(120).nullable(),
  retry_at: timestampSchema.nullable(),
  reserved_future_rows: z.number().int().min(0).max(2),
  reserved_text_bytes: nonnegativeBigintSchema,
  status: z.enum(['pending', 'committed', 'denied']),
  result_entity_id: uuidSchema.nullable(),
  result_revision: nonnegativeBigintSchema.nullable(),
  result_status: z.string().min(1).max(80).nullable(),
  result_updated_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
})

export const lifecycleEventRowSchema = z.object({
  id: uuidSchema,
  clerk_user_id: z.string().min(3).max(255),
  lifecycle_run_id: uuidSchema,
  sequence: positiveBigintSchema,
  stage: z.string().min(1).max(40),
  activity_type: z.string().min(1).max(80),
  state_from: z.string().min(1).max(40).nullable(),
  state_to: z.string().min(1).max(40),
  input_entity_ids: z.array(z.unknown()),
  output_entity_ids: z.array(z.unknown()),
  responsible_agent_ids: z.array(z.unknown()),
  configuration_digest: sha256Schema,
  status: z.enum(['started', 'completed', 'failed', 'refused']),
  event_version: z.number().int().positive(),
  created_at: timestampSchema,
})

export type UserControlsRow = z.infer<typeof userControlsRowSchema>
export type DeletedUserTombstoneRow = z.infer<
  typeof deletedUserTombstoneRowSchema
>
export type GameStatus = z.infer<typeof gameStatusSchema>
export type GameRow = z.infer<typeof gameRowSchema>
export type GameEventRow = z.infer<typeof gameEventRowSchema>
export type ModelRequestRow = z.infer<typeof modelRequestRowSchema>
export type GameStartRequestRow = z.infer<typeof gameStartRequestRowSchema>
export type UsageBucketRow = z.infer<typeof usageBucketRowSchema>
export type RateBucketRow = z.infer<typeof rateBucketRowSchema>
export type ModelConcurrencySlotRow = z.infer<
  typeof modelConcurrencySlotRowSchema
>
export type LifecycleRunRow = z.infer<typeof lifecycleRunRowSchema>
export type PortiaReviewRow = z.infer<typeof portiaReviewRowSchema>
export type GateDecisionRow = z.infer<typeof gateDecisionRowSchema>
export type CharlotteResultRow = z.infer<typeof charlotteResultRowSchema>
export type WilburActionRow = z.infer<typeof wilburActionRowSchema>
export type WilburObservationRow = z.infer<typeof wilburObservationRowSchema>
export type WilburMutationRequestRow = z.infer<
  typeof wilburMutationRequestRowSchema
>
export type LifecycleEventRow = z.infer<typeof lifecycleEventRowSchema>

export function parseResultRows<Output>(
  result: SqlResult,
  rowSchema: z.ZodType<Output>,
): readonly Output[] {
  return result.rows.map((row) => rowSchema.parse(row))
}

export function parseSingleResultRow<Output>(
  result: SqlResult,
  rowSchema: z.ZodType<Output>,
): Output {
  const rows = parseResultRows(result, rowSchema)
  if (rows.length !== 1) {
    throw new RangeError(`Expected exactly one database row, received ${rows.length}.`)
  }

  return rows[0]
}

export function parseOptionalResultRow<Output>(
  result: SqlResult,
  rowSchema: z.ZodType<Output>,
): Output | undefined {
  const rows = parseResultRows(result, rowSchema)
  if (rows.length > 1) {
    throw new RangeError(`Expected at most one database row, received ${rows.length}.`)
  }

  return rows[0]
}

export const databaseScalarSchemas = {
  bigint: bigintSchema,
  nonnegativeBigint: nonnegativeBigintSchema,
  positiveBigint: positiveBigintSchema,
  sha256: sha256Schema,
  timestamp: timestampSchema,
  uuid: uuidSchema,
  nonemptyText: nonemptyTextSchema,
} as const
