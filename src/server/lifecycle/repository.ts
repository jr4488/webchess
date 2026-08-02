import { randomUUID } from 'node:crypto'

import {
  CURRENT_LIFECYCLE_VERSIONS,
  assertLifecycleTransition,
  charlotteResultSchema,
  portiaReviewSchema,
} from '../../lib/lifecycle'
import type {
  CharlotteResult,
  GateResult,
  LifecycleActivity,
  LifecycleAggregate,
  LifecycleRun,
  LifecycleState,
  PortiaReview,
  SurvivorCandidate,
  WilburAction,
  WilburObservation,
} from '../../lib/lifecycle'
import {
  charlotteResultRowSchema,
  gateDecisionRowSchema,
  hashCanonicalJson,
  lifecycleEventRowSchema,
  lifecycleRunRowSchema,
  parseOptionalResultRow,
  parseResultRows,
  portiaReviewRowSchema,
  wilburActionRowSchema,
  wilburObservationRowSchema,
} from '../db'
import type {
  CharlotteResultRow,
  GateDecisionRow,
  LifecycleEventRow,
  LifecycleRunRow,
  PortiaReviewRow,
  SqlAdapter,
  SqlResult,
  WilburActionRow,
  WilburObservationRow,
} from '../db'
import { LifecycleRepositoryError } from './errors'
import type {
  AppendWilburObservationInput,
  CreateRetryRunInput,
  CreateWilburActionInput,
  EnsureLifecycleInput,
  LifecycleRepositoryPort,
  StoreCharlotteInput,
  StoreGateInput,
  StorePortiaInput,
  TransitionLifecycleInput,
  UpdateWilburActionInput,
} from './types'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/

const SELECT_RUN_COLUMNS = `
  id,
  clerk_user_id,
  game_id,
  root_run_id,
  parent_run_id,
  state,
  revision,
  field_generation,
  game_attempt,
  same_field_retry_count,
  field_regeneration_count,
  division_seed,
  cast_seed,
  trajectory_seed,
  retry_reason,
  terminal_fingerprint,
  survivor_set,
  software_version,
  lifecycle_version,
  rules_version,
  engine_version,
  cast_version,
  event_version,
  portia_prompt_version,
  portia_contract_version,
  gate_algorithm_version,
  retry_policy_version,
  charlotte_prompt_version,
  charlotte_contract_version,
  wilbur_record_version,
  created_at,
  updated_at
`

const SELECT_PORTIA_COLUMNS = `
  id,
  clerk_user_id,
  lifecycle_run_id,
  model_request_id,
  input_digest,
  output_digest,
  prompt_version,
  contract_version,
  review,
  created_at
`

const SELECT_GATE_COLUMNS = `
  id,
  clerk_user_id,
  lifecycle_run_id,
  algorithm_version,
  input_digest,
  passed,
  result,
  created_at
`

const SELECT_CHARLOTTE_COLUMNS = `
  id,
  clerk_user_id,
  lifecycle_run_id,
  model_request_id,
  input_digest,
  output_digest,
  prompt_version,
  contract_version,
  result,
  rendered_answer,
  created_at
`

const SELECT_ACTION_COLUMNS = `
  id,
  clerk_user_id,
  lifecycle_run_id,
  charlotte_action_index,
  idempotency_key,
  request_digest,
  actor,
  action,
  tested_assumption,
  expected_observation,
  decision_threshold,
  review_horizon,
  status,
  revision,
  record_version,
  created_at,
  updated_at
`

const SELECT_OBSERVATION_COLUMNS = `
  id,
  clerk_user_id,
  action_id,
  idempotency_key,
  request_digest,
  observed_at,
  observation,
  evidence_classification,
  expected_effect,
  unexpected_effect,
  stakeholder_response,
  assumption_result,
  next_decision,
  record_version,
  created_at
`

const SELECT_EVENT_COLUMNS = `
  id,
  clerk_user_id,
  lifecycle_run_id,
  sequence,
  stage,
  activity_type,
  state_from,
  state_to,
  input_entity_ids,
  output_entity_ids,
  responsible_agent_ids,
  configuration_digest,
  status,
  event_version,
  created_at
`

function assertOwner(value: string): string {
  const owner = value.trim()
  if (owner.length < 3 || owner.length > 255) {
    throw new LifecycleRepositoryError(
      'invalid-input',
      'A valid authenticated owner is required.',
    )
  }
  return owner
}

function assertUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new LifecycleRepositoryError(
      'invalid-input',
      `${label} must be a UUID.`,
    )
  }
  return value
}

function assertDigest(value: string, label: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new LifecycleRepositoryError(
      'invalid-input',
      `${label} must be a lowercase SHA-256 digest.`,
    )
  }
  return value
}

function assertRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new LifecycleRepositoryError(
      'invalid-input',
      'Expected revision must be a nonnegative safe integer.',
    )
  }
  return value
}

function revisionNumber(value: bigint): number {
  const revision = Number(value)
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new LifecycleRepositoryError(
      'integrity-error',
      'A stored lifecycle revision is outside the supported range.',
    )
  }
  return revision
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new LifecycleRepositoryError(
      'invalid-input',
      'Lifecycle data must be JSON serializable.',
    )
  }
  return serialized
}

function parsedOptionalRun(result: SqlResult): LifecycleRunRow | undefined {
  try {
    return parseOptionalResultRow(result, lifecycleRunRowSchema)
  } catch (error) {
    throw new LifecycleRepositoryError(
      'integrity-error',
      'The database returned an invalid lifecycle run.',
      { cause: error },
    )
  }
}

function stringArray(value: readonly unknown[], label: string): readonly string[] {
  if (value.some((item) => typeof item !== 'string')) {
    throw new LifecycleRepositoryError(
      'integrity-error',
      `Stored ${label} must contain only string identifiers.`,
    )
  }
  return value as readonly string[]
}

