import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import {
  COVERAGE_TAGS,
  CURRENT_LIFECYCLE_VERSIONS,
  CURRENT_WEB_MEMORY_CONSENT_VERSION,
  CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION,
  GATE_RECOMMENDATIONS,
  LEGACY_GATE_ALGORITHM_VERSION,
  LEGACY_PROMPT_BOUND_PORTIA_CONTRACT_VERSION,
  assertLifecycleTransition,
  canReopenInsufficientBasis,
  charlotteResultSchema,
  currentPortiaReviewSchema,
  deriveSurvivorCandidates,
  legacyPromptBoundPortiaReviewSchema,
  legacyPortiaReviewSchema,
  portiaCandidateAssessmentSchema,
  portiaReviewSchema,
  terminalFingerprint,
} from '../../lib/lifecycle'
import type {
  CharlotteResult,
  GateResult,
  LifecycleActivity,
  LifecycleAggregate,
  LifecycleRun,
  LifecycleState,
  PersistedPortiaReview,
  SurvivorCandidate,
  WebMemoryCase,
  WebMemoryEvidence,
  WebMemoryIndex,
  WilburAction,
  WilburObservation,
} from '../../lib/lifecycle'
import {
  DIRECTIONAL_RECORD_VERSION,
  verifyTrajectoryDirectionalRecord,
} from '../../lib/lifecycle/trajectory-direction'
import type { TrajectoryDirectionalRecord } from '../../lib/lifecycle/trajectory-direction'
import { CURRENT_GAME_VERSIONS } from '../../lib/game-contract'
import type { GameEvent } from '../../lib/game-contract'
import { replayGameEvents } from '../../lib/game-replay'
import {
  charlotteResultRowSchema,
  gameEventRowSchema,
  gateDecisionRowSchema,
  hashCanonicalJson,
  lifecycleEventRowSchema,
  lifecycleRunRowSchema,
  parseOptionalResultRow,
  parseResultRows,
  portiaReviewRowSchema,
  sha256Hex,
  wilburActionRowSchema,
  wilburObservationRowSchema,
} from '../db'
import type {
  CharlotteResultRow,
  CanonicalJson,
  GameEventRow,
  GateDecisionRow,
  LifecycleEventRow,
  LifecycleRunRow,
  PortiaReviewRow,
  SqlAdapter,
  SqlResult,
  WilburActionRow,
  WilburObservationRow,
} from '../db'
import {
  researchRecordsFromRows,
  researchRequestRowSchema,
  researchSourceRowSchema,
  SELECT_RESEARCH_REQUEST_COLUMNS,
  SELECT_RESEARCH_SOURCE_COLUMNS,
} from '../research/repository'
import type {
  ResearchRequestRow,
  ResearchSourceRow,
} from '../research/repository'
import { LifecycleRepositoryError } from './errors'
import type {
  AppendWilburObservationInput,
  BeginCharlotteAttemptInput,
  BeginPortiaAttemptInput,
  CreateRetryRunInput,
  CreateWilburActionInput,
  ClaimWilburMutationInput,
  ClaimWilburMutationResult,
  EnsureLifecycleInput,
  FailPortiaAttemptInput,
  FailCharlotteAttemptInput,
  LifecycleRepositoryPort,
  StoreCharlotteInput,
  StoreGateInput,
  StorePortiaInput,
  SettleWilburMutationConflictInput,
  TransitionLifecycleInput,
  UpdatePortiaProgressInput,
  UpdateWilburActionInput,
} from './types'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const gateResultBaseShape = {
  passed: z.boolean(),
  usableCandidateCount: z.number().int().nonnegative(),
  preservedCount: z.number().int().nonnegative(),
  woundedCount: z.number().int().nonnegative(),
  consumedCount: z.number().int().nonnegative(),
  unresolvedCount: z.number().int().nonnegative(),
  independentClusterCount: z.number().int().nonnegative(),
  coverageResults: z.array(z.strictObject({
    tag: z.enum(COVERAGE_TAGS),
    satisfied: z.boolean(),
    candidateIds: z.array(z.string().min(3).max(220)).max(32),
  })).length(COVERAGE_TAGS.length),
  severeUnresolvedObjectionCount: z.number().int().nonnegative(),
  contradictionResults: z.strictObject({
    fatalUnaddressedIds: z.array(z.string().min(1).max(120)).max(24),
    tensionCandidatePairs: z.array(
      z.tuple([
        z.string().min(3).max(220),
        z.string().min(3).max(220),
      ]),
    ).max(16),
  }),
  missingRequirements: z.array(z.string().min(1).max(2_000)).max(64),
  recommendedNextTransition: z.enum(GATE_RECOMMENDATIONS),
  explanation: z.string().min(1).max(8_000),
  inputDigest: z.string().regex(SHA256_PATTERN),
}
const legacyGateResultSchema = z.strictObject({
  algorithmVersion: z.literal(LEGACY_GATE_ALGORITHM_VERSION),
  ...gateResultBaseShape,
})
const currentGateResultSchema = z.strictObject({
  algorithmVersion: z.literal(CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm),
  ...gateResultBaseShape,
  directionalRecordVersion: z.string().min(3).max(80),
  directionalRecordDigest: z.string().regex(SHA256_PATTERN),
  survivingDirectionKeys: z.array(z.string().min(1).max(160)).min(1).max(64),
  directionalBindingsSatisfied: z.boolean(),
})
const persistedGateResultSchema = z.discriminatedUnion('algorithmVersion', [
  legacyGateResultSchema,
  currentGateResultSchema,
])
const directionalSourceRowSchema = z.object({
  division_seed: z.string().min(1).max(512),
  division_digest: z.string().regex(SHA256_PATTERN),
  problem_parts: z.array(z.unknown()).length(64),
  status: z.string().min(1).max(40),
  outcome: z.record(z.string(), z.unknown()).nullable(),
  event_version: z.number().int().positive(),
  rules_version: z.string().min(1).max(80),
  engine_version: z.string().min(1).max(80),
  cast_version: z.string().min(1).max(80),
})
type DirectionalSourceRow = z.infer<typeof directionalSourceRowSchema>

interface TrustedDirectionalSource {
  readonly row: DirectionalSourceRow
  readonly events: readonly GameEvent[]
}

function directionalCanonicalHash(value: unknown): string {
  return hashCanonicalJson(JSON.parse(json(value)) as CanonicalJson)
}

function directionalRecordExpectedSource(
  row: LifecycleRunRow,
  divisionDigest: string,
) {
  if (row.lifecycle_version !== CURRENT_LIFECYCLE_VERSIONS.lifecycle) {
    throw new LifecycleRepositoryError(
      'invalid-state',
      'A legacy lifecycle cannot be relabelled with a current trajectory directional record.',
    )
  }
  if (
    row.event_version !== CURRENT_GAME_VERSIONS.event ||
    row.rules_version !== CURRENT_GAME_VERSIONS.rules ||
    row.engine_version !== CURRENT_GAME_VERSIONS.engine ||
    row.cast_version !== CURRENT_GAME_VERSIONS.cast
  ) {
    throw new LifecycleRepositoryError(
      'invalid-state',
      'Trajectory directional record v1 cannot relabel a legacy game version.',
    )
  }
  return {
    divisionDigest,
    divisionSeed: row.division_seed,
    castSeed: row.cast_seed,
    trajectorySeed: row.trajectory_seed,
    versions: CURRENT_GAME_VERSIONS,
  }
}

function directionalEventFromRow(row: GameEventRow): GameEvent {
  if (row.kind === 'pass') {
    return {
      version: CURRENT_GAME_VERSIONS.event,
      type: 'forced-pass',
      ply: row.ply,
      side: row.side,
      reason: 'no-legal-move',
    }
  }
  if (
    row.piece_id === null ||
    row.from_ring === null ||
    row.from_sector === null ||
    row.to_ring === null ||
    row.to_sector === null
  ) {
    throw new LifecycleRepositoryError(
      'invalid-state',
      `Trusted game event ${row.ply} is incomplete.`,
    )
  }
  return {
    version: CURRENT_GAME_VERSIONS.event,
    type: 'move',
    ply: row.ply,
    side: row.side,
    pieceId: row.piece_id,
    from: { ring: row.from_ring, sector: row.from_sector },
    to: { ring: row.to_ring, sector: row.to_sector },
    ...(row.captured_piece_id === null
      ? {}
      : { capturedPieceId: row.captured_piece_id }),
    ...(row.promoted_to === null ? {} : { promotedTo: row.promoted_to }),
  }
}

function directionalSourceFromResults(
  gameResult: SqlResult,
  eventResult: SqlResult,
): TrustedDirectionalSource {
  let row: DirectionalSourceRow | undefined
  let events: readonly GameEventRow[]
  try {
    row = parseOptionalResultRow(gameResult, directionalSourceRowSchema)
    events = parseResultRows(eventResult, gameEventRowSchema)
  } catch (error) {
    throw new LifecycleRepositoryError(
      'integrity-error',
      'The trusted game source for the trajectory directional record is invalid.',
      { cause: error },
    )
  }
  if (!row) {
    throw new LifecycleRepositoryError(
      'not-found',
      'The trusted game source for the trajectory directional record was not found.',
    )
  }
  return {
    row,
    events: events.map(directionalEventFromRow),
  }
}

function directionalRecordSourceMatches(
  record: TrajectoryDirectionalRecord,
  source: TrustedDirectionalSource,
): boolean {
  if (
    !['completed', 'answering', 'answer_failed', 'answered'].includes(
      source.row.status,
    ) ||
    source.row.outcome === null
  ) {
    return false
  }
  const embeddedParts = record.field.parts.map((entry) => entry.part)
  const embeddedEvents = record.trajectory.events.map((entry) => entry.event)
  const expectedOutcome = {
    winner: record.outcome.winner,
    reason: record.outcome.reason,
    completedTurn: record.outcome.completedTurn,
    ...(record.outcome.terminalCaptureId === null
      ? {}
      : {
          terminalCapture: {
            id: record.outcome.terminalCaptureId,
          },
        }),
  }
  const persistedOutcome = source.row.outcome
  const persistedTerminalCapture = persistedOutcome.terminalCapture
  const persistedOutcomeProjection = {
    winner: persistedOutcome.winner,
    reason: persistedOutcome.reason,
    completedTurn: persistedOutcome.completedTurn,
    ...(persistedTerminalCapture && typeof persistedTerminalCapture === 'object'
      ? {
          terminalCapture: {
            id: (persistedTerminalCapture as Record<string, unknown>).id,
          },
        }
      : {}),
  }
  return (
    record.division.digest === source.row.division_digest &&
    String(record.division.seed) === source.row.division_seed &&
    directionalCanonicalHash(embeddedParts) ===
      directionalCanonicalHash(source.row.problem_parts) &&
    directionalCanonicalHash(embeddedEvents) ===
      directionalCanonicalHash(source.events) &&
    directionalCanonicalHash(expectedOutcome) ===
      directionalCanonicalHash(persistedOutcomeProjection)
  )
}

function verifyDirectionalRecordAgainstTrustedSource(
  value: unknown,
  lifecycle: LifecycleRunRow,
  source: TrustedDirectionalSource,
  errorCode: 'invalid-input' | 'invalid-state',
): TrajectoryDirectionalRecord {
  if (
    source.row.division_seed !== lifecycle.division_seed ||
    source.row.event_version !== lifecycle.event_version ||
    source.row.rules_version !== lifecycle.rules_version ||
    source.row.engine_version !== lifecycle.engine_version ||
    source.row.cast_version !== lifecycle.cast_version
  ) {
    throw new LifecycleRepositoryError(
      errorCode,
      'The lifecycle provenance does not match its trusted game source.',
    )
  }

  let record: TrajectoryDirectionalRecord
  try {
    record = verifyTrajectoryDirectionalRecord(
      value,
      directionalRecordExpectedSource(
        lifecycle,
        source.row.division_digest,
      ),
    )
  } catch (error) {
    throw new LifecycleRepositoryError(
      errorCode,
      'The trajectory directional record failed replay verification.',
      { cause: error },
    )
  }
  if (
    record.version !== DIRECTIONAL_RECORD_VERSION ||
    !directionalRecordSourceMatches(record, source)
  ) {
    throw new LifecycleRepositoryError(
      errorCode,
      'The trajectory directional record does not match the trusted game field and event log.',
    )
  }
  return record
}