function survivorArray(value: readonly unknown[] | null): readonly SurvivorCandidate[] {
  if (value === null) return []
  // Survivor records are produced only by the deterministic server extractor.
  // Requiring the provenance fields here fails closed on malformed database data
  // without duplicating the full public contract in the persistence layer.
  for (const item of value) {
    if (
      item === null ||
      typeof item !== 'object' ||
      typeof (item as { candidateId?: unknown }).candidateId !== 'string' ||
      typeof (item as { sourceDigest?: unknown }).sourceDigest !== 'string'
    ) {
      throw new LifecycleRepositoryError(
        'integrity-error',
        'The stored terminal survivor set is invalid.',
      )
    }
  }
  return value as readonly SurvivorCandidate[]
}

function portiaFromRow(row: PortiaReviewRow | undefined): PortiaReview | null {
  if (!row) return null
  const parsed = portiaReviewSchema.safeParse(row.review)
  if (!parsed.success) {
    throw new LifecycleRepositoryError(
      'integrity-error',
      'The stored Portia review violates its versioned contract.',
      { cause: parsed.error },
    )
  }
  return parsed.data
}

function gateFromRow(row: GateDecisionRow | undefined): GateResult | null {
  if (!row) return null
  const result = row.result as Partial<GateResult>
  if (
    result.algorithmVersion !== row.algorithm_version ||
    result.inputDigest !== row.input_digest ||
    result.passed !== row.passed ||
    !Array.isArray(result.missingRequirements)
  ) {
    throw new LifecycleRepositoryError(
      'integrity-error',
      'The stored Gate result is inconsistent with its immutable columns.',
    )
  }
  return result as GateResult
}

function charlotteFromRow(
  row: CharlotteResultRow | undefined,
): CharlotteResult | null {
  if (!row) return null
  const parsed = charlotteResultSchema.safeParse(row.result)
  if (!parsed.success) {
    throw new LifecycleRepositoryError(
      'integrity-error',
      'The stored Charlotte result violates its versioned contract.',
      { cause: parsed.error },
    )
  }
  return parsed.data
}