function assertDirectionalSurvivorBinding(
  record: TrajectoryDirectionalRecord,
  survivors: readonly SurvivorCandidate[],
  fingerprint: string,
  lifecycle: LifecycleRunRow,
  source: TrustedDirectionalSource,
  errorCode: 'invalid-input' | 'invalid-state' = 'invalid-input',
): void {
  if (
    survivors.length === 0 ||
    stableTerminalFingerprint(survivors) !== fingerprint
  ) {
    throw new LifecycleRepositoryError(
      errorCode,
      'The terminal fingerprint does not match the supplied survivor ecology.',
    )
  }
  let expected: readonly SurvivorCandidate[]
  try {
    const parts = record.field.parts.map((entry) => entry.part)
    const replay = replayGameEvents(source.events, parts)
    expected = deriveSurvivorCandidates(replay, parts, {
      gameId: lifecycle.game_id,
      attemptId: lifecycle.id,
      divisionDigest: source.row.division_digest,
      rulesVersion: lifecycle.rules_version,
      engineVersion: lifecycle.engine_version,
      castVersion: lifecycle.cast_version,
      eventVersion: lifecycle.event_version,
    })
  } catch (error) {
    throw new LifecycleRepositoryError(
      errorCode,
      'The canonical terminal survivor ecology could not be rederived.',
      { cause: error },
    )
  }
  if (
    directionalCanonicalHash(survivors) !==
    directionalCanonicalHash(expected)
  ) {
    throw new LifecycleRepositoryError(
      errorCode,
      'The survivor ecology does not match the exact trusted terminal replay.',
    )
  }
}

/**
 * PostgreSQL jsonb deliberately does not preserve object-key insertion order.
 * Rebuild the nested objects in the server extractor's canonical field order
 * before checking the historical terminal-fingerprint algorithm.
 */
function stableTerminalFingerprint(
  candidates: readonly SurvivorCandidate[],
): string {
  return terminalFingerprint(candidates.map((candidate) => ({
    ...candidate,
    finalCoordinate: {
      ring: candidate.finalCoordinate.ring,
      sector: candidate.finalCoordinate.sector,
    },
    facet: {
      id: candidate.facet.id,
      title: candidate.facet.title,
      focus: candidate.facet.focus,
      hexagram: candidate.facet.hexagram,
      hexagramName: candidate.facet.hexagramName,
      theme: candidate.facet.theme,
      dimension: candidate.facet.dimension,
      movement: candidate.facet.movement,
      prompt: candidate.facet.prompt,
      keyword: candidate.facet.keyword,
      ...(candidate.facet.castApplication === undefined
        ? {}
        : { castApplication: candidate.facet.castApplication }),
    },
    route: candidate.route.map((step) => ({
      ply: step.ply,
      from: { ring: step.from.ring, sector: step.from.sector },
      to: { ring: step.to.ring, sector: step.to.sector },
      capturedPieceId: step.capturedPieceId,
      promotedTo: step.promotedTo,
    })),
  })))
}

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
  trajectory_directional_record_version,
  trajectory_directional_record_digest,
  trajectory_directional_record,
  answer_prompt_digest,
  survivor_set,
  portia_current_candidate_id,
  portia_active_model_request_id,
  portia_failed_attempt_count,
  portia_failure_limit,
  portia_completed_candidate_ids,
  portia_assessment_drafts,
  charlotte_active_model_request_id,
  charlotte_failed_attempt_count,
  charlotte_failure_limit,
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

const SELECT_DIRECTIONAL_SOURCE_COLUMNS = `
  division_seed,
  division_digest,
  problem_parts,
  status,
  outcome,
  event_version,
  rules_version,
  engine_version,
  cast_version
`

const SELECT_GAME_EVENT_COLUMNS = `
  game_id,
  ply,
  kind,
  source,
  side,
  piece_id,
  captured_piece_id,
  promoted_to,
  from_ring,
  from_sector,
  to_ring,
  to_sector,
  idempotency_key,
  request_sha256,
  game_revision,
  created_at
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
  answer_user_prompt,
  answer_user_prompt_sha256,
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
  charlotte_binding_version,
  idempotency_key,
  request_digest,
  actor,
  action,
  tested_assumption,
  expected_observation,
  decision_threshold,
  review_horizon,
  follow_up_at,
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

const SELECT_WEB_MEMORY_EVIDENCE_BASE_COLUMNS = `
  observation.id AS observation_id,
  source_game.id AS source_game_id,
  action.id AS source_action_id,
  source_game.problem AS source_problem,
  action.action,
  action.tested_assumption,
  action.expected_observation,
  observation.observed_at,
  observation.observation,
  observation.evidence_classification,
  observation.expected_effect,
  observation.unexpected_effect,
  observation.stakeholder_response,
  observation.assumption_result,
  observation.next_decision
`

const SELECT_LINKED_WEB_MEMORY_EVIDENCE_COLUMNS = `
  ${SELECT_WEB_MEMORY_EVIDENCE_BASE_COLUMNS},
  link.selection_ordinal,
  link.consent_version,
  link.created_at AS attached_at
`

const SELECT_SELECTED_WEB_MEMORY_EVIDENCE_COLUMNS = `
  ${SELECT_WEB_MEMORY_EVIDENCE_BASE_COLUMNS},
  selected.selection_ordinal,
  $3::text AS consent_version,
  NULL::timestamptz AS attached_at
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
  return value.toLowerCase()
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

function optionalTimestamp(value: string | null, label: string): string | null {
  if (value === null) return null
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) {
    throw new LifecycleRepositoryError(
      'invalid-input',
      `${label} must be an ISO timestamp.`,
    )
  }
  return timestamp.toISOString()
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

function portiaFromRow(
  row: PortiaReviewRow | undefined,
): PersistedPortiaReview | null {
  if (!row) return null
  const schema = row.contract_version === 'webchess-portia-review-v1'
    ? legacyPortiaReviewSchema
    : row.contract_version === LEGACY_PROMPT_BOUND_PORTIA_CONTRACT_VERSION
      ? legacyPromptBoundPortiaReviewSchema
      : row.contract_version === CURRENT_LIFECYCLE_VERSIONS.portiaContract
        ? currentPortiaReviewSchema
        : null
  const parsed = schema?.safeParse(row.review)
  if (!parsed || !parsed.success) {
    throw new LifecycleRepositoryError(
      'integrity-error',
      'The stored Portia review violates its versioned contract.',
      { cause: parsed?.error },
    )
  }
  return parsed.data
}