function actionFromRow(row: WilburActionRow): WilburAction {
  return {
    id: row.id,
    lifecycleRunId: row.lifecycle_run_id,
    charlotteActionIndex: row.charlotte_action_index,
    actor: row.actor,
    action: row.action,
    testedAssumption: row.tested_assumption,
    expectedObservation: row.expected_observation,
    decisionThreshold: row.decision_threshold,
    reviewHorizon: row.review_horizon,
    status: row.status,
    revision: revisionNumber(row.revision),
    version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function observationFromRow(row: WilburObservationRow): WilburObservation {
  return {
    id: row.id,
    actionId: row.action_id,
    observedAt: row.observed_at.toISOString(),
    observation: row.observation,
    evidenceClassification: row.evidence_classification,
    expectedEffect: row.expected_effect,
    unexpectedEffect: row.unexpected_effect,
    stakeholderResponse: row.stakeholder_response,
    assumptionResult: row.assumption_result,
    nextDecision: row.next_decision,
    version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
    createdAt: row.created_at.toISOString(),
  }
}

function activityFromRow(row: LifecycleEventRow): LifecycleActivity {
  return {
    id: row.id,
    sequence: revisionNumber(row.sequence),
    stage: row.stage,
    activityType: row.activity_type,
    stateFrom: row.state_from as LifecycleState | null,
    stateTo: row.state_to as LifecycleState,
    inputEntityIds: stringArray(row.input_entity_ids, 'activity inputs'),
    outputEntityIds: stringArray(row.output_entity_ids, 'activity outputs'),
    responsibleAgentIds: stringArray(
      row.responsible_agent_ids,
      'responsible agents',
    ),
    configurationDigest: row.configuration_digest,
    status: row.status,
    eventVersion: row.event_version,
    createdAt: row.created_at.toISOString(),
  }
}

function runFromRows(
  row: LifecycleRunRow,
  portia: PortiaReviewRow | undefined,
  gate: GateDecisionRow | undefined,
  charlotte: CharlotteResultRow | undefined,
  actions: readonly WilburActionRow[],
  observations: readonly WilburObservationRow[],
  activities: readonly LifecycleEventRow[],
): LifecycleAggregate {
  const run: LifecycleRun = {
    id: row.id,
    rootRunId: row.root_run_id,
    parentRunId: row.parent_run_id,
    gameId: row.game_id,
    state: row.state,
    revision: revisionNumber(row.revision),
    fieldGeneration: row.field_generation,
    gameAttempt: row.game_attempt,
    sameFieldRetryCount: row.same_field_retry_count,
    fieldRegenerationCount: row.field_regeneration_count,
    divisionSeed: row.division_seed,
    castSeed: row.cast_seed,
    trajectorySeed: row.trajectory_seed,
    retryReason: row.retry_reason,
    terminalFingerprint: row.terminal_fingerprint,
    survivors: survivorArray(row.survivor_set),
    portia: portiaFromRow(portia),
    gate: gateFromRow(gate),
    charlotte: charlotteFromRow(charlotte),
    charlotteRenderedAnswer: charlotte?.rendered_answer ?? null,
    wilburActions: actions.map(actionFromRow),
    wilburObservations: observations.map(observationFromRow),
    versions: {
      software: row.software_version,
      lifecycle: row.lifecycle_version,
      portiaPrompt: row.portia_prompt_version,
      portiaContract: row.portia_contract_version,
      gateAlgorithm: row.gate_algorithm_version,
      retryPolicy: row.retry_policy_version,
      charlottePrompt: row.charlotte_prompt_version,
      charlotteContract: row.charlotte_contract_version,
      wilburRecord: row.wilbur_record_version,
      rules: row.rules_version,
      engine: row.engine_version,
      cast: row.cast_version,
      event: row.event_version,
    },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
  return { ...run, activities: activities.map(activityFromRow) }
}

function stateForGame(input: EnsureLifecycleInput): LifecycleState {
  if (input.game.status === 'mapped') return 'chess_ready'
  if (input.game.status === 'playing') return 'chess_playing'
  if (
    input.game.status === 'completed' ||
    input.game.status === 'answering' ||
    input.game.status === 'answer_failed' ||
    input.game.status === 'answered'
  ) {
    return 'chess_terminal'
  }
  if (input.game.status === 'abandoned') return 'abandoned'
  throw new LifecycleRepositoryError(
    'invalid-state',
    'A lifecycle run can begin only after Anansi has produced a mapped field.',
  )
}

function bootstrapActivities(state: LifecycleState): readonly Record<string, unknown>[] {
  const activities: Record<string, unknown>[] = [
    {
      stage: 'anansi',
      activityType: 'field_generation_started',
      stateFrom: 'anansi_pending',
      stateTo: 'anansi_running',
      status: 'started',
      agents: ['anansi'],
    },
    {
      stage: 'anansi',
      activityType: 'field_generation_completed',
      stateFrom: 'anansi_running',
      stateTo: 'field_ready',
      status: 'completed',
      agents: ['anansi'],
    },
    {
      stage: 'chess',
      activityType: 'field_cast_completed',
      stateFrom: 'field_ready',
      stateTo: 'chess_ready',
      status: 'completed',
      agents: ['webchess-engine'],
    },
  ]
  if (state === 'chess_playing' || state === 'chess_terminal') {
    activities.push({
      stage: 'chess',
      activityType: 'game_started',
      stateFrom: 'chess_ready',
      stateTo: 'chess_playing',
      status: 'completed',
      agents: ['player', 'webchess-engine'],
    })
  }
  if (state === 'chess_terminal') {
    activities.push({
      stage: 'chess',
      activityType: 'game_reached_terminal_state',
      stateFrom: 'chess_playing',
      stateTo: 'chess_terminal',
      status: 'completed',
      agents: ['webchess-engine'],
    })
  }
  return activities
}

export class DurableLifecycleRepository implements LifecycleRepositoryPort {
  constructor(private readonly database: SqlAdapter) {}

  private async ownedRun(
    ownerId: string,
    gameId: string,
  ): Promise<LifecycleRunRow> {
    const result = await this.database.query({
      text: `
        SELECT ${SELECT_RUN_COLUMNS}
        FROM lifecycle_runs
        WHERE clerk_user_id = $1::text
          AND game_id = $2::uuid
      `,
      values: [assertOwner(ownerId), assertUuid(gameId, 'Game id')],
    })
    const row = parsedOptionalRun(result)
    if (!row) {
      throw new LifecycleRepositoryError('not-found', 'Lifecycle run not found.')
    }
    return row
  }

  async getForGame(
    ownerId: string,
    gameId: string,
  ): Promise<LifecycleAggregate | null> {
    const owner = assertOwner(ownerId)
    const id = assertUuid(gameId, 'Game id')
    const results = await this.database.transaction(
      [
        {
          text: `SELECT ${SELECT_RUN_COLUMNS} FROM lifecycle_runs WHERE clerk_user_id = $1::text AND game_id = $2::uuid`,
          values: [owner, id],
        },
        {
          text: `SELECT ${SELECT_PORTIA_COLUMNS} FROM portia_reviews WHERE clerk_user_id = $1::text AND lifecycle_run_id = (SELECT id FROM lifecycle_runs WHERE clerk_user_id = $1::text AND game_id = $2::uuid)`,
          values: [owner, id],
        },
        {
          text: `SELECT ${SELECT_GATE_COLUMNS} FROM gate_decisions WHERE clerk_user_id = $1::text AND lifecycle_run_id = (SELECT id FROM lifecycle_runs WHERE clerk_user_id = $1::text AND game_id = $2::uuid)`,
          values: [owner, id],
        },
        {
          text: `SELECT ${SELECT_CHARLOTTE_COLUMNS} FROM charlotte_results WHERE clerk_user_id = $1::text AND lifecycle_run_id = (SELECT id FROM lifecycle_runs WHERE clerk_user_id = $1::text AND game_id = $2::uuid)`,
          values: [owner, id],
        },
        {
          text: `SELECT ${SELECT_ACTION_COLUMNS} FROM wilbur_actions WHERE clerk_user_id = $1::text AND lifecycle_run_id = (SELECT id FROM lifecycle_runs WHERE clerk_user_id = $1::text AND game_id = $2::uuid) ORDER BY created_at, id`,
          values: [owner, id],
        },
        {
          text: `SELECT ${SELECT_OBSERVATION_COLUMNS} FROM wilbur_observations WHERE clerk_user_id = $1::text AND action_id IN (SELECT id FROM wilbur_actions WHERE clerk_user_id = $1::text AND lifecycle_run_id = (SELECT id FROM lifecycle_runs WHERE clerk_user_id = $1::text AND game_id = $2::uuid)) ORDER BY observed_at, created_at, id`,
          values: [owner, id],
        },
        {
          text: `SELECT ${SELECT_EVENT_COLUMNS} FROM lifecycle_events WHERE clerk_user_id = $1::text AND lifecycle_run_id = (SELECT id FROM lifecycle_runs WHERE clerk_user_id = $1::text AND game_id = $2::uuid) ORDER BY sequence`,
          values: [owner, id],
        },
      ],
      { isolationLevel: 'RepeatableRead', readOnly: true },
    )
    const run = parsedOptionalRun(results[0]!)
    if (!run) return null
    try {
      return runFromRows(
        run,
        parseOptionalResultRow(results[1]!, portiaReviewRowSchema),
        parseOptionalResultRow(results[2]!, gateDecisionRowSchema),
        parseOptionalResultRow(results[3]!, charlotteResultRowSchema),
        parseResultRows(results[4]!, wilburActionRowSchema),
        parseResultRows(results[5]!, wilburObservationRowSchema),
        parseResultRows(results[6]!, lifecycleEventRowSchema),
      )
    } catch (error) {
      if (error instanceof LifecycleRepositoryError) throw error
      throw new LifecycleRepositoryError(
        'integrity-error',
        'The lifecycle aggregate contains invalid persisted data.',
        { cause: error },
      )
    }
  }

  async ensureForGame(input: EnsureLifecycleInput): Promise<LifecycleAggregate> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.game.id, 'Game id')
    if (!input.game.division) {
      throw new LifecycleRepositoryError(
        'invalid-state',
        'A mapped semantic division is required to create a lifecycle run.',
      )
    }
    if (!input.game.game) {
      throw new LifecycleRepositoryError(
        'invalid-state',
        'A canonical cast is required to version a lifecycle run.',
      )
    }
    const existing = await this.getForGame(owner, gameId)
    if (existing) return existing

    const runId = randomUUID()
    const state = stateForGame(input)
    const versionsDigest = hashCanonicalJson(CURRENT_LIFECYCLE_VERSIONS)
    const activities = bootstrapActivities(state)
    const result = await this.database.query({
      text: `
        WITH inserted AS (
          INSERT INTO lifecycle_runs (
            id, clerk_user_id, game_id, root_run_id, parent_run_id,
            state, division_seed, cast_seed, trajectory_seed,
            software_version, lifecycle_version,
            rules_version, engine_version, cast_version, event_version,
            portia_prompt_version, portia_contract_version,
            gate_algorithm_version, retry_policy_version,
            charlotte_prompt_version, charlotte_contract_version,
            wilbur_record_version
          )
          VALUES (
            $1::uuid, $2::text, $3::uuid, $1::uuid, NULL,
            $4::text, $5::text, $6::text, $7::text,
            $8::text, $9::text, $10::text, $11::text, $12::text, $13::smallint,
            $14::text, $15::text, $16::text, $17::text,
            $18::text, $19::text, $20::text
          )
          ON CONFLICT (game_id) DO NOTHING
          RETURNING ${SELECT_RUN_COLUMNS}
        ),
        activities AS (
          INSERT INTO lifecycle_events (
            id, clerk_user_id, lifecycle_run_id, sequence, stage,
            activity_type, state_from, state_to, input_entity_ids,
            output_entity_ids, responsible_agent_ids,
            configuration_digest, status, event_version
          )
          SELECT
            gen_random_uuid(), inserted.clerk_user_id, inserted.id,
            activity.ordinality, activity.value->>'stage',
            activity.value->>'activityType',
            activity.value->>'stateFrom', activity.value->>'stateTo',
            jsonb_build_array($3::text), jsonb_build_array(inserted.id::text),
            activity.value->'agents', $21::char(64),
            activity.value->>'status',
            $22::smallint
          FROM inserted
          CROSS JOIN jsonb_array_elements($23::jsonb)
            WITH ORDINALITY AS activity(value, ordinality)
          RETURNING lifecycle_run_id
        )
        SELECT ${SELECT_RUN_COLUMNS}
        FROM inserted
      `,
      values: [
        runId,
        owner,
        gameId,
        state,
        input.game.division.seed,
        hashCanonicalJson({
          purpose: 'webchess-cast-seed/v2',
          divisionDigest: input.game.division.digest,
          gameId,
        }),
        input.trajectorySeed,
        CURRENT_LIFECYCLE_VERSIONS.software,
        CURRENT_LIFECYCLE_VERSIONS.lifecycle,
        input.game.game.versions.rules,
        input.game.game.versions.engine,
        input.game.game.versions.cast,
        input.game.game.versions.event,
        CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
        CURRENT_LIFECYCLE_VERSIONS.portiaContract,
        CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm,
        CURRENT_LIFECYCLE_VERSIONS.retryPolicy,
        CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
        CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
        CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
        versionsDigest,
        CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
        json(activities),
      ],
    })
    if (!parsedOptionalRun(result)) {
      throw new LifecycleRepositoryError(
        'conflict',
        'The lifecycle run could not be created safely.',
      )
    }
    return (await this.getForGame(owner, gameId))!
  }

  async transition(
    input: TransitionLifecycleInput,
  ): Promise<LifecycleAggregate> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const expectedRevision = assertRevision(input.expectedRevision)
    assertDigest(input.configurationDigest, 'Configuration digest')
    const before = await this.ownedRun(owner, gameId)
    if (before.state === input.to) {
      return (await this.getForGame(owner, gameId))!
    }
    if (revisionNumber(before.revision) !== expectedRevision) {
      throw new LifecycleRepositoryError(
        'conflict',
        `Lifecycle revision changed from ${expectedRevision} to ${before.revision.toString()}.`,
      )
    }
    try {
      assertLifecycleTransition(before.state, input.to)
    } catch (error) {
      throw new LifecycleRepositoryError(
        'invalid-state',
        error instanceof Error ? error.message : 'Illegal lifecycle transition.',
        { cause: error },
      )
    }
    if (input.terminalFingerprint !== undefined) {
      assertDigest(input.terminalFingerprint, 'Terminal fingerprint')
    }

    const result = await this.database.query({
      text: `
        WITH advanced AS (
          UPDATE lifecycle_runs
          SET state = $5::text,
              revision = revision + 1,
              terminal_fingerprint = CASE WHEN $14::boolean THEN $12::char(64) ELSE terminal_fingerprint END,
              survivor_set = CASE WHEN $14::boolean THEN $13::jsonb ELSE survivor_set END,
              updated_at = now()
          WHERE clerk_user_id = $1::text
            AND game_id = $2::uuid
            AND revision = $3::bigint
            AND state = $4::text
          RETURNING ${SELECT_RUN_COLUMNS}
        ),
        activity AS (
          INSERT INTO lifecycle_events (
            id, clerk_user_id, lifecycle_run_id, sequence, stage,
            activity_type, state_from, state_to, input_entity_ids,
            output_entity_ids, responsible_agent_ids,
            configuration_digest, status, event_version
          )
          SELECT
            gen_random_uuid(), advanced.clerk_user_id, advanced.id,
            coalesce((SELECT max(sequence) + 1 FROM lifecycle_events WHERE lifecycle_run_id = advanced.id), 1),
            $6::text, $7::text, $4::text, $5::text,
            $8::jsonb, $9::jsonb, $10::jsonb, $11::char(64),
            $15::text, $16::smallint
          FROM advanced
          RETURNING lifecycle_run_id
        )
        SELECT ${SELECT_RUN_COLUMNS} FROM advanced
      `,
      values: [
        owner,
        gameId,
        expectedRevision,
        before.state,
        input.to,
        input.stage,
        input.activityType,
        json(input.inputEntityIds ?? []),
        json(input.outputEntityIds ?? []),
        json(input.responsibleAgentIds ?? []),
        input.configurationDigest,
        input.terminalFingerprint ?? null,
        json(input.survivors ?? []),
        input.terminalFingerprint !== undefined,
        input.status ?? 'completed',
        CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
      ],
    })
    if (!parsedOptionalRun(result)) {
      throw new LifecycleRepositoryError(
        'conflict',
        'The lifecycle state changed before this transition could be committed.',
      )
    }
    return (await this.getForGame(owner, gameId))!
  }

  async storePortia(input: StorePortiaInput): Promise<LifecycleAggregate> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const expectedRevision = assertRevision(input.expectedRevision)
    const modelRequestId = assertUuid(input.modelRequestId, 'Model request id')
    assertDigest(input.inputDigest, 'Portia input digest')
    assertDigest(input.outputDigest, 'Portia output digest')
    assertDigest(input.configurationDigest, 'Configuration digest')
    const review = portiaReviewSchema.parse(input.review)
    const before = await this.ownedRun(owner, gameId)
    if (before.state === 'portia_complete') {
      return (await this.getForGame(owner, gameId))!
    }
    if (
      before.state !== 'portia_running' ||
      revisionNumber(before.revision) !== expectedRevision
    ) {
      throw new LifecycleRepositoryError(
        'conflict',
        'Portia can commit only from the matching running revision.',
      )
    }
    const result = await this.database.query({
      text: `
        WITH advanced AS (
          UPDATE lifecycle_runs
          SET state = 'portia_complete', revision = revision + 1, updated_at = now()
          WHERE clerk_user_id = $1::text AND game_id = $2::uuid
            AND revision = $3::bigint AND state = 'portia_running'
          RETURNING ${SELECT_RUN_COLUMNS}
        ),
        artifact AS (
          INSERT INTO portia_reviews (
            id, clerk_user_id, lifecycle_run_id, model_request_id,
            input_digest, output_digest, prompt_version, contract_version, review
          )
          SELECT gen_random_uuid(), advanced.clerk_user_id, advanced.id,
            $4::uuid, $5::char(64), $6::char(64), $7::text, $8::text, $9::jsonb
          FROM advanced
          RETURNING id, lifecycle_run_id
        ),
        activity AS (
          INSERT INTO lifecycle_events (
            id, clerk_user_id, lifecycle_run_id, sequence, stage,
            activity_type, state_from, state_to, input_entity_ids,
            output_entity_ids, responsible_agent_ids,
            configuration_digest, status, event_version
          )
          SELECT gen_random_uuid(), advanced.clerk_user_id, advanced.id,
            coalesce((SELECT max(sequence) + 1 FROM lifecycle_events WHERE lifecycle_run_id = advanced.id), 1),
            'portia', 'adversarial_review_completed', 'portia_running',
            'portia_complete', jsonb_build_array($2::text),
            jsonb_build_array(artifact.id::text), jsonb_build_array('portia'),
            $10::char(64), 'completed', $11::smallint
          FROM advanced CROSS JOIN artifact
          RETURNING lifecycle_run_id
        )
        SELECT ${SELECT_RUN_COLUMNS} FROM advanced
      `,
      values: [
        owner,
        gameId,
        expectedRevision,
        modelRequestId,
        input.inputDigest,
        input.outputDigest,
        CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
        CURRENT_LIFECYCLE_VERSIONS.portiaContract,
        json(review),
        input.configurationDigest,
        CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
      ],
    })
    if (!parsedOptionalRun(result)) {
      throw new LifecycleRepositoryError('conflict', 'Portia commit lost its lifecycle revision race.')
    }
    return (await this.getForGame(owner, gameId))!
  }

  async storeGate(input: StoreGateInput): Promise<LifecycleAggregate> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const expectedRevision = assertRevision(input.expectedRevision)
    assertDigest(input.result.inputDigest, 'Gate input digest')
    assertDigest(input.configurationDigest, 'Configuration digest')
    const target: LifecycleState = input.result.passed ? 'gate_passed' : 'gate_failed'
    const before = await this.ownedRun(owner, gameId)
    if (before.state === target) return (await this.getForGame(owner, gameId))!
    if (
      before.state !== 'portia_complete' ||
      revisionNumber(before.revision) !== expectedRevision
    ) {
      throw new LifecycleRepositoryError(
        'conflict',
        'The Gate can commit only after the matching Portia completion.',
      )
    }
    const result = await this.database.query({
      text: `
        WITH advanced AS (
          UPDATE lifecycle_runs SET state = $4::text, revision = revision + 1, updated_at = now()
          WHERE clerk_user_id = $1::text AND game_id = $2::uuid
            AND revision = $3::bigint AND state = 'portia_complete'
          RETURNING ${SELECT_RUN_COLUMNS}
        ),
        artifact AS (
          INSERT INTO gate_decisions (
            id, clerk_user_id, lifecycle_run_id, algorithm_version,
            input_digest, passed, result
          )
          SELECT gen_random_uuid(), advanced.clerk_user_id, advanced.id,
            $5::text, $6::char(64), $7::boolean, $8::jsonb
          FROM advanced
          RETURNING id, lifecycle_run_id
        ),
        activity AS (
          INSERT INTO lifecycle_events (
            id, clerk_user_id, lifecycle_run_id, sequence, stage,
            activity_type, state_from, state_to, input_entity_ids,
            output_entity_ids, responsible_agent_ids,
            configuration_digest, status, event_version
          )
          SELECT gen_random_uuid(), advanced.clerk_user_id, advanced.id,
            coalesce((SELECT max(sequence) + 1 FROM lifecycle_events WHERE lifecycle_run_id = advanced.id), 1),
            'gate', CASE WHEN $7::boolean THEN 'sufficiency_passed' ELSE 'sufficiency_failed' END,
            'portia_complete', $4::text, jsonb_build_array($2::text),
            jsonb_build_array(artifact.id::text), jsonb_build_array('gate'),
            $9::char(64), 'completed', $10::smallint
          FROM advanced CROSS JOIN artifact
          RETURNING lifecycle_run_id
        )
        SELECT ${SELECT_RUN_COLUMNS} FROM advanced
      `,
      values: [
        owner,
        gameId,
        expectedRevision,
        target,
        input.result.algorithmVersion,
        input.result.inputDigest,
        input.result.passed,
        json(input.result),
        input.configurationDigest,
        CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
      ],
    })
    if (!parsedOptionalRun(result)) {
      throw new LifecycleRepositoryError('conflict', 'Gate commit lost its lifecycle revision race.')
    }
    return (await this.getForGame(owner, gameId))!
  }

  async storeCharlotte(input: StoreCharlotteInput): Promise<LifecycleAggregate> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const expectedRevision = assertRevision(input.expectedRevision)
    const modelRequestId = assertUuid(input.modelRequestId, 'Model request id')
    assertDigest(input.inputDigest, 'Charlotte input digest')
    assertDigest(input.outputDigest, 'Charlotte output digest')
    assertDigest(input.configurationDigest, 'Configuration digest')
    const resultValue = charlotteResultSchema.parse(input.result)
    if (input.renderedAnswer.trim().length < 100 || input.renderedAnswer.length > 20_000) {
      throw new LifecycleRepositoryError(
        'invalid-input',
        'The rendered Charlotte answer must contain between 100 and 20,000 characters.',
      )
    }
    const before = await this.ownedRun(owner, gameId)
    if (before.state === 'charlotte_complete') {
      return (await this.getForGame(owner, gameId))!
    }
    if (
      before.state !== 'charlotte_running' ||
      revisionNumber(before.revision) !== expectedRevision
    ) {
      throw new LifecycleRepositoryError(
        'conflict',
        'Charlotte can commit only from the matching running revision.',
      )
    }
    const result = await this.database.query({
      text: `
        WITH advanced AS (
          UPDATE lifecycle_runs SET state = 'charlotte_complete', revision = revision + 1, updated_at = now()
          WHERE clerk_user_id = $1::text AND game_id = $2::uuid
            AND revision = $3::bigint AND state = 'charlotte_running'
          RETURNING ${SELECT_RUN_COLUMNS}
        ),
        artifact AS (
          INSERT INTO charlotte_results (
            id, clerk_user_id, lifecycle_run_id, model_request_id,
            input_digest, output_digest, prompt_version, contract_version,
            result, rendered_answer
          )
          SELECT gen_random_uuid(), advanced.clerk_user_id, advanced.id,
            $4::uuid, $5::char(64), $6::char(64), $7::text, $8::text,
            $9::jsonb, $10::text
          FROM advanced
          RETURNING id, lifecycle_run_id
        ),
        activity AS (
          INSERT INTO lifecycle_events (
            id, clerk_user_id, lifecycle_run_id, sequence, stage,
            activity_type, state_from, state_to, input_entity_ids,
            output_entity_ids, responsible_agent_ids,
            configuration_digest, status, event_version
          )
          SELECT gen_random_uuid(), advanced.clerk_user_id, advanced.id,
            coalesce((SELECT max(sequence) + 1 FROM lifecycle_events WHERE lifecycle_run_id = advanced.id), 1),
            'charlotte', 'synthesis_completed', 'charlotte_running',
            'charlotte_complete', jsonb_build_array($2::text),
            jsonb_build_array(artifact.id::text), jsonb_build_array('charlotte'),
            $11::char(64), 'completed', $12::smallint
          FROM advanced CROSS JOIN artifact
          RETURNING lifecycle_run_id
        )
        SELECT ${SELECT_RUN_COLUMNS} FROM advanced
      `,
      values: [
        owner,
        gameId,
        expectedRevision,
        modelRequestId,
        input.inputDigest,
        input.outputDigest,
        CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
        CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
        json(resultValue),
        input.renderedAnswer,
        input.configurationDigest,
        CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
      ],
    })
    if (!parsedOptionalRun(result)) {
      throw new LifecycleRepositoryError('conflict', 'Charlotte commit lost its lifecycle revision race.')
    }
    return (await this.getForGame(owner, gameId))!
  }

  async createRetryRun(input: CreateRetryRunInput): Promise<LifecycleAggregate> {
    const owner = assertOwner(input.ownerId)
    const parentGameId = assertUuid(input.parentGameId, 'Parent game id')
    assertDigest(input.configurationDigest, 'Configuration digest')
    if (
      !input.childGame.division ||
      !input.childGame.game ||
      input.childGame.status !== 'mapped'
    ) {
      throw new LifecycleRepositoryError(
        'invalid-state',
        'A retry run requires a newly mapped child game.',
      )
    }
    const existing = await this.getForGame(owner, input.childGame.id)
    if (existing) return existing
    let parent = await this.getForGame(owner, parentGameId)
    if (!parent) {
      throw new LifecycleRepositoryError('not-found', 'Parent lifecycle run not found.')
    }
    if (parent.state === 'gate_failed') {
      parent = await this.transition({
        ownerId: owner,
        gameId: parentGameId,
        expectedRevision: parent.revision,
        to: 'retry_ready',
        stage: 'retry',
        activityType: 'retry_authorized',
        responsibleAgentIds: ['gate', 'retry-policy'],
        configurationDigest: input.configurationDigest,
      })
    }
    if (parent.state === 'retry_ready') {
      parent = await this.transition({
        ownerId: owner,
        gameId: parentGameId,
        expectedRevision: parent.revision,
        to: 'retry_running',
        stage: 'retry',
        activityType: input.mode === 'replay_game'
          ? 'same_field_replay_started'
          : 'field_regeneration_started',
        responsibleAgentIds: ['retry-policy'],
        configurationDigest: input.configurationDigest,
      })
    }
    if (parent.state !== 'retry_running') {
      throw new LifecycleRepositoryError(
        'invalid-state',
        'A child lifecycle run can be linked only while Retry is running.',
      )
    }

    const childId = randomUUID()
    const sameField = input.mode === 'replay_game'
    const result = await this.database.query({
      text: `
        WITH inserted AS (
          INSERT INTO lifecycle_runs (
            id, clerk_user_id, game_id, root_run_id, parent_run_id,
            state, field_generation, game_attempt,
            same_field_retry_count, field_regeneration_count,
            division_seed, cast_seed, trajectory_seed, retry_reason,
            software_version, lifecycle_version,
            rules_version, engine_version, cast_version, event_version,
            portia_prompt_version, portia_contract_version,
            gate_algorithm_version, retry_policy_version,
            charlotte_prompt_version, charlotte_contract_version,
            wilbur_record_version
          )
          VALUES (
            $1::uuid, $2::text, $3::uuid, $4::uuid, $5::uuid,
            'chess_ready', $6::smallint, $7::smallint, $8::smallint, $9::smallint,
            $10::text, $11::text, $12::text, $13::text,
            $14::text, $15::text, $16::text, $17::text, $18::text, $19::smallint,
            $20::text, $21::text, $22::text, $23::text,
            $24::text, $25::text, $26::text
          )
          ON CONFLICT (game_id) DO NOTHING
          RETURNING ${SELECT_RUN_COLUMNS}
        ),
        activity AS (
          INSERT INTO lifecycle_events (
            id, clerk_user_id, lifecycle_run_id, sequence, stage,
            activity_type, state_from, state_to, input_entity_ids,
            output_entity_ids, responsible_agent_ids,
            configuration_digest, status, event_version
          )
          SELECT gen_random_uuid(), inserted.clerk_user_id, inserted.id, 1,
            'retry', $27::text, NULL, 'chess_ready',
            jsonb_build_array($5::text), jsonb_build_array(inserted.id::text),
            jsonb_build_array('retry-policy'), $28::char(64), 'completed', $29::smallint
          FROM inserted
          RETURNING lifecycle_run_id
        )
        SELECT ${SELECT_RUN_COLUMNS} FROM inserted
      `,
      values: [
        childId,
        owner,
        input.childGame.id,
        parent.rootRunId,
        parent.id,
        sameField ? parent.fieldGeneration : parent.fieldGeneration + 1,
        sameField ? parent.gameAttempt + 1 : 1,
        sameField ? parent.sameFieldRetryCount + 1 : 0,
        sameField
          ? parent.fieldRegenerationCount
          : parent.fieldRegenerationCount + 1,
        input.childGame.division.seed,
        hashCanonicalJson({
          purpose: 'webchess-cast-seed/v2',
          divisionDigest: input.childGame.division.digest,
          gameId: input.childGame.id,
        }),
        input.trajectorySeed,
        input.reason,
        CURRENT_LIFECYCLE_VERSIONS.software,
        CURRENT_LIFECYCLE_VERSIONS.lifecycle,
        input.childGame.game.versions.rules,
        input.childGame.game.versions.engine,
        input.childGame.game.versions.cast,
        input.childGame.game.versions.event,
        CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
        CURRENT_LIFECYCLE_VERSIONS.portiaContract,
        CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm,
        CURRENT_LIFECYCLE_VERSIONS.retryPolicy,
        CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
        CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
        CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
        sameField ? 'same_field_retry_created' : 'regenerated_field_created',
        input.configurationDigest,
        CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
      ],
    })
    if (!parsedOptionalRun(result)) {
      throw new LifecycleRepositoryError('conflict', 'The retry child run could not be created safely.')
    }
    return (await this.getForGame(owner, input.childGame.id))!
  }

  async hasPriorTerminalFingerprint(
    ownerId: string,
    rootRunId: string,
    fingerprint: string,
    excludingRunId: string,
  ): Promise<boolean> {
    const result = await this.database.query<{ present: boolean }>({
      text: `
        SELECT EXISTS (
          SELECT 1 FROM lifecycle_runs
          WHERE clerk_user_id = $1::text AND root_run_id = $2::uuid
            AND terminal_fingerprint = $3::char(64) AND id <> $4::uuid
        ) AS present
      `,
      values: [
        assertOwner(ownerId),
        assertUuid(rootRunId, 'Root run id'),
        assertDigest(fingerprint, 'Terminal fingerprint'),
        assertUuid(excludingRunId, 'Excluded run id'),
      ],
    })
    return result.rows[0]?.present === true
  }

  async createWilburAction(input: CreateWilburActionInput): Promise<WilburAction> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    assertUuid(input.id, 'Action id')
    assertUuid(input.idempotencyKey, 'Idempotency key')
    assertDigest(input.requestDigest, 'Request digest')
    assertDigest(input.configurationDigest, 'Configuration digest')
    let run = await this.getForGame(owner, gameId)
    if (!run) throw new LifecycleRepositoryError('not-found', 'Lifecycle run not found.')
    if (run.state === 'charlotte_complete') {
      run = await this.transition({
        ownerId: owner,
        gameId,
        expectedRevision: run.revision,
        to: 'wilbur_planning',
        stage: 'wilbur',
        activityType: 'action_planning_started',
        responsibleAgentIds: ['wilbur', 'player'],
        configurationDigest: input.configurationDigest,
      })
    }
    if (!['wilbur_planning', 'wilbur_in_progress', 'wilbur_observed'].includes(run.state)) {
      throw new LifecycleRepositoryError('invalid-state', 'Wilbur requires a completed Charlotte synthesis.')
    }
    const result = await this.database.query({
      text: `
        INSERT INTO wilbur_actions (
          id, clerk_user_id, lifecycle_run_id, charlotte_action_index,
          idempotency_key, request_digest, actor, action, tested_assumption,
          expected_observation, decision_threshold, review_horizon,
          status, record_version
        )
        SELECT $3::uuid, $1::text, run.id, $4::smallint, $5::uuid,
          $6::char(64), $7::text, $8::text, $9::text, $10::text,
          $11::text, $12::text, 'planned', $13::text
        FROM lifecycle_runs AS run
        WHERE run.clerk_user_id = $1::text AND run.game_id = $2::uuid
          AND run.state IN ('wilbur_planning', 'wilbur_in_progress', 'wilbur_observed')
        ON CONFLICT (clerk_user_id, idempotency_key) DO NOTHING
        RETURNING ${SELECT_ACTION_COLUMNS}
      `,
      values: [
        owner,
        gameId,
        input.id,
        input.charlotteActionIndex,
        input.idempotencyKey,
        input.requestDigest,
        input.actor,
        input.action,
        input.testedAssumption,
        input.expectedObservation,
        input.decisionThreshold,
        input.reviewHorizon,
        CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
      ],
    })
    let row = parseOptionalResultRow(result, wilburActionRowSchema)
    if (!row) {
      const existing = await this.database.query({
        text: `SELECT ${SELECT_ACTION_COLUMNS} FROM wilbur_actions WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid`,
        values: [owner, input.idempotencyKey],
      })
      row = parseOptionalResultRow(existing, wilburActionRowSchema)
      if (!row || row.request_digest !== input.requestDigest) {
        throw new LifecycleRepositoryError('conflict', 'That Wilbur idempotency key was used for different action data.')
      }
    }
    return actionFromRow(row)
  }

  async updateWilburAction(input: UpdateWilburActionInput): Promise<WilburAction> {
    const result = await this.database.query({
      text: `
        UPDATE wilbur_actions AS action
        SET status = $5::text,
            revision = action.revision + 1,
            updated_at = now()
        FROM lifecycle_runs AS run
        WHERE action.id = $3::uuid AND action.clerk_user_id = $1::text
          AND action.lifecycle_run_id = run.id AND run.game_id = $2::uuid
          AND action.revision = $4::bigint
        RETURNING ${SELECT_ACTION_COLUMNS.replaceAll('\n  ', '\n  action.')}
      `,
      values: [
        assertOwner(input.ownerId),
        assertUuid(input.gameId, 'Game id'),
        assertUuid(input.actionId, 'Action id'),
        assertRevision(input.expectedRevision),
        input.status,
      ],
    })
    const row = parseOptionalResultRow(result, wilburActionRowSchema)
    if (!row) throw new LifecycleRepositoryError('conflict', 'The Wilbur action revision changed.')
    if (input.status === 'in_progress') {
      const run = await this.getForGame(input.ownerId, input.gameId)
      if (run?.state === 'wilbur_planning' || run?.state === 'wilbur_observed') {
        await this.transition({
          ownerId: input.ownerId,
          gameId: input.gameId,
          expectedRevision: run.revision,
          to: 'wilbur_in_progress',
          stage: 'wilbur',
          activityType: 'action_started',
          inputEntityIds: [row.id],
          responsibleAgentIds: ['wilbur', row.actor],
          configurationDigest: input.configurationDigest,
        })
      }
    }
    return actionFromRow(row)
  }

  async appendWilburObservation(
    input: AppendWilburObservationInput,
  ): Promise<WilburObservation> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    assertUuid(input.actionId, 'Action id')
    assertUuid(input.id, 'Observation id')
    assertUuid(input.idempotencyKey, 'Idempotency key')
    assertDigest(input.requestDigest, 'Request digest')
    assertDigest(input.configurationDigest, 'Configuration digest')
    const observedAt = new Date(input.observedAt)
    if (Number.isNaN(observedAt.getTime())) {
      throw new LifecycleRepositoryError('invalid-input', 'Observation time must be an ISO timestamp.')
    }
    const result = await this.database.query({
      text: `
        INSERT INTO wilbur_observations (
          id, clerk_user_id, action_id, idempotency_key, request_digest,
          observed_at, observation, evidence_classification, expected_effect,
          unexpected_effect, stakeholder_response, assumption_result,
          next_decision, record_version
        )
        SELECT $4::uuid, $1::text, action.id, $5::uuid, $6::char(64),
          $7::timestamptz, $8::text, $9::text, $10::text, $11::text,
          $12::text, $13::text, $14::text, $15::text
        FROM wilbur_actions AS action
        JOIN lifecycle_runs AS run ON run.id = action.lifecycle_run_id
        WHERE action.id = $3::uuid AND action.clerk_user_id = $1::text
          AND run.game_id = $2::uuid
        ON CONFLICT (action_id, idempotency_key) DO NOTHING
        RETURNING ${SELECT_OBSERVATION_COLUMNS}
      `,
      values: [
        owner,
        gameId,
        input.actionId,
        input.id,
        input.idempotencyKey,
        input.requestDigest,
        observedAt.toISOString(),
        input.observation,
        input.evidenceClassification,
        input.expectedEffect,
        input.unexpectedEffect,
        input.stakeholderResponse,
        input.assumptionResult,
        input.nextDecision,
        CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
      ],
    })
    let row = parseOptionalResultRow(result, wilburObservationRowSchema)
    if (!row) {
      const existing = await this.database.query({
        text: `
          SELECT ${SELECT_OBSERVATION_COLUMNS}
          FROM wilbur_observations
          WHERE clerk_user_id = $1::text
            AND action_id = $2::uuid
            AND idempotency_key = $3::uuid
        `,
        values: [owner, input.actionId, input.idempotencyKey],
      })
      row = parseOptionalResultRow(existing, wilburObservationRowSchema)
      if (!row || row.request_digest !== input.requestDigest) {
        throw new LifecycleRepositoryError('conflict', 'That Wilbur idempotency key was used for different observation data.')
      }
    }
    const run = await this.getForGame(owner, gameId)
    if (run && (run.state === 'wilbur_planning' || run.state === 'wilbur_in_progress')) {
      await this.transition({
        ownerId: owner,
        gameId,
        expectedRevision: run.revision,
        to: 'wilbur_observed',
        stage: 'wilbur',
        activityType: 'observation_recorded',
        inputEntityIds: [input.actionId],
        outputEntityIds: [row.id],
        responsibleAgentIds: ['wilbur'],
        configurationDigest: input.configurationDigest,
      })
    }
    return observationFromRow(row)
  }
}