function gateFromRow(row: GateDecisionRow | undefined): GateResult | null {
  if (!row) return null
  if (
    (row.answer_user_prompt === null) !==
      (row.answer_user_prompt_sha256 === null) ||
    (row.answer_user_prompt !== null && !row.passed) ||
    (
      row.answer_user_prompt !== null &&
      sha256Hex(row.answer_user_prompt) !== row.answer_user_prompt_sha256
    )
  ) {
    throw new LifecycleRepositoryError(
      'integrity-error',
      'The stored player-visible Answer prompt failed its immutable provenance check.',
    )
  }
  const parsed = persistedGateResultSchema.safeParse(row.result)
  if (!parsed.success) {
    throw new LifecycleRepositoryError(
      'integrity-error',
      'The stored Gate result violates its versioned contract.',
      { cause: parsed.error },
    )
  }
  const result = parsed.data
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
  return result
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
    charlotteBindingVersion: row.charlotte_binding_version,
    actor: row.actor,
    action: row.action,
    testedAssumption: row.tested_assumption,
    expectedObservation: row.expected_observation,
    decisionThreshold: row.decision_threshold,
    reviewHorizon: row.review_horizon,
    followUpAt: row.follow_up_at?.toISOString() ?? null,
    status: row.status,
    revision: revisionNumber(row.revision),
    version: CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

const webMemoryEvidenceRowSchema = z.object({
  observation_id: z.string().uuid(),
  source_game_id: z.string().uuid(),
  source_action_id: z.string().uuid(),
  source_problem: z.string().min(12).max(240),
  action: z.string().min(8).max(2_000),
  tested_assumption: z.string().min(8).max(1_000),
  expected_observation: z.string().min(8).max(1_000),
  observed_at: z.preprocess(
    (value) => (typeof value === 'string' ? new Date(value) : value),
    z.date(),
  ),
  observation: z.string().min(3).max(4_000),
  evidence_classification: z.string().min(3).max(240),
  expected_effect: z.string().min(1).max(2_000),
  unexpected_effect: z.string().min(1).max(2_000),
  stakeholder_response: z.string().min(1).max(2_000),
  assumption_result: z.enum(['supported', 'rejected', 'unresolved']),
  next_decision: z.string().min(3).max(2_000),
  selection_ordinal: z.number().int().min(0).max(7),
  consent_version: z.literal(CURRENT_WEB_MEMORY_CONSENT_VERSION),
  attached_at: z.preprocess(
    (value) => (typeof value === 'string' ? new Date(value) : value),
    z.date().nullable(),
  ),
})

type WebMemoryEvidenceRow = z.infer<typeof webMemoryEvidenceRowSchema>

const webMemoryCaseRowSchema = z.object({
  game_id: z.string().uuid(),
  problem: z.string().min(12).max(240),
  is_current: z.boolean(),
  created_at: z.preprocess(
    (value) => (typeof value === 'string' ? new Date(value) : value),
    z.date(),
  ),
  updated_at: z.preprocess(
    (value) => (typeof value === 'string' ? new Date(value) : value),
    z.date(),
  ),
})

const webMemoryActionRowSchema = wilburActionRowSchema.extend({
  game_id: z.string().uuid(),
})

function webMemoryEvidenceFromRow(row: WebMemoryEvidenceRow): WebMemoryEvidence {
  return {
    observationId: row.observation_id,
    sourceGameId: row.source_game_id,
    sourceActionId: row.source_action_id,
    sourceProblem: row.source_problem,
    action: row.action,
    testedAssumption: row.tested_assumption,
    expectedObservation: row.expected_observation,
    observedAt: row.observed_at.toISOString(),
    observation: row.observation,
    evidenceClassification: row.evidence_classification,
    expectedEffect: row.expected_effect,
    unexpectedEffect: row.unexpected_effect,
    stakeholderResponse: row.stakeholder_response,
    assumptionResult: row.assumption_result,
    nextDecision: row.next_decision,
    selectionOrdinal: row.selection_ordinal,
    consentVersion: row.consent_version,
    attachedAt: row.attached_at?.toISOString() ?? null,
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
  researchRequests: readonly ResearchRequestRow[],
  researchSources: readonly ResearchSourceRow[],
  activities: readonly LifecycleEventRow[],
  webMemoryEvidence: readonly WebMemoryEvidenceRow[],
  directionalSource: TrustedDirectionalSource,
): LifecycleAggregate {
  let trajectoryDirectionalRecord: TrajectoryDirectionalRecord | null = null
  if (row.trajectory_directional_record !== null) {
    trajectoryDirectionalRecord = verifyDirectionalRecordAgainstTrustedSource(
      row.trajectory_directional_record,
      row,
      directionalSource,
      'invalid-state',
    )
    if (
      row.trajectory_directional_record_version !==
        trajectoryDirectionalRecord.version ||
      row.trajectory_directional_record_digest !==
        trajectoryDirectionalRecord.digest
    ) {
      throw new LifecycleRepositoryError(
        'invalid-state',
        'The saved trajectory directional record provenance is inconsistent.',
      )
    }
    if (row.terminal_fingerprint === null) {
      throw new LifecycleRepositoryError(
        'invalid-state',
        'The saved trajectory directional record is missing terminal evidence.',
      )
    }
    assertDirectionalSurvivorBinding(
      trajectoryDirectionalRecord,
      survivorArray(row.survivor_set),
      row.terminal_fingerprint,
      row,
      directionalSource,
      'invalid-state',
    )
  }
  if (
    row.lifecycle_version === CURRENT_LIFECYCLE_VERSIONS.lifecycle &&
    row.terminal_fingerprint !== null &&
    trajectoryDirectionalRecord === null
  ) {
    throw new LifecycleRepositoryError(
      'invalid-state',
      'A current terminal lifecycle is missing its trajectory directional record.',
    )
  }
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
    trajectoryDirectionalRecord,
    trajectoryDirectionalRecordStatus: trajectoryDirectionalRecord
      ? 'bound'
      : row.terminal_fingerprint === null
        ? 'not_terminal'
        : 'legacy_pre_directional_generation',
    answerPromptDigest: row.answer_prompt_digest,
    answerUserPrompt: gate?.answer_user_prompt ?? null,
    answerUserPromptSha256: gate?.answer_user_prompt_sha256 ?? null,
    survivors: survivorArray(row.survivor_set),
    portiaActiveModelRequestId: row.portia_active_model_request_id,
    portiaFailedAttemptCount: row.portia_failed_attempt_count,
    portiaFailureLimit: row.portia_failure_limit,
    portiaProgress: {
      currentCandidateId: row.portia_current_candidate_id,
      completedCandidateIds: stringArray(
        row.portia_completed_candidate_ids,
        'completed Portia candidates',
      ),
      completedAssessments: row.portia_assessment_drafts.map((assessment) =>
        portiaCandidateAssessmentSchema.parse(assessment)),
    },
    portia: portiaFromRow(portia),
    gate: gateFromRow(gate),
    charlotteActiveModelRequestId: row.charlotte_active_model_request_id,
    charlotteFailedAttemptCount: row.charlotte_failed_attempt_count,
    charlotteFailureLimit: row.charlotte_failure_limit,
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
      trajectoryDirectionalRecord:
        row.trajectory_directional_record_version,
      rules: row.rules_version,
      engine: row.engine_version,
      cast: row.cast_version,
      event: row.event_version,
    },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
  return {
    ...run,
    activities: activities.map(activityFromRow),
    research: researchRecordsFromRows(researchRequests, researchSources),
    webMemoryEvidence: webMemoryEvidence.map(webMemoryEvidenceFromRow),
  }
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

  private async trustedDirectionalSource(
    ownerId: string,
    gameId: string,
  ): Promise<TrustedDirectionalSource> {
    const results = await this.database.transaction(
      [
        {
          text: `SELECT ${SELECT_DIRECTIONAL_SOURCE_COLUMNS} FROM games WHERE clerk_user_id = $1::text AND id = $2::uuid`,
          values: [assertOwner(ownerId), assertUuid(gameId, 'Game id')],
        },
        {
          text: `SELECT ${SELECT_GAME_EVENT_COLUMNS} FROM game_events WHERE game_id = $1::uuid ORDER BY ply`,
          values: [assertUuid(gameId, 'Game id')],
        },
      ],
      { isolationLevel: 'RepeatableRead', readOnly: true },
    )
    return directionalSourceFromResults(results[0]!, results[1]!)
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
          text: `SELECT ${SELECT_RESEARCH_REQUEST_COLUMNS} FROM research_requests WHERE clerk_user_id = $1::text AND game_id = $2::uuid AND lifecycle_run_id = (SELECT id FROM lifecycle_runs WHERE clerk_user_id = $1::text AND game_id = $2::uuid) ORDER BY created_at, id`,
          values: [owner, id],
        },
        {
          text: `SELECT ${SELECT_RESEARCH_SOURCE_COLUMNS} FROM research_sources WHERE clerk_user_id = $1::text AND research_request_id IN (SELECT id FROM research_requests WHERE clerk_user_id = $1::text AND game_id = $2::uuid AND lifecycle_run_id = (SELECT id FROM lifecycle_runs WHERE clerk_user_id = $1::text AND game_id = $2::uuid)) ORDER BY research_request_id, ordinal`,
          values: [owner, id],
        },
        {
          text: `SELECT ${SELECT_EVENT_COLUMNS} FROM lifecycle_events WHERE clerk_user_id = $1::text AND lifecycle_run_id = (SELECT id FROM lifecycle_runs WHERE clerk_user_id = $1::text AND game_id = $2::uuid) ORDER BY sequence`,
          values: [owner, id],
        },
        {
          text: `
            SELECT ${SELECT_LINKED_WEB_MEMORY_EVIDENCE_COLUMNS}
            FROM web_memory_links AS link
            JOIN wilbur_observations AS observation
              ON observation.id = link.source_observation_id
              AND observation.clerk_user_id = link.clerk_user_id
            JOIN wilbur_actions AS action
              ON action.id = observation.action_id
              AND action.clerk_user_id = link.clerk_user_id
            JOIN lifecycle_runs AS source_run
              ON source_run.id = action.lifecycle_run_id
              AND source_run.clerk_user_id = link.clerk_user_id
            JOIN games AS source_game
              ON source_game.id = source_run.game_id
              AND source_game.clerk_user_id = link.clerk_user_id
            WHERE link.clerk_user_id = $1::text
              AND link.target_game_id = $2::uuid
            ORDER BY link.selection_ordinal
          `,
          values: [owner, id],
        },
        {
          text: `SELECT ${SELECT_DIRECTIONAL_SOURCE_COLUMNS} FROM games WHERE clerk_user_id = $1::text AND id = $2::uuid`,
          values: [owner, id],
        },
        {
          text: `SELECT ${SELECT_GAME_EVENT_COLUMNS} FROM game_events WHERE game_id = $1::uuid ORDER BY ply`,
          values: [id],
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
        parseResultRows(results[6]!, researchRequestRowSchema),
        parseResultRows(results[7]!, researchSourceRowSchema),
        parseResultRows(results[8]!, lifecycleEventRowSchema),
        parseResultRows(results[9]!, webMemoryEvidenceRowSchema),
        directionalSourceFromResults(results[10]!, results[11]!),
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

  async listWebMemory(ownerId: string): Promise<WebMemoryIndex> {
    const owner = assertOwner(ownerId)
    const recentCases = `
      WITH recent_cases AS (
        SELECT game.id AS game_id, game.problem, game.is_current,
          game.created_at, game.updated_at,
          max(action.updated_at) AS memory_updated_at
        FROM games AS game
        JOIN lifecycle_runs AS run
          ON run.game_id = game.id AND run.clerk_user_id = game.clerk_user_id
        JOIN wilbur_actions AS action
          ON action.lifecycle_run_id = run.id
          AND action.clerk_user_id = game.clerk_user_id
        WHERE game.clerk_user_id = $1::text
        GROUP BY game.id, game.problem, game.is_current,
          game.created_at, game.updated_at
        ORDER BY max(action.updated_at) DESC, game.id
        LIMIT 24
      )
    `
    const results = await this.database.transaction([
      {
        text: `${recentCases}
          SELECT game_id, problem, is_current, created_at, updated_at
          FROM recent_cases
          ORDER BY memory_updated_at DESC, game_id`,
        values: [owner],
      },
      {
        text: `${recentCases}
          SELECT ${SELECT_ACTION_COLUMNS.replaceAll('\n  ', '\n  action.')},
            recent_cases.game_id
          FROM recent_cases
          JOIN lifecycle_runs AS run ON run.game_id = recent_cases.game_id
          JOIN wilbur_actions AS action
            ON action.lifecycle_run_id = run.id
            AND action.clerk_user_id = $1::text
          ORDER BY recent_cases.memory_updated_at DESC, action.created_at, action.id`,
        values: [owner],
      },
      {
        text: `${recentCases}
          SELECT ${SELECT_OBSERVATION_COLUMNS.replaceAll('\n  ', '\n  observation.')}
          FROM recent_cases
          JOIN lifecycle_runs AS run ON run.game_id = recent_cases.game_id
          JOIN wilbur_actions AS action
            ON action.lifecycle_run_id = run.id
            AND action.clerk_user_id = $1::text
          JOIN wilbur_observations AS observation
            ON observation.action_id = action.id
            AND observation.clerk_user_id = $1::text
          ORDER BY observation.observed_at, observation.created_at, observation.id`,
        values: [owner],
      },
      {
        text: `
          SELECT link.source_observation_id::text AS observation_id
          FROM web_memory_links AS link
          JOIN games AS game
            ON game.id = link.target_game_id
            AND game.clerk_user_id = link.clerk_user_id
          WHERE link.clerk_user_id = $1::text AND game.is_current
          ORDER BY link.selection_ordinal
        `,
        values: [owner],
      },
    ], { isolationLevel: 'RepeatableRead', readOnly: true })

    try {
      const caseRows = parseResultRows(results[0]!, webMemoryCaseRowSchema)
      const actionRows = parseResultRows(results[1]!, webMemoryActionRowSchema)
      const observationRows = parseResultRows(
        results[2]!,
        wilburObservationRowSchema,
      )
      const carriedRows = parseResultRows(
        results[3]!,
        z.object({ observation_id: z.string().uuid() }),
      )
      const observationsByAction = new Map<string, WilburObservation[]>()
      for (const row of observationRows) {
        const items = observationsByAction.get(row.action_id) ?? []
        items.push(observationFromRow(row))
        observationsByAction.set(row.action_id, items)
      }
      const actionsByGame = new Map<string, WebMemoryCase['actions'][number][]>()
      for (const row of actionRows) {
        const items = actionsByGame.get(row.game_id) ?? []
        items.push({
          action: actionFromRow(row),
          observations: observationsByAction.get(row.id) ?? [],
        })
        actionsByGame.set(row.game_id, items)
      }
      return {
        cases: caseRows.map((row) => ({
          gameId: row.game_id,
          problem: row.problem,
          isCurrent: row.is_current,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
          actions: actionsByGame.get(row.game_id) ?? [],
        })),
        carriedObservationIds: carriedRows.map((row) => row.observation_id),
      }
    } catch (error) {
      throw new LifecycleRepositoryError(
        'integrity-error',
        'The Web memory index contains invalid persisted data.',
        { cause: error },
      )
    }
  }

  async getWebMemoryEvidence(
    ownerId: string,
    observationIds: readonly string[],
  ): Promise<readonly WebMemoryEvidence[]> {
    const owner = assertOwner(ownerId)
    const ids = [...new Set(observationIds.map((id) =>
      assertUuid(id, 'Web memory observation id')))]
    if (ids.length > 8) {
      throw new LifecycleRepositoryError(
        'invalid-input',
        'A game can carry at most eight prior Wilbur observations.',
      )
    }
    if (ids.length === 0) return []
    const result = await this.database.query({
      text: `
        WITH selected AS MATERIALIZED (
          SELECT observation_id, (ordinality - 1)::smallint
            AS selection_ordinal
          FROM unnest($2::uuid[]) WITH ORDINALITY
            AS requested(observation_id, ordinality)
        )
        SELECT ${SELECT_SELECTED_WEB_MEMORY_EVIDENCE_COLUMNS}
        FROM selected
        JOIN wilbur_observations AS observation
          ON observation.id = selected.observation_id
        JOIN wilbur_actions AS action
          ON action.id = observation.action_id
          AND action.clerk_user_id = observation.clerk_user_id
        JOIN lifecycle_runs AS source_run
          ON source_run.id = action.lifecycle_run_id
          AND source_run.clerk_user_id = observation.clerk_user_id
        JOIN games AS source_game
          ON source_game.id = source_run.game_id
          AND source_game.clerk_user_id = observation.clerk_user_id
        WHERE observation.clerk_user_id = $1::text
        ORDER BY selected.selection_ordinal
      `,
      values: [owner, ids, CURRENT_WEB_MEMORY_CONSENT_VERSION],
    })
    const rows = parseResultRows(result, webMemoryEvidenceRowSchema)
    if (rows.length !== ids.length) {
      throw new LifecycleRepositoryError(
        'invalid-input',
        'One or more selected Web memory observations are unavailable.',
      )
    }
    return rows.map(webMemoryEvidenceFromRow)
  }

  async getWebMemoryEvidenceForGame(
    ownerId: string,
    gameId: string,
  ): Promise<readonly WebMemoryEvidence[]> {
    const owner = assertOwner(ownerId)
    const id = assertUuid(gameId, 'Game id')
    const result = await this.database.query({
      text: `
        SELECT ${SELECT_LINKED_WEB_MEMORY_EVIDENCE_COLUMNS}
        FROM web_memory_links AS link
        JOIN wilbur_observations AS observation
          ON observation.id = link.source_observation_id
          AND observation.clerk_user_id = link.clerk_user_id
        JOIN wilbur_actions AS action
          ON action.id = observation.action_id
          AND action.clerk_user_id = link.clerk_user_id
        JOIN lifecycle_runs AS source_run
          ON source_run.id = action.lifecycle_run_id
          AND source_run.clerk_user_id = link.clerk_user_id
        JOIN games AS source_game
          ON source_game.id = source_run.game_id
          AND source_game.clerk_user_id = link.clerk_user_id
        WHERE link.clerk_user_id = $1::text
          AND link.target_game_id = $2::uuid
        ORDER BY link.selection_ordinal
      `,
      values: [owner, id],
    })
    return parseResultRows(result, webMemoryEvidenceRowSchema)
      .map(webMemoryEvidenceFromRow)
  }

  async attachWebMemoryEvidence(
    ownerId: string,
    gameId: string,
    observationIds: readonly string[],
  ): Promise<void> {
    const owner = assertOwner(ownerId)
    const targetGameId = assertUuid(gameId, 'Game id')
    const ids = [...new Set(observationIds.map((id) =>
      assertUuid(id, 'Web memory observation id')))]
    if (ids.length > 8) {
      throw new LifecycleRepositoryError(
        'invalid-input',
        'A game can carry at most eight prior Wilbur observations.',
      )
    }
    if (ids.length === 0) return
    const linkIds = ids.map(() => randomUUID())
    const result = await this.database.query({
      text: `
        WITH owned_target AS MATERIALIZED (
          SELECT target.id
          FROM games AS target
          WHERE target.id = $2::uuid
            AND target.clerk_user_id = $1::text
          FOR UPDATE
        ),
        requested AS MATERIALIZED (
          SELECT selected.link_id, selected.observation_id,
            (selected.ordinality - 1)::smallint AS selection_ordinal
          FROM unnest($3::uuid[], $4::uuid[]) WITH ORDINALITY
            AS selected(link_id, observation_id, ordinality)
        ),
        eligible AS MATERIALIZED (
          SELECT requested.link_id, requested.observation_id,
            requested.selection_ordinal
          FROM requested
          CROSS JOIN owned_target
          JOIN wilbur_observations AS observation
            ON observation.id = requested.observation_id
            AND observation.clerk_user_id = $1::text
          JOIN wilbur_actions AS action
            ON action.id = observation.action_id
            AND action.clerk_user_id = observation.clerk_user_id
          JOIN lifecycle_runs AS source_run
            ON source_run.id = action.lifecycle_run_id
            AND source_run.clerk_user_id = observation.clerk_user_id
          WHERE source_run.game_id <> owned_target.id
        ),
        existing AS MATERIALIZED (
          SELECT link.source_observation_id, link.selection_ordinal,
            link.consent_version
          FROM web_memory_links AS link
          CROSS JOIN owned_target
          WHERE link.clerk_user_id = $1::text
            AND link.target_game_id = owned_target.id
        ),
        inserted AS (
          INSERT INTO web_memory_links (
            id, clerk_user_id, target_game_id, source_observation_id,
            selection_ordinal, consent_version
          )
          SELECT eligible.link_id, $1::text, $2::uuid,
            eligible.observation_id, eligible.selection_ordinal, $5::text
          FROM eligible
          WHERE (SELECT count(*) FROM eligible) = $6::integer
            AND NOT EXISTS (SELECT 1 FROM existing)
          ORDER BY eligible.selection_ordinal
          ON CONFLICT DO NOTHING
          RETURNING source_observation_id, selection_ordinal, consent_version
        ),
        linked AS (
          SELECT source_observation_id, selection_ordinal, consent_version
          FROM existing
          UNION ALL
          SELECT source_observation_id, selection_ordinal, consent_version
          FROM inserted
        )
        SELECT count(*)::integer AS linked_count,
          coalesce(bool_and(
            linked.source_observation_id =
              ($4::uuid[])[linked.selection_ordinal + 1]
            AND linked.consent_version = $5::text
          ), false) AS selection_matches
        FROM linked
      `,
      values: [
        owner,
        targetGameId,
        linkIds,
        ids,
        CURRENT_WEB_MEMORY_CONSENT_VERSION,
        ids.length,
      ],
    })
    const row = parseOptionalResultRow(
      result,
      z.object({
        linked_count: z.coerce.number().int().nonnegative(),
        selection_matches: z.boolean(),
      }),
    )
    if (
      !row ||
      row.linked_count !== ids.length ||
      !row.selection_matches
    ) {
      throw new LifecycleRepositoryError(
        'invalid-input',
        'The selected Web memory observations could not be attached safely.',
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
    if (input.terminalFingerprint !== undefined) {
      assertDigest(input.terminalFingerprint, 'Terminal fingerprint')
    }
    let trustedDirectionalSource: TrustedDirectionalSource | null = null
    let trajectoryDirectionalRecord: TrajectoryDirectionalRecord | null = null
    if (input.trajectoryDirectionalRecord !== undefined) {
      if (input.to !== 'chess_terminal' || input.terminalFingerprint === undefined) {
        throw new LifecycleRepositoryError(
          'invalid-input',
          'A trajectory directional record may only be bound atomically at the terminal chess transition.',
        )
      }
      trustedDirectionalSource = await this.trustedDirectionalSource(
        owner,
        gameId,
      )
      trajectoryDirectionalRecord = verifyDirectionalRecordAgainstTrustedSource(
        input.trajectoryDirectionalRecord,
        before,
        trustedDirectionalSource,
        'invalid-input',
      )
      assertDirectionalSurvivorBinding(
        trajectoryDirectionalRecord,
        input.survivors ?? [],
        input.terminalFingerprint,
        before,
        trustedDirectionalSource,
      )
    }
    if (before.state === input.to) {
      const current = (await this.getForGame(owner, gameId))!
      if (
        trajectoryDirectionalRecord !== null &&
        (
          current.trajectoryDirectionalRecord?.digest !==
            trajectoryDirectionalRecord.digest ||
          current.terminalFingerprint !== input.terminalFingerprint
        )
      ) {
        throw new LifecycleRepositoryError(
          'conflict',
          'The terminal lifecycle was already bound to different immutable evidence.',
        )
      }
      return current
    }
    if (revisionNumber(before.revision) !== expectedRevision) {
      throw new LifecycleRepositoryError(
        'conflict',
        `Lifecycle revision changed from ${expectedRevision} to ${before.revision.toString()}.`,
      )
    }
    if (
      input.to === 'charlotte_running' ||
      (
        before.state === 'charlotte_running' &&
        (
          input.to === 'charlotte_pending' ||
          input.to === 'charlotte_unavailable' ||
          input.to === 'charlotte_complete'
        )
      )
    ) {
      throw new LifecycleRepositoryError(
        'invalid-state',
        'Charlotte provider transitions require the bounded attempt fence.',
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
    if (
      before.lifecycle_version === CURRENT_LIFECYCLE_VERSIONS.lifecycle &&
      input.to === 'chess_terminal' &&
      trajectoryDirectionalRecord === null
    ) {
      throw new LifecycleRepositoryError(
        'invalid-input',
        'Current lifecycle runs require a trajectory directional record at terminal settlement.',
      )
    }

    const result = await this.database.query({
      text: `
        WITH advanced AS (
          UPDATE lifecycle_runs
          SET state = $5::text,
              revision = revision + 1,
              portia_current_candidate_id = CASE
                WHEN $5::text = 'portia_pending' THEN NULL
                ELSE portia_current_candidate_id
              END,
              portia_active_model_request_id = CASE
                WHEN $4::text = 'portia_running' AND $5::text <> 'portia_running'
                  THEN NULL
                ELSE portia_active_model_request_id
              END,
              charlotte_active_model_request_id = CASE
                WHEN $4::text = 'charlotte_running' AND $5::text <> 'charlotte_running'
                  THEN NULL
                ELSE charlotte_active_model_request_id
              END,
              portia_completed_candidate_ids = CASE
                WHEN $5::text = 'portia_pending' AND $4::text <> 'portia_running'
                  THEN '[]'::jsonb
                ELSE portia_completed_candidate_ids
              END,
              portia_assessment_drafts = CASE
                WHEN $5::text = 'portia_pending' AND $4::text <> 'portia_running'
                  THEN '[]'::jsonb
                ELSE portia_assessment_drafts
              END,
              terminal_fingerprint = CASE WHEN $14::boolean THEN $12::char(64) ELSE terminal_fingerprint END,
              survivor_set = CASE WHEN $14::boolean THEN $13::jsonb ELSE survivor_set END,
              trajectory_directional_record_version = CASE WHEN $18::boolean THEN $15::text ELSE trajectory_directional_record_version END,
              trajectory_directional_record_digest = CASE WHEN $18::boolean THEN $16::char(64) ELSE trajectory_directional_record_digest END,
              trajectory_directional_record = CASE WHEN $18::boolean THEN $17::jsonb ELSE trajectory_directional_record END,
              updated_at = now()
          WHERE clerk_user_id = $1::text
            AND game_id = $2::uuid
            AND revision = $3::bigint
            AND state = $4::text
            AND (
              NOT $18::boolean
              OR EXISTS (
                SELECT 1
                FROM games AS trusted_game
                WHERE trusted_game.id = lifecycle_runs.game_id
                  AND trusted_game.clerk_user_id = lifecycle_runs.clerk_user_id
                  AND trusted_game.status IN (
                    'completed', 'answering', 'answer_failed', 'answered'
                  )
                  AND trusted_game.division_seed = lifecycle_runs.division_seed
                  AND trusted_game.division_digest = $19::char(64)
                  AND trusted_game.problem_parts = $20::jsonb
                  AND trusted_game.outcome = $21::jsonb
                  AND trusted_game.event_version = lifecycle_runs.event_version
                  AND trusted_game.rules_version = lifecycle_runs.rules_version
                  AND trusted_game.engine_version = lifecycle_runs.engine_version
                  AND trusted_game.cast_version = lifecycle_runs.cast_version
                  AND coalesce(
                    (
                      SELECT jsonb_agg(
                        CASE
                          WHEN trusted_event.kind = 'pass' THEN
                            jsonb_build_object(
                              'version', trusted_game.event_version,
                              'type', 'forced-pass',
                              'ply', trusted_event.ply,
                              'side', trusted_event.side,
                              'reason', 'no-legal-move'
                            )
                          ELSE
                            jsonb_strip_nulls(jsonb_build_object(
                              'version', trusted_game.event_version,
                              'type', 'move',
                              'ply', trusted_event.ply,
                              'side', trusted_event.side,
                              'pieceId', trusted_event.piece_id,
                              'from', jsonb_build_object(
                                'ring', trusted_event.from_ring,
                                'sector', trusted_event.from_sector
                              ),
                              'to', jsonb_build_object(
                                'ring', trusted_event.to_ring,
                                'sector', trusted_event.to_sector
                              ),
                              'capturedPieceId', trusted_event.captured_piece_id,
                              'promotedTo', trusted_event.promoted_to
                            ))
                        END
                        ORDER BY trusted_event.ply
                      )
                      FROM game_events AS trusted_event
                      WHERE trusted_event.game_id = trusted_game.id
                    ),
                    '[]'::jsonb
                  ) = $22::jsonb
              )
            )
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
            $23::text, $24::smallint
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
        trajectoryDirectionalRecord?.version ?? null,
        trajectoryDirectionalRecord?.digest ?? null,
        json(trajectoryDirectionalRecord),
        trajectoryDirectionalRecord !== null,
        trustedDirectionalSource?.row.division_digest ?? null,
        json(trustedDirectionalSource?.row.problem_parts ?? null),
        json(trustedDirectionalSource?.row.outcome ?? null),
        json(trustedDirectionalSource?.events ?? null),
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

  async beginPortiaAttempt(
    input: BeginPortiaAttemptInput,
  ): Promise<LifecycleAggregate> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const expectedRevision = assertRevision(input.expectedRevision)
    const modelRequestId = assertUuid(input.modelRequestId, 'Model request id')
    assertDigest(input.requestDigest, 'Portia request digest')
    assertDigest(input.answerPromptDigest, 'Answer prompt digest')
    assertDigest(input.configurationDigest, 'Configuration digest')

    const result = await this.database.query({
      text: `
        WITH eligible_model AS (
          SELECT id
          FROM model_requests
          WHERE id = $4::uuid
            AND clerk_user_id = $1::text
            AND game_id = $2::uuid
            AND operation = 'portia'
            AND status IN ('in_progress', 'succeeded')
            AND request_sha256 = $5::char(64)
            AND prompt_version = $10::text
        ),
        advanced AS (
          UPDATE lifecycle_runs
          SET state = 'portia_running',
              revision = revision + 1,
              portia_active_model_request_id = $4::uuid,
              answer_prompt_digest = coalesce(answer_prompt_digest, $6::char(64)),
              portia_current_candidate_id = NULL,
              updated_at = now()
          WHERE clerk_user_id = $1::text
            AND game_id = $2::uuid
            AND revision = $3::bigint
            AND state = 'portia_pending'
            AND portia_failed_attempt_count < portia_failure_limit
            AND (
              answer_prompt_digest IS NULL
              OR answer_prompt_digest = $6::char(64)
            )
            AND EXISTS (SELECT 1 FROM eligible_model)
          RETURNING ${SELECT_RUN_COLUMNS}
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
            'portia', $8::text, 'portia_pending', 'portia_running',
            jsonb_build_array($2::text), '[]'::jsonb,
            jsonb_build_array('portia'), $7::char(64), 'started', $9::smallint
          FROM advanced
          RETURNING lifecycle_run_id
        )
        SELECT ${SELECT_RUN_COLUMNS} FROM advanced
      `,
      values: [
        owner,
        gameId,
        expectedRevision,
        modelRequestId,
        input.requestDigest,
        input.answerPromptDigest,
        input.configurationDigest,
        input.activityType,
        CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
        CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
      ],
    })
    if (!parsedOptionalRun(result)) {
      throw new LifecycleRepositoryError(
        'conflict',
        'Portia could not bind the matching active provider request.',
      )
    }
    return (await this.getForGame(owner, gameId))!
  }

  async updatePortiaProgress(
    input: UpdatePortiaProgressInput,
  ): Promise<LifecycleAggregate> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const expectedRevision = assertRevision(input.expectedRevision)
    const modelRequestId = assertUuid(input.modelRequestId, 'Model request id')
    assertDigest(input.answerPromptDigest, 'Answer prompt digest')
    if (
      input.currentCandidateId !== null &&
      (input.currentCandidateId.length < 3 || input.currentCandidateId.length > 220)
    ) {
      throw new LifecycleRepositoryError(
        'invalid-state',
        'The current Portia candidate id is invalid.',
      )
    }
    const completed = [...new Set(input.completedCandidateIds)]
    const assessments = input.completedAssessments.map((assessment) =>
      portiaCandidateAssessmentSchema.parse(assessment),
    )
    if (
      completed.length !== input.completedCandidateIds.length ||
      completed.some(
        (candidateId) => candidateId.length < 3 || candidateId.length > 220,
      )
    ) {
      throw new LifecycleRepositoryError(
        'invalid-state',
        'The completed Portia candidate ids are invalid.',
      )
    }
    if (
      assessments.length !== completed.length ||
      assessments.some(
        (assessment, index) => assessment.candidateId !== completed[index],
      )
    ) {
      throw new LifecycleRepositoryError(
        'invalid-state',
        'Completed Portia assessments must match the persisted traversal order.',
      )
    }

    const result = await this.database.query({
      text: `
        UPDATE lifecycle_runs
        SET answer_prompt_digest = coalesce(answer_prompt_digest, $3::char(64)),
            portia_current_candidate_id = $4::text,
            portia_completed_candidate_ids = $5::jsonb,
            portia_assessment_drafts = $6::jsonb,
            updated_at = now()
        WHERE clerk_user_id = $1::text
          AND game_id = $2::uuid
          AND revision = $7::bigint
          AND state = 'portia_running'
          AND portia_active_model_request_id = $8::uuid
          AND (
            answer_prompt_digest IS NULL
            OR answer_prompt_digest = $3::char(64)
          )
          AND jsonb_array_length(portia_completed_candidate_ids)
            <= jsonb_array_length($5::jsonb)
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(portia_completed_candidate_ids)
              WITH ORDINALITY AS prior(candidate_id, position)
            WHERE ($5::jsonb ->> (prior.position::integer - 1))
              IS DISTINCT FROM prior.candidate_id
          )
        RETURNING ${SELECT_RUN_COLUMNS}
      `,
      values: [
        owner,
        gameId,
        input.answerPromptDigest,
        input.currentCandidateId,
        json(completed),
        json(assessments),
        expectedRevision,
        modelRequestId,
      ],
    })
    if (!parsedOptionalRun(result)) {
      throw new LifecycleRepositoryError(
        'conflict',
        'Portia progress no longer matches the active reviewed prompt.',
      )
    }
    return (await this.getForGame(owner, gameId))!
  }

  async failPortiaAttempt(
    input: FailPortiaAttemptInput,
  ): Promise<LifecycleAggregate> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const expectedRevision = assertRevision(input.expectedRevision)
    const modelRequestId = assertUuid(input.modelRequestId, 'Model request id')
    assertDigest(input.requestDigest, 'Portia request digest')
    assertDigest(input.configurationDigest, 'Configuration digest')

    const result = await this.database.query({
      text: `
        WITH failed_model AS (
          SELECT id
          FROM model_requests
          WHERE id = $4::uuid
            AND clerk_user_id = $1::text
            AND game_id = $2::uuid
            AND operation = 'portia'
            AND status IN ('failed', 'indeterminate')
            AND request_sha256 = $5::char(64)
            AND prompt_version = $9::text
        ),
        advanced AS (
          UPDATE lifecycle_runs
          SET state = CASE
                WHEN portia_failed_attempt_count + 1 >= portia_failure_limit
                  THEN 'portia_unavailable'
                ELSE 'portia_pending'
              END,
              revision = revision + 1,
              portia_active_model_request_id = NULL,
              portia_failed_attempt_count = portia_failed_attempt_count + 1,
              portia_current_candidate_id = CASE
                WHEN portia_failed_attempt_count + 1 >= portia_failure_limit
                  THEN portia_current_candidate_id
                ELSE NULL
              END,
              updated_at = now()
          WHERE clerk_user_id = $1::text
            AND game_id = $2::uuid
            AND revision = $3::bigint
            AND state = 'portia_running'
            AND portia_active_model_request_id = $4::uuid
            AND portia_failed_attempt_count < portia_failure_limit
            AND EXISTS (SELECT 1 FROM failed_model)
          RETURNING ${SELECT_RUN_COLUMNS}
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
            'portia',
            CASE WHEN advanced.state = 'portia_unavailable'
              THEN 'validation_attempt_budget_exhausted'
              ELSE $7::text
            END,
            'portia_running', advanced.state,
            jsonb_build_array($2::text), '[]'::jsonb,
            jsonb_build_array('portia'), $6::char(64),
            CASE WHEN advanced.state = 'portia_unavailable'
              THEN 'refused' ELSE 'failed' END,
            $8::smallint
          FROM advanced
          RETURNING lifecycle_run_id
        )
        SELECT ${SELECT_RUN_COLUMNS} FROM advanced
      `,
      values: [
        owner,
        gameId,
        expectedRevision,
        modelRequestId,
        input.requestDigest,
        input.configurationDigest,
        input.activityType,
        CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
        CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
      ],
    })
    if (!parsedOptionalRun(result)) {
      throw new LifecycleRepositoryError(
        'conflict',
        'Portia failure no longer matches the active provider attempt.',
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
      revisionNumber(before.revision) !== expectedRevision ||
      before.portia_active_model_request_id !== modelRequestId
    ) {
      throw new LifecycleRepositoryError(
        'conflict',
        'Portia can commit only from the matching running revision.',
      )
    }
    const result = await this.database.query({
      text: `
        WITH eligible_model AS (
          SELECT id
          FROM model_requests
          WHERE id = $4::uuid
            AND clerk_user_id = $1::text
            AND game_id = $2::uuid
            AND operation = 'portia'
            AND status = 'succeeded'
            AND request_sha256 = $5::char(64)
            AND response_sha256 = $6::char(64)
            AND prompt_version = $7::text
            AND result_payload->>'format' = 'webchess-portia-result/1'
        ),
        advanced AS (
          UPDATE lifecycle_runs
          SET state = 'portia_complete',
              revision = revision + 1,
              portia_current_candidate_id = NULL,
              portia_active_model_request_id = NULL,
              portia_completed_candidate_ids = (
                SELECT coalesce(
                  jsonb_agg(assessment->>'candidateId' ORDER BY position),
                  '[]'::jsonb
                )
                FROM jsonb_array_elements($9::jsonb->'assessments')
                  WITH ORDINALITY AS completed(assessment, position)
              ),
              portia_assessment_drafts = $9::jsonb->'assessments',
              updated_at = now()
          WHERE clerk_user_id = $1::text AND game_id = $2::uuid
            AND revision = $3::bigint AND state = 'portia_running'
            AND portia_active_model_request_id = $4::uuid
            AND EXISTS (SELECT 1 FROM eligible_model)
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
        review.contractVersion,
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
    if (
      input.answerUserPrompt !== null &&
      (
        typeof input.answerUserPrompt !== 'string' ||
        input.answerUserPrompt.length < 1 ||
        input.answerUserPrompt.length > 200_000
      )
    ) {
      throw new LifecycleRepositoryError(
        'invalid-input',
        'The player-visible Answer prompt must contain 1 to 200000 characters.',
      )
    }
    if (
      (input.result.passed && input.answerUserPrompt === null) ||
      (!input.result.passed && input.answerUserPrompt !== null)
    ) {
      throw new LifecycleRepositoryError(
        'invalid-input',
        'A player-visible Answer prompt is required exactly when the Gate passes.',
      )
    }
    const answerUserPromptSha256 = input.answerUserPrompt === null
      ? null
      : sha256Hex(input.answerUserPrompt)
    const target: LifecycleState = input.result.passed ? 'gate_passed' : 'gate_failed'
    const before = await this.ownedRun(owner, gameId)
    if (before.state === target) {
      let existing = (await this.getForGame(owner, gameId))!
      if (
        input.result.passed &&
        existing.gate?.inputDigest === input.result.inputDigest &&
        existing.answerUserPrompt === null &&
        input.answerUserPrompt !== null
      ) {
        const backfilled = await this.database.query({
          text: `
            UPDATE gate_decisions
            SET answer_user_prompt = $4::text,
                answer_user_prompt_sha256 = $5::char(64)
            WHERE clerk_user_id = $1::text
              AND lifecycle_run_id = (
                SELECT id FROM lifecycle_runs
                WHERE clerk_user_id = $1::text AND game_id = $2::uuid
              )
              AND input_digest = $3::char(64)
              AND passed
              AND answer_user_prompt IS NULL
              AND answer_user_prompt_sha256 IS NULL
          `,
          values: [
            owner,
            gameId,
            input.result.inputDigest,
            input.answerUserPrompt,
            answerUserPromptSha256,
          ],
        })
        if (backfilled.rowCount !== 0 && backfilled.rowCount !== 1) {
          throw new LifecycleRepositoryError(
            'conflict',
            'The historical Gate prompt could not be extended safely.',
          )
        }
        // An identical concurrent backfill may win between the initial read
        // and this UPDATE. Re-read in both cases and let the immutable exact
        // prompt comparison below accept only that same winning value.
        existing = (await this.getForGame(owner, gameId))!
      }
      if (
        existing.gate?.inputDigest !== input.result.inputDigest ||
        existing.answerUserPrompt !== input.answerUserPrompt
      ) {
        throw new LifecycleRepositoryError(
          'conflict',
          'The immutable Gate artifact already belongs to a different Answer prompt.',
        )
      }
      return existing
    }
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
            input_digest, passed, result,
            answer_user_prompt, answer_user_prompt_sha256
          )
          SELECT gen_random_uuid(), advanced.clerk_user_id, advanced.id,
            $5::text, $6::char(64), $7::boolean, $8::jsonb,
            $11::text, $12::char(64)
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
        input.answerUserPrompt,
        answerUserPromptSha256,
      ],
    })
    if (!parsedOptionalRun(result)) {
      throw new LifecycleRepositoryError('conflict', 'Gate commit lost its lifecycle revision race.')
    }
    return (await this.getForGame(owner, gameId))!
  }

  async beginCharlotteAttempt(
    input: BeginCharlotteAttemptInput,
  ): Promise<LifecycleAggregate> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const expectedRevision = assertRevision(input.expectedRevision)
    const modelRequestId = assertUuid(input.modelRequestId, 'Model request id')
    assertDigest(input.requestDigest, 'Charlotte request digest')
    assertDigest(input.configurationDigest, 'Configuration digest')

    const result = await this.database.query({
      text: `
        WITH eligible_model AS (
          SELECT id
          FROM model_requests
          WHERE id = $4::uuid
            AND clerk_user_id = $1::text
            AND game_id = $2::uuid
            AND operation = 'charlotte'
            AND status IN ('in_progress', 'succeeded')
            AND request_sha256 = $5::char(64)
            AND prompt_version = $9::text
        ),
        advanced AS (
          UPDATE lifecycle_runs
          SET state = 'charlotte_running',
              revision = revision + 1,
              charlotte_active_model_request_id = $4::uuid,
              updated_at = now()
          WHERE clerk_user_id = $1::text
            AND game_id = $2::uuid
            AND revision = $3::bigint
            AND state = 'charlotte_pending'
            AND charlotte_failed_attempt_count < charlotte_failure_limit
            AND EXISTS (SELECT 1 FROM eligible_model)
          RETURNING ${SELECT_RUN_COLUMNS}
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
            'charlotte', $7::text, 'charlotte_pending', 'charlotte_running',
            jsonb_build_array($2::text), '[]'::jsonb,
            jsonb_build_array('charlotte'), $6::char(64), 'started', $8::smallint
          FROM advanced
          RETURNING lifecycle_run_id
        )
        SELECT ${SELECT_RUN_COLUMNS} FROM advanced
      `,
      values: [
        owner,
        gameId,
        expectedRevision,
        modelRequestId,
        input.requestDigest,
        input.configurationDigest,
        input.activityType,
        CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
        CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
      ],
    })
    if (!parsedOptionalRun(result)) {
      throw new LifecycleRepositoryError(
        'conflict',
        'Charlotte could not bind the matching active provider request.',
      )
    }
    return (await this.getForGame(owner, gameId))!
  }

  async failCharlotteAttempt(
    input: FailCharlotteAttemptInput,
  ): Promise<LifecycleAggregate> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const expectedRevision = assertRevision(input.expectedRevision)
    const modelRequestId = assertUuid(input.modelRequestId, 'Model request id')
    assertDigest(input.requestDigest, 'Charlotte request digest')
    assertDigest(input.configurationDigest, 'Configuration digest')

    const result = await this.database.query({
      text: `
        WITH failed_model AS (
          SELECT id
          FROM model_requests
          WHERE id = $4::uuid
            AND clerk_user_id = $1::text
            AND game_id = $2::uuid
            AND operation = 'charlotte'
            AND status IN ('failed', 'indeterminate')
            AND request_sha256 = $5::char(64)
            AND prompt_version = $9::text
        ),
        advanced AS (
          UPDATE lifecycle_runs
          SET state = CASE
                WHEN charlotte_failed_attempt_count + 1 >= charlotte_failure_limit
                  THEN 'charlotte_unavailable'
                ELSE 'charlotte_pending'
              END,
              revision = revision + 1,
              charlotte_active_model_request_id = NULL,
              charlotte_failed_attempt_count = charlotte_failed_attempt_count + 1,
              updated_at = now()
          WHERE clerk_user_id = $1::text
            AND game_id = $2::uuid
            AND revision = $3::bigint
            AND state = 'charlotte_running'
            AND charlotte_active_model_request_id = $4::uuid
            AND charlotte_failed_attempt_count < charlotte_failure_limit
            AND EXISTS (SELECT 1 FROM failed_model)
          RETURNING ${SELECT_RUN_COLUMNS}
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
            'charlotte',
            CASE WHEN advanced.state = 'charlotte_unavailable'
              THEN 'qualification_attempt_budget_exhausted'
              ELSE $7::text
            END,
            'charlotte_running', advanced.state,
            jsonb_build_array($2::text), '[]'::jsonb,
            jsonb_build_array('charlotte'), $6::char(64),
            CASE WHEN advanced.state = 'charlotte_unavailable'
              THEN 'refused' ELSE 'failed' END,
            $8::smallint
          FROM advanced
          RETURNING lifecycle_run_id
        )
        SELECT ${SELECT_RUN_COLUMNS} FROM advanced
      `,
      values: [
        owner,
        gameId,
        expectedRevision,
        modelRequestId,
        input.requestDigest,
        input.configurationDigest,
        input.activityType,
        CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
        CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
      ],
    })
    if (!parsedOptionalRun(result)) {
      throw new LifecycleRepositoryError(
        'conflict',
        'Charlotte failure no longer matches the active provider attempt.',
      )
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
      revisionNumber(before.revision) !== expectedRevision ||
      before.charlotte_active_model_request_id !== modelRequestId
    ) {
      throw new LifecycleRepositoryError(
        'conflict',
        'Charlotte can commit only from the matching running revision.',
      )
    }
    const result = await this.database.query({
      text: `
        WITH eligible_model AS (
          SELECT id
          FROM model_requests
          WHERE id = $4::uuid
            AND clerk_user_id = $1::text
            AND game_id = $2::uuid
            AND operation = 'charlotte'
            AND status = 'succeeded'
            AND request_sha256 = $5::char(64)
            AND response_sha256 = $6::char(64)
            AND prompt_version = $7::text
            AND result_payload->>'format' = 'webchess-charlotte-result/3'
        ),
        advanced AS (
          UPDATE lifecycle_runs
          SET state = 'charlotte_complete',
              revision = revision + 1,
              charlotte_active_model_request_id = NULL,
              updated_at = now()
          WHERE clerk_user_id = $1::text AND game_id = $2::uuid
            AND revision = $3::bigint AND state = 'charlotte_running'
            AND charlotte_active_model_request_id = $4::uuid
            AND EXISTS (SELECT 1 FROM eligible_model)
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
            'charlotte', 'qualification_completed', 'charlotte_running',
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
    if (parent.state === 'insufficient_basis') {
      if (!canReopenInsufficientBasis(parent)) {
        throw new LifecycleRepositoryError(
          'invalid-state',
          'The saved conclusion has no bounded repair path remaining.',
        )
      }
      parent = await this.transition({
        ownerId: owner,
        gameId: parentGameId,
        expectedRevision: parent.revision,
        to: 'retry_ready',
        stage: 'retry',
        activityType: 'bounded_repair_reopened',
        responsibleAgentIds: ['gate', 'retry-policy'],
        configurationDigest: input.configurationDigest,
      })
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
        sameField
          ? parent.sameFieldRetryCount + 1
          : parent.sameFieldRetryCount,
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
        sameField
          ? parent.versions.lifecycle
          : CURRENT_LIFECYCLE_VERSIONS.lifecycle,
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
    const validatedFingerprint = assertDigest(
      fingerprint,
      'Terminal fingerprint',
    )
    const result = await this.database.query<{
      id: string
      terminal_fingerprint: string | null
      survivor_set: unknown[] | null
    }>({
      text: `
        SELECT id::text, terminal_fingerprint, survivor_set
        FROM lifecycle_runs
        WHERE clerk_user_id = $1::text AND root_run_id = $2::uuid
          AND (terminal_fingerprint IS NOT NULL OR survivor_set IS NOT NULL)
      `,
      values: [
        assertOwner(ownerId),
        assertUuid(rootRunId, 'Root run id'),
      ],
    })
    const excludedId = assertUuid(excludingRunId, 'Excluded run id')
    const acceptedFingerprints = new Set([validatedFingerprint])
    const currentRow = result.rows.find((row) => row.id === excludedId)
    if (currentRow?.survivor_set) {
      acceptedFingerprints.add(
        stableTerminalFingerprint(survivorArray(currentRow.survivor_set)),
      )
    }

    return result.rows.some((row) => {
      if (row.id === excludedId) return false
      if (
        row.terminal_fingerprint &&
        acceptedFingerprints.has(row.terminal_fingerprint)
      ) {
        return true
      }
      if (!row.survivor_set) return false
      return acceptedFingerprints.has(
        stableTerminalFingerprint(survivorArray(row.survivor_set)),
      )
    })
  }

  async claimWilburMutation(
    input: ClaimWilburMutationInput,
  ): Promise<ClaimWilburMutationResult> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const actionId = input.actionId === null
      ? null
      : assertUuid(input.actionId, 'Action id')
    const idempotencyKey = assertUuid(
      input.idempotencyKey,
      'Idempotency key',
    )
    const requestDigest = assertDigest(input.requestDigest, 'Request digest')
    const expectedFutureRows = input.operation === 'update_action' ? 1 : 2
    const expectedRateKind = input.operation === 'append_observation'
      ? 'observation'
      : 'action'
    if (
      input.reservedFutureRows !== expectedFutureRows ||
      !Number.isSafeInteger(input.reservedTextBytes) ||
      input.reservedTextBytes < 0 ||
      !Number.isSafeInteger(input.storageRowLimit) ||
      input.storageRowLimit < 1 ||
      !Number.isSafeInteger(input.storageTextBytesLimit) ||
      input.storageTextBytesLimit < 1 ||
      input.rateKind !== expectedRateKind ||
      (input.operation === 'create_action') !== (actionId === null) ||
      (input.operation === 'update_action' && input.reservedTextBytes !== 0) ||
      (input.operation !== 'update_action' && input.reservedTextBytes === 0)
    ) {
      throw new LifecycleRepositoryError(
        'invalid-input',
        'The Wilbur target, rate kind, and storage reservation must match the mutation operation.',
      )
    }

    const result = await this.database.query<{
      operation: string | null
      request_digest: string | null
      target_game_id: string | null
      target_action_id: string | null
      rate_kind: string | null
      status: string | null
      result_entity_id: string | null
      result_revision: bigint | null
      result_status: string | null
      result_follow_up_at: Date | null
      result_updated_at: Date | null
      reserved_future_rows: number | null
      reserved_text_bytes: bigint | null
      claim_code: string
    }>({
      text: `
        WITH lock_gate AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(
            hashtextextended('webchess-wilbur-storage-v1:' || $1::text, 0)
          ) AS held
        ),
        expired AS (
          UPDATE wilbur_mutation_requests AS requests
          SET status = 'denied',
              denial_code = 'WILBUR_MUTATION_EXPIRED',
              retry_at = NULL,
              reserved_future_rows = 0,
              reserved_text_bytes = 0,
              updated_at = now()
          FROM lock_gate
          WHERE requests.clerk_user_id = $1::text
            AND requests.status = 'pending'
            AND requests.updated_at < now() - interval '24 hours'
          RETURNING requests.operation, requests.request_digest,
            requests.target_game_id, requests.target_action_id,
            requests.rate_kind,
            requests.status, requests.result_entity_id,
            requests.result_revision, requests.result_status,
            requests.result_follow_up_at, requests.result_updated_at,
            requests.idempotency_key,
            requests.reserved_future_rows,
            requests.reserved_text_bytes
        ),
        existing AS MATERIALIZED (
          SELECT expired.operation, expired.request_digest,
            expired.target_game_id, expired.target_action_id,
            expired.rate_kind, expired.status,
            expired.result_entity_id, expired.result_revision,
            expired.result_status, expired.result_follow_up_at,
            expired.result_updated_at,
            expired.reserved_future_rows, expired.reserved_text_bytes
          FROM expired
          WHERE expired.idempotency_key = $4::uuid
          UNION ALL
          SELECT requests.operation, requests.request_digest,
            requests.target_game_id, requests.target_action_id,
            requests.rate_kind, requests.status,
            requests.result_entity_id, requests.result_revision,
            requests.result_status, requests.result_follow_up_at,
            requests.result_updated_at,
            requests.reserved_future_rows, requests.reserved_text_bytes
          FROM wilbur_mutation_requests AS requests
          CROSS JOIN lock_gate
          WHERE requests.clerk_user_id = $1::text
            AND requests.idempotency_key = $4::uuid
            AND NOT EXISTS (
              SELECT 1 FROM expired
              WHERE expired.idempotency_key = requests.idempotency_key
            )
        ),
        artifact_storage AS MATERIALIZED (
          SELECT
            coalesce(sum(text_bytes), 0)::bigint AS text_bytes
          FROM (
            SELECT
              (
                octet_length(actions.actor) +
                octet_length(actions.action) +
                octet_length(actions.tested_assumption) +
                octet_length(actions.expected_observation) +
                octet_length(actions.decision_threshold) +
                octet_length(actions.review_horizon)
              )::bigint AS text_bytes
            FROM wilbur_actions AS actions
            CROSS JOIN lock_gate
            WHERE actions.clerk_user_id = $1::text
            UNION ALL
            SELECT
              (
                octet_length(observations.observation) +
                octet_length(observations.evidence_classification) +
                octet_length(observations.expected_effect) +
                octet_length(observations.unexpected_effect) +
                octet_length(observations.stakeholder_response) +
                octet_length(observations.assumption_result) +
                octet_length(observations.next_decision)
              )::bigint AS text_bytes
            FROM wilbur_observations AS observations
            CROSS JOIN lock_gate
            WHERE observations.clerk_user_id = $1::text
          ) AS artifacts
        ),
        owned_rows AS MATERIALIZED (
          SELECT coalesce(sum(row_count), 0)::bigint AS row_count
          FROM (
            SELECT count(*)::bigint AS row_count
            FROM wilbur_actions AS actions
            CROSS JOIN lock_gate
            WHERE actions.clerk_user_id = $1::text
            UNION ALL
            SELECT count(*)::bigint
            FROM wilbur_observations AS observations
            CROSS JOIN lock_gate
            WHERE observations.clerk_user_id = $1::text
            UNION ALL
            SELECT count(*)::bigint
            FROM wilbur_mutation_requests AS requests
            CROSS JOIN lock_gate
            WHERE requests.clerk_user_id = $1::text
            UNION ALL
            SELECT count(*)::bigint
            FROM lifecycle_events AS events
            CROSS JOIN lock_gate
            WHERE events.clerk_user_id = $1::text
              AND events.stage = 'wilbur'
          ) AS owned
        ),
        pending_storage AS MATERIALIZED (
          SELECT
            coalesce(sum(requests.reserved_future_rows), 0)::bigint
              AS future_rows,
            coalesce(sum(requests.reserved_text_bytes), 0)::bigint
              AS text_bytes
          FROM wilbur_mutation_requests AS requests
          CROSS JOIN lock_gate
          WHERE requests.clerk_user_id = $1::text
            AND requests.status = 'pending'
            AND requests.updated_at >= now() - interval '24 hours'
        ),
        capacity AS MATERIALIZED (
          SELECT
            owned_rows.row_count + pending_storage.future_rows
              + CASE
                  WHEN EXISTS (SELECT 1 FROM existing) THEN 0
                  ELSE 1 + $8::smallint
                END AS next_rows,
            artifact_storage.text_bytes + pending_storage.text_bytes
              + CASE
                  WHEN EXISTS (SELECT 1 FROM existing) THEN 0
                  ELSE $9::bigint
                END AS next_text_bytes
          FROM artifact_storage, owned_rows, pending_storage
        ),
        inserted AS (
          INSERT INTO wilbur_mutation_requests (
            clerk_user_id, idempotency_key, operation, request_digest,
            target_game_id, target_action_id, rate_kind, status,
            reserved_future_rows, reserved_text_bytes
          )
          SELECT $1::text, $4::uuid, $5::text, $6::char(64),
            $2::uuid, $3::uuid, $7::text, 'pending',
            $8::smallint, $9::bigint
          FROM capacity
          WHERE NOT EXISTS (SELECT 1 FROM existing)
            AND capacity.next_rows <= $10::bigint
            AND capacity.next_text_bytes <= $11::bigint
          ON CONFLICT (clerk_user_id, idempotency_key) DO NOTHING
          RETURNING operation, request_digest, target_game_id,
            target_action_id, rate_kind, status, result_entity_id,
            result_revision, result_status, result_follow_up_at,
            result_updated_at,
            reserved_future_rows, reserved_text_bytes
        )
        SELECT
          coalesce(existing.operation, inserted.operation) AS operation,
          coalesce(existing.request_digest, inserted.request_digest)
            AS request_digest,
          coalesce(existing.target_game_id, inserted.target_game_id)::text
            AS target_game_id,
          coalesce(existing.target_action_id, inserted.target_action_id)::text
            AS target_action_id,
          coalesce(existing.rate_kind, inserted.rate_kind) AS rate_kind,
          coalesce(existing.status, inserted.status) AS status,
          coalesce(existing.result_entity_id, inserted.result_entity_id)::text
            AS result_entity_id,
          coalesce(existing.result_revision, inserted.result_revision)
            AS result_revision,
          coalesce(existing.result_status, inserted.result_status)
            AS result_status,
          coalesce(
            existing.result_follow_up_at,
            inserted.result_follow_up_at
          ) AS result_follow_up_at,
          coalesce(existing.result_updated_at, inserted.result_updated_at)
            AS result_updated_at,
          coalesce(
            existing.reserved_future_rows,
            inserted.reserved_future_rows
          ) AS reserved_future_rows,
          coalesce(existing.reserved_text_bytes, inserted.reserved_text_bytes)
            AS reserved_text_bytes,
          CASE
            WHEN EXISTS (SELECT 1 FROM existing) THEN 'EXISTING'
            WHEN EXISTS (SELECT 1 FROM inserted) THEN 'CLAIMED'
            WHEN capacity.next_rows > $10::bigint THEN 'ROW_LIMIT'
            ELSE 'TEXT_LIMIT'
          END AS claim_code
        FROM capacity
        LEFT JOIN existing ON true
        LEFT JOIN inserted ON true
      `,
      values: [
        owner,
        gameId,
        actionId,
        idempotencyKey,
        input.operation,
        requestDigest,
        input.rateKind,
        input.reservedFutureRows,
        input.reservedTextBytes,
        input.storageRowLimit,
        input.storageTextBytesLimit,
      ],
    })
    const row = result.rows[0]
    if (!row) {
      throw new LifecycleRepositoryError(
        'integrity-error',
        'Wilbur mutation claim returned no result.',
      )
    }
    if (row.claim_code === 'ROW_LIMIT' || row.claim_code === 'TEXT_LIMIT') {
      throw new LifecycleRepositoryError(
        'storage-limit',
        row.claim_code === 'ROW_LIMIT'
          ? 'The lifetime Wilbur record limit has been reached.'
          : 'The lifetime Wilbur text storage limit has been reached.',
      )
    }
    if (
      row.operation !== input.operation ||
      row.request_digest !== requestDigest ||
      row.target_game_id !== gameId ||
      row.target_action_id !== actionId ||
      row.rate_kind !== input.rateKind ||
      (
        row.status === 'pending' &&
        (
          row.reserved_future_rows !== input.reservedFutureRows ||
          Number(row.reserved_text_bytes) !== input.reservedTextBytes
        )
      ) ||
      (
        row.status !== 'pending' &&
        (
          row.reserved_future_rows !== 0 ||
          Number(row.reserved_text_bytes) !== 0
        )
      )
    ) {
      throw new LifecycleRepositoryError(
        'conflict',
        'That Wilbur idempotency key was used for different mutation data.',
      )
    }
    if (row.status !== 'committed') return { kind: 'pending' }
    if (!row.result_entity_id) {
      throw new LifecycleRepositoryError(
        'integrity-error',
        'A committed Wilbur mutation is missing its durable result identifier.',
      )
    }

    if (input.operation === 'append_observation') {
      const replay = await this.database.query({
        text: `
          SELECT ${SELECT_OBSERVATION_COLUMNS.replaceAll(
            '\n  ',
            '\n  observation.',
          )}
          FROM wilbur_observations AS observation
          JOIN wilbur_actions AS action ON action.id = observation.action_id
          JOIN lifecycle_runs AS run ON run.id = action.lifecycle_run_id
          WHERE observation.clerk_user_id = $1::text
            AND observation.id = $2::uuid
            AND observation.action_id = $3::uuid
            AND run.clerk_user_id = $1::text
            AND run.game_id = $4::uuid
        `,
        values: [owner, row.result_entity_id, actionId, gameId],
      })
      const observation = parseOptionalResultRow(
        replay,
        wilburObservationRowSchema,
      )
      if (!observation) {
        throw new LifecycleRepositoryError(
          'integrity-error',
          'The committed Wilbur observation result is missing.',
        )
      }
      return { kind: 'committed', observation: observationFromRow(observation) }
    }

    const replay = await this.database.query({
      text: `
        SELECT ${SELECT_ACTION_COLUMNS.replaceAll('\n  ', '\n  action.')}
          FROM wilbur_actions AS action
          JOIN lifecycle_runs AS run ON run.id = action.lifecycle_run_id
          WHERE action.clerk_user_id = $1::text
            AND action.id = $2::uuid
            AND run.clerk_user_id = $1::text
            AND run.game_id = $3::uuid
        `,
      values: [owner, row.result_entity_id, gameId],
    })
    const action = parseOptionalResultRow(replay, wilburActionRowSchema)
    if (!action) {
      throw new LifecycleRepositoryError(
        'integrity-error',
        'The committed Wilbur action result is missing.',
      )
    }
    const mapped = actionFromRow(action)
    if (
      row.result_revision === null ||
      row.result_status === null ||
      row.result_updated_at === null ||
      !['planned', 'in_progress', 'completed', 'abandoned', 'inconclusive']
        .includes(row.result_status) ||
      (input.operation === 'update_action' && row.result_entity_id !== actionId)
    ) {
      throw new LifecycleRepositoryError(
        'integrity-error',
        'The committed Wilbur action result is incomplete.',
      )
    }
    return {
      kind: 'committed',
      action: {
        ...mapped,
        status: row.result_status as WilburAction['status'],
        revision: revisionNumber(row.result_revision),
        followUpAt: row.result_follow_up_at?.toISOString() ?? null,
        updatedAt: row.result_updated_at.toISOString(),
      },
    }
  }

  async settleWilburMutationConflict(
    input: SettleWilburMutationConflictInput,
  ): Promise<void> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const actionId = input.actionId === null
      ? null
      : assertUuid(input.actionId, 'Action id')
    const idempotencyKey = assertUuid(input.idempotencyKey, 'Idempotency key')
    const requestDigest = assertDigest(input.requestDigest, 'Request digest')
    const expectedFutureRows = input.operation === 'update_action' ? 1 : 2
    const expectedRateKind = input.operation === 'append_observation'
      ? 'observation'
      : 'action'
    if (
      input.reservedFutureRows !== expectedFutureRows ||
      !Number.isSafeInteger(input.reservedTextBytes) ||
      input.reservedTextBytes < 0 ||
      input.rateKind !== expectedRateKind ||
      (input.operation === 'create_action') !== (actionId === null) ||
      (input.operation === 'update_action' && input.reservedTextBytes !== 0) ||
      (input.operation !== 'update_action' && input.reservedTextBytes === 0)
    ) {
      throw new LifecycleRepositoryError(
        'invalid-input',
        'The Wilbur target, rate kind, and storage reservation must match the mutation operation.',
      )
    }
    await this.database.query({
      text: `
        UPDATE wilbur_mutation_requests
        SET status = 'denied',
            denial_code = 'WILBUR_MUTATION_CONFLICT',
            retry_at = NULL,
            reserved_future_rows = 0,
            reserved_text_bytes = 0,
            updated_at = now()
        WHERE clerk_user_id = $1::text
          AND idempotency_key = $2::uuid
          AND operation = $3::text
          AND request_digest = $4::char(64)
          AND target_game_id = $5::uuid
          AND target_action_id IS NOT DISTINCT FROM $6::uuid
          AND rate_kind = $7::text
          AND reserved_future_rows = $8::smallint
          AND reserved_text_bytes = $9::bigint
          AND status = 'pending'
      `,
      values: [
        owner,
        idempotencyKey,
        input.operation,
        requestDigest,
        gameId,
        actionId,
        input.rateKind,
        input.reservedFutureRows,
        input.reservedTextBytes,
      ],
    })
  }

  async createWilburAction(input: CreateWilburActionInput): Promise<WilburAction> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    assertUuid(input.id, 'Action id')
    assertUuid(input.idempotencyKey, 'Idempotency key')
    assertDigest(input.requestDigest, 'Request digest')
    assertDigest(input.configurationDigest, 'Configuration digest')
    const followUpAt = optionalTimestamp(
      input.followUpAt ?? null,
      'Follow-up time',
    )
    const result = await this.database.query({
      text: `
        WITH mutation AS MATERIALIZED (
          SELECT requests.clerk_user_id, requests.idempotency_key
          FROM wilbur_mutation_requests AS requests
          WHERE requests.clerk_user_id = $1::text
            AND requests.idempotency_key = $5::uuid
            AND requests.operation = 'create_action'
            AND requests.request_digest = $6::char(64)
            AND requests.target_game_id = $2::uuid
            AND requests.target_action_id IS NULL
            AND requests.rate_kind = 'action'
            AND requests.reserved_future_rows = 2
            AND requests.reserved_text_bytes = (
              octet_length($7::text) + octet_length($8::text) +
              octet_length($9::text) + octet_length($10::text) +
              octet_length($11::text) + octet_length($12::text)
            )::bigint
            AND requests.status = 'pending'
            AND requests.rate_admitted_at IS NOT NULL
          FOR UPDATE OF requests
        ),
        eligible_run AS MATERIALIZED (
          SELECT run.id, run.state
          FROM lifecycle_runs AS run
          CROSS JOIN mutation
          WHERE run.clerk_user_id = $1::text
            AND run.game_id = $2::uuid
            AND run.state IN (
              'charlotte_complete', 'wilbur_planning',
              'wilbur_in_progress', 'wilbur_observed'
            )
            AND EXISTS (
              SELECT 1 FROM charlotte_results
              WHERE lifecycle_run_id = run.id
                AND clerk_user_id = run.clerk_user_id
            )
          FOR UPDATE OF run
        ),
        inserted AS (
          INSERT INTO wilbur_actions (
            id, clerk_user_id, lifecycle_run_id, charlotte_action_index,
            charlotte_binding_version, idempotency_key, request_digest,
            actor, action, tested_assumption,
            expected_observation, decision_threshold, review_horizon,
            follow_up_at, status, record_version
          )
          SELECT $3::uuid, $1::text, eligible_run.id, $4::smallint,
            $17::text, $5::uuid,
            $6::char(64), $7::text, $8::text, $9::text, $10::text,
            $11::text, $12::text, $13::timestamptz, 'planned', $14::text
          FROM eligible_run
          ON CONFLICT DO NOTHING
          RETURNING ${SELECT_ACTION_COLUMNS}
        ),
        advanced AS (
          UPDATE lifecycle_runs AS run
          SET state = CASE
                WHEN eligible_run.state = 'charlotte_complete'
                  THEN 'wilbur_planning'
                ELSE eligible_run.state
              END,
              revision = run.revision + 1,
              updated_at = now()
          FROM eligible_run, inserted
          WHERE run.id = eligible_run.id
          RETURNING run.id, eligible_run.state AS state_from,
            run.state AS state_to
        ),
        activity AS (
          INSERT INTO lifecycle_events (
            id, clerk_user_id, lifecycle_run_id, sequence, stage,
            activity_type, state_from, state_to, input_entity_ids,
            output_entity_ids, responsible_agent_ids,
            configuration_digest, status, event_version
          )
          SELECT gen_random_uuid(), $1::text, advanced.id,
            coalesce((
              SELECT max(sequence) + 1
              FROM lifecycle_events
              WHERE lifecycle_run_id = advanced.id
            ), 1),
            'wilbur', 'action_recorded', advanced.state_from,
            advanced.state_to, '[]'::jsonb,
            jsonb_build_array(inserted.id::text),
            jsonb_build_array('wilbur', 'player'),
            $15::char(64), 'completed', $16::smallint
          FROM advanced, inserted
          RETURNING lifecycle_run_id
        ),
        committed AS (
          UPDATE wilbur_mutation_requests AS requests
          SET status = 'committed', result_entity_id = inserted.id,
              result_revision = inserted.revision,
              result_status = inserted.status,
              result_follow_up_at = inserted.follow_up_at,
              result_updated_at = inserted.updated_at,
              reserved_future_rows = 0,
              reserved_text_bytes = 0,
              updated_at = now()
          FROM inserted, activity
          WHERE requests.clerk_user_id = $1::text
            AND requests.idempotency_key = $5::uuid
            AND requests.status = 'pending'
          RETURNING requests.idempotency_key
        )
        SELECT ${SELECT_ACTION_COLUMNS.replaceAll('\n  ', '\n  inserted.')}
        FROM inserted, committed
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
        followUpAt,
        CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
        input.configurationDigest,
        CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
        CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION,
      ],
    })
    const row = parseOptionalResultRow(result, wilburActionRowSchema)
    if (!row) throw new LifecycleRepositoryError(
      'conflict',
      'The Wilbur action could not be atomically bound to this Charlotte suggestion.',
    )
    return actionFromRow(row)
  }

  async updateWilburAction(input: UpdateWilburActionInput): Promise<WilburAction> {
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const actionId = assertUuid(input.actionId, 'Action id')
    const idempotencyKey = assertUuid(input.idempotencyKey, 'Idempotency key')
    const requestDigest = assertDigest(input.requestDigest, 'Request digest')
    assertDigest(input.configurationDigest, 'Configuration digest')
    const followUpAt = optionalTimestamp(
      input.followUpAt ?? null,
      'Follow-up time',
    )
    const result = await this.database.query({
      text: `
        WITH mutation AS MATERIALIZED (
          SELECT requests.clerk_user_id, requests.idempotency_key
          FROM wilbur_mutation_requests AS requests
          WHERE requests.clerk_user_id = $1::text
            AND requests.idempotency_key = $7::uuid
            AND requests.operation = 'update_action'
            AND requests.request_digest = $8::char(64)
            AND requests.target_game_id = $2::uuid
            AND requests.target_action_id = $3::uuid
            AND requests.rate_kind = 'action'
            AND requests.reserved_future_rows = 1
            AND requests.reserved_text_bytes = 0
            AND requests.status = 'pending'
            AND requests.rate_admitted_at IS NOT NULL
          FOR UPDATE OF requests
        ),
        eligible_run AS MATERIALIZED (
          SELECT run.id, run.state
          FROM lifecycle_runs AS run
          CROSS JOIN mutation
          WHERE run.clerk_user_id = $1::text
            AND run.game_id = $2::uuid
            AND run.state IN (
              'charlotte_complete', 'wilbur_planning',
              'wilbur_in_progress', 'wilbur_observed'
            )
          FOR UPDATE OF run
        ),
        changed AS (
          UPDATE wilbur_actions AS action
          SET status = $5::text,
              follow_up_at = $6::timestamptz,
              revision = action.revision + 1,
              updated_at = now()
          FROM eligible_run
          WHERE action.id = $3::uuid
            AND action.clerk_user_id = $1::text
            AND action.lifecycle_run_id = eligible_run.id
            AND action.revision = $4::bigint
          RETURNING ${SELECT_ACTION_COLUMNS.replaceAll('\n  ', '\n  action.')}
        ),
        advanced AS (
          UPDATE lifecycle_runs AS run
          SET state = CASE
                WHEN $5::text = 'in_progress' THEN 'wilbur_in_progress'
                WHEN eligible_run.state = 'charlotte_complete'
                  THEN 'wilbur_planning'
                ELSE eligible_run.state
              END,
              revision = run.revision + 1,
              updated_at = now()
          FROM eligible_run, changed
          WHERE run.id = eligible_run.id
          RETURNING run.id, eligible_run.state AS state_from,
            run.state AS state_to
        ),
        activity AS (
          INSERT INTO lifecycle_events (
            id, clerk_user_id, lifecycle_run_id, sequence, stage,
            activity_type, state_from, state_to, input_entity_ids,
            output_entity_ids, responsible_agent_ids,
            configuration_digest, status, event_version
          )
          SELECT gen_random_uuid(), $1::text, advanced.id,
            coalesce((
              SELECT max(sequence) + 1
              FROM lifecycle_events
              WHERE lifecycle_run_id = advanced.id
            ), 1),
            'wilbur', 'action_status_updated', advanced.state_from,
            advanced.state_to, jsonb_build_array(changed.id::text),
            jsonb_build_array(changed.id::text),
            jsonb_build_array('wilbur', changed.actor),
            $9::char(64), 'completed', $10::smallint
          FROM advanced, changed
          RETURNING lifecycle_run_id
        ),
        committed AS (
          UPDATE wilbur_mutation_requests AS requests
          SET status = 'committed', result_entity_id = changed.id,
              result_revision = changed.revision,
              result_status = changed.status,
              result_follow_up_at = changed.follow_up_at,
              result_updated_at = changed.updated_at,
              reserved_future_rows = 0,
              reserved_text_bytes = 0,
              updated_at = now()
          FROM changed, activity
          WHERE requests.clerk_user_id = $1::text
            AND requests.idempotency_key = $7::uuid
            AND requests.status = 'pending'
          RETURNING requests.idempotency_key
        )
        SELECT ${SELECT_ACTION_COLUMNS.replaceAll('\n  ', '\n  changed.')}
        FROM changed, committed
      `,
      values: [
        owner,
        gameId,
        actionId,
        assertRevision(input.expectedRevision),
        input.status,
        followUpAt,
        idempotencyKey,
        requestDigest,
        input.configurationDigest,
        CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
      ],
    })
    const row = parseOptionalResultRow(result, wilburActionRowSchema)
    if (!row) throw new LifecycleRepositoryError('conflict', 'The Wilbur action revision changed.')
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
        WITH mutation AS MATERIALIZED (
          SELECT requests.clerk_user_id, requests.idempotency_key
          FROM wilbur_mutation_requests AS requests
          WHERE requests.clerk_user_id = $1::text
            AND requests.idempotency_key = $5::uuid
            AND requests.operation = 'append_observation'
            AND requests.request_digest = $6::char(64)
            AND requests.target_game_id = $2::uuid
            AND requests.target_action_id = $3::uuid
            AND requests.rate_kind = 'observation'
            AND requests.reserved_future_rows = 2
            AND requests.reserved_text_bytes = (
              octet_length($8::text) + octet_length($9::text) +
              octet_length($10::text) + octet_length($11::text) +
              octet_length($12::text) + octet_length($13::text) +
              octet_length($14::text)
            )::bigint
            AND requests.status = 'pending'
            AND requests.rate_admitted_at IS NOT NULL
          FOR UPDATE OF requests
        ),
        eligible_run AS MATERIALIZED (
          SELECT run.id, run.state
          FROM lifecycle_runs AS run
          JOIN wilbur_actions AS action ON action.lifecycle_run_id = run.id
          CROSS JOIN mutation
          WHERE run.clerk_user_id = $1::text
            AND run.game_id = $2::uuid
            AND action.id = $3::uuid
            AND action.clerk_user_id = $1::text
            AND run.state IN (
              'charlotte_complete', 'wilbur_planning',
              'wilbur_in_progress', 'wilbur_observed'
            )
          FOR UPDATE OF run
        ),
        inserted AS (
          INSERT INTO wilbur_observations (
            id, clerk_user_id, action_id, idempotency_key, request_digest,
            observed_at, observation, evidence_classification, expected_effect,
            unexpected_effect, stakeholder_response, assumption_result,
            next_decision, record_version
          )
          SELECT $4::uuid, $1::text, $3::uuid, $5::uuid, $6::char(64),
            $7::timestamptz, $8::text, $9::text, $10::text, $11::text,
            $12::text, $13::text, $14::text, $15::text
          FROM eligible_run
          ON CONFLICT DO NOTHING
          RETURNING ${SELECT_OBSERVATION_COLUMNS}
        ),
        advanced AS (
          UPDATE lifecycle_runs AS run
          SET state = 'wilbur_observed',
              revision = run.revision + 1,
              updated_at = now()
          FROM eligible_run, inserted
          WHERE run.id = eligible_run.id
          RETURNING run.id, eligible_run.state AS state_from,
            run.state AS state_to
        ),
        activity AS (
          INSERT INTO lifecycle_events (
            id, clerk_user_id, lifecycle_run_id, sequence, stage,
            activity_type, state_from, state_to, input_entity_ids,
            output_entity_ids, responsible_agent_ids,
            configuration_digest, status, event_version
          )
          SELECT gen_random_uuid(), $1::text, advanced.id,
            coalesce((
              SELECT max(sequence) + 1
              FROM lifecycle_events
              WHERE lifecycle_run_id = advanced.id
            ), 1),
            'wilbur', 'observation_recorded', advanced.state_from,
            advanced.state_to, jsonb_build_array($3::text),
            jsonb_build_array(inserted.id::text),
            jsonb_build_array('wilbur'),
            $16::char(64), 'completed', $17::smallint
          FROM advanced, inserted
          RETURNING lifecycle_run_id
        ),
        committed AS (
          UPDATE wilbur_mutation_requests AS requests
          SET status = 'committed', result_entity_id = inserted.id,
              result_revision = NULL, result_status = NULL,
              result_updated_at = NULL,
              reserved_future_rows = 0,
              reserved_text_bytes = 0,
              updated_at = now()
          FROM inserted, activity
          WHERE requests.clerk_user_id = $1::text
            AND requests.idempotency_key = $5::uuid
            AND requests.status = 'pending'
          RETURNING requests.idempotency_key
        )
        SELECT ${SELECT_OBSERVATION_COLUMNS.replaceAll('\n  ', '\n  inserted.')}
        FROM inserted, committed
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
        input.configurationDigest,
        CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
      ],
    })
    const row = parseOptionalResultRow(result, wilburObservationRowSchema)
    if (!row) throw new LifecycleRepositoryError(
      'conflict',
      'The Wilbur observation could not be atomically recorded.',
    )
    return observationFromRow(row)
  }
}
