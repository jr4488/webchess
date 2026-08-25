import 'server-only'

import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from 'openai'
import { z } from 'zod'

import {
  composeProblemParts,
  DIVISION_CAST_BINDING_VERSION,
} from '../../lib/division'
import { GameRuleError } from '../../lib/game-replay'
import {
  CURRENT_LIFECYCLE_VERSIONS,
  CURRENT_METHOD_VERSION_TUPLE,
  CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION,
  WEBCHESS_SOFTWARE_VERSION,
  canReopenInsufficientBasis,
  charlotteResultSchema,
  decideRetry,
  deriveSurvivorCandidates,
  evaluateGate,
  hasCurrentLifecycleBaseVersions,
  hasCurrentLifecycleExecutionVersions,
  portiaReviewSchema,
  terminalFingerprint,
  type GateResult,
  type PortiaReview,
  validatePortiaCandidateAssessment,
  validatePortiaReview,
} from '../../lib/lifecycle'
import { deriveTrajectoryDirectionalRecord } from '../../lib/lifecycle/trajectory-direction'
import type { TrajectoryDirectionalRecord } from '../../lib/lifecycle/trajectory-direction'
import type { DurableGame } from '../../lib/webchess-api'
import { MAX_PERSISTED_MODEL_PROMPT_CHARS } from '../../types'
import type { WebChessCaseProfile } from '../../lib/case-bundle-contract'
import {
  hashCanonicalJson,
  hmacSha256Hex,
  sha256Hex,
} from '../db'
import type {
  CanonicalJson,
  SqlAdapter,
} from '../db'
import {
  isGameRepositoryError,
  normalizeProblem,
} from '../games'
import type {
  DurableGameRepository,
  DurableGameSnapshot,
  TerminalGameSnapshot,
} from '../games'
import {
  ANSWER_PROMPT_VERSION,
  buildBoardAnswerPromptPackage,
  buildPlayerVisibleAnswerPrompt,
  CastBoundDivisionFacetSchema,
  CAST_DIRECTED_DIVISION_PROMPT_VERSION,
  DIVISION_PROMPT_VERSION,
  generateAnswer,
  generateCharlotteSynthesis,
  generateDivision,
  generatePortiaReview,
  ModelConfigurationError,
  ModelContractError,
  ModelInputError,
  ModelResponseError,
  LEGACY_DIVISION_PROMPT_VERSION,
  normalizeDivisionRepairContext,
  orderPortiaCandidates,
  OPENAI_MODEL,
  OPENAI_PROVIDER,
  parseServerDerivedEvidence,
} from '../openai'
import type {
  AnswerGenerationInput,
  BoardAnswerPromptPackage,
  CharlotteGenerationResult,
  CharlotteInput,
  DivisionFacet,
  DivisionRepairContext,
  ModelGeneration,
  PortiaInput,
  ServerDerivedEvidence,
} from '../openai'
import {
  isLifecycleRepositoryError,
} from '../lifecycle'
import type {
  ResearchConsent,
  ResearchPromptEvidence,
  ResearchRecord,
} from '../../lib/research'
import {
  isResearchRepositoryError,
  type ResearchBrokerPort,
} from '../research'
import type {
  LifecycleAggregate,
  LifecycleRepositoryPort,
} from '../lifecycle'
import {
  OpenClawAnswerContractError,
  OpenClawProviderError,
} from '../openclaw/errors'
import {
  ANSWER_OPERATION_TIMEOUT_MS,
  MODEL_REQUEST_RESPONSE_GRACE_MS,
  MODEL_SETTLEMENT_GRACE_MS,
} from '../model-operation-timeouts'
import {
  caseBundleRows,
  caseBundleStatements,
  createCaseBundle,
  verifyCaseBundle,
} from '../case-bundle'
import type {
  GetModelRequestResultResult,
  ModelOperation,
  ModelResultPayload,
  ModelReservation,
  ProviderCallTransitionFailure,
  ProviderTokenUsage,
  UsageController,
} from '../usage'
import {
  createDataControlServicesWithDependencies,
} from './data-control-service-core'
import {
  ApiError,
  isApiError,
  SafePromptApiError,
  serviceUnavailable,
} from './errors'
import type { WebChessApiServices } from './ports'
import { usageError } from './usage-error'

export { createDataControlServicesWithDependencies }
export {
  normalizeAccountExportMaxBytes,
} from './data-control-service-core'
export type {
  DataControlServiceAdapterDependencies,
  DataControlUsagePort,
} from './data-control-service-core'

const FALLBACK_SOFTWARE_VERSION = `webchess@${WEBCHESS_SOFTWARE_VERSION}`
const CastDirectedDivisionResultPayloadSchema = z.strictObject({
  format: z.literal('webchess-division-result/2'),
  promptVersion: z.literal(CAST_DIRECTED_DIVISION_PROMPT_VERSION),
  castBindingVersion: z.literal(DIVISION_CAST_BINDING_VERSION),
  seed: z.string().trim().min(1).max(512),
  facets: z.array(CastBoundDivisionFacetSchema).length(64),
  model: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(200_000),
})

const StoredAnswerSchema = z.strictObject({
  answer: z.string().trim().min(1).max(200_000),
  model: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(MAX_PERSISTED_MODEL_PROMPT_CHARS),
})

const LegacyAnswerResultPayloadSchema = z.strictObject({
  format: z.literal('webchess-answer-result/1'),
  answer: StoredAnswerSchema,
})

const ApprovedAnswerResultPayloadSchema = z.strictObject({
  format: z.literal('webchess-answer-result/2'),
  answer: StoredAnswerSchema,
  approval: z.strictObject({
    lifecycleRunId: z.string().uuid(),
    reviewedPromptDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    gateInputDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    trajectoryDirectionalRecordVersion: z.string().trim().min(3).max(80).optional(),
    trajectoryDirectionalRecordDigest: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
  }),
})

const AnswerResultPayloadSchema = z.discriminatedUnion('format', [
  LegacyAnswerResultPayloadSchema,
  ApprovedAnswerResultPayloadSchema,
])

const PortiaResultPayloadSchema = z.strictObject({
  format: z.literal('webchess-portia-result/1'),
  review: portiaReviewSchema,
})

const LegacyCharlotteResultPayloadSchema = z.strictObject({
  format: z.literal('webchess-charlotte-result/1'),
  structured: charlotteResultSchema,
  renderedAnswer: z.string().min(100).max(20_000),
  wordCount: z.number().int().min(450).max(750),
})

const LegacyApprovedCharlotteResultPayloadSchema = z.strictObject({
  format: z.literal('webchess-charlotte-result/2'),
  structured: charlotteResultSchema,
  renderedAnswer: z.string().min(100).max(20_000),
  wordCount: z.number().int().min(450).max(750),
  source: z.strictObject({
    lifecycleRunId: z.string().uuid(),
    boardAnswerDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    reviewedPromptDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    gateInputDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  }),
})

const ApprovedCharlotteResultPayloadSchema = z.strictObject({
  format: z.literal('webchess-charlotte-result/3'),
  structured: charlotteResultSchema,
  renderedAnswer: z.string().min(100).max(20_000),
  wordCount: z.number().int().nonnegative(),
  source: z.strictObject({
    lifecycleRunId: z.string().uuid(),
    boardAnswerDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    reviewedPromptDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    gateInputDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    trajectoryDirectionalRecordVersion:
      z.string().trim().min(3).max(80).optional(),
    trajectoryDirectionalRecordDigest:
      z.string().regex(/^[0-9a-f]{64}$/u).optional(),
  }),
})

const CharlotteResultPayloadSchema = z.discriminatedUnion('format', [
  LegacyCharlotteResultPayloadSchema,
  LegacyApprovedCharlotteResultPayloadSchema,
  ApprovedCharlotteResultPayloadSchema,
])

type LegacyDivisionResultPayload = {
  readonly format: 'webchess-division-result/1'
  readonly seed: string
  readonly facets: DivisionFacet[]
  readonly model: string
  readonly prompt: string
}
type DivisionResultPayload =
  | LegacyDivisionResultPayload
  | z.infer<typeof CastDirectedDivisionResultPayloadSchema>
type CastDirectedDivisionResultPayload = z.infer<
  typeof CastDirectedDivisionResultPayloadSchema
>
type AnswerResultPayload = z.infer<typeof AnswerResultPayloadSchema>
type ApprovedAnswerResultPayload = z.infer<typeof ApprovedAnswerResultPayloadSchema>
type PortiaResultPayload = z.infer<typeof PortiaResultPayloadSchema>
type CharlotteResultPayload = z.infer<typeof CharlotteResultPayloadSchema>
type ApprovedCharlotteResultPayload = z.infer<typeof ApprovedCharlotteResultPayloadSchema>

type GameRepositoryPort = Pick<
  DurableGameRepository,
  | 'abandonGame'
  | 'appendMove'
  | 'beginAnswer'
  | 'failAnswer'
  | 'failDivision'
  | 'finishDivision'
  | 'getCurrentGame'
  | 'getOrCreateDivision'
  | 'getOwnedGame'
  | 'getTerminalReplay'
  | 'startGame'
  | 'storeAnswer'
>

export interface ApiServiceAdapterDependencies {
  readonly accountExportMaxBytes: number
  readonly answerGenerator: typeof generateAnswer
  readonly database: SqlAdapter
  readonly divisionGenerator: typeof generateDivision
  readonly charlotteGenerator?: typeof generateCharlotteSynthesis
  readonly hmacSecret: string
  readonly modelName?: string
  readonly modelProvider?: string
  readonly repository: GameRepositoryPort
  readonly lifecycleRepository?: LifecycleRepositoryPort
  readonly portiaGenerator?: typeof generatePortiaReview
  /** Local OpenClaw injects the durable Codex Search broker. */
  readonly researchBroker?: ResearchBrokerPort
  readonly softwareVersion: string
  /** Exact reviewed commit when the launcher/deployment can provide it. */
  readonly sourceCommit?: string | null
  /** SHA-256 of the staged runtime payload when independently verified. */
  readonly runtimeArtifactSha256?: string | null
  readonly usage: UsageController
  readonly wilburStorageRowLimit: number
  readonly wilburStorageTextBytesLimit: number
}

interface ProviderFailure {
  readonly ambiguous: boolean
  readonly failureCode: string
  readonly httpStatus?: number
  readonly providerId?: string
  readonly usage?: ProviderTokenUsage
}

function canonicalHash(value: unknown): string {
  return hashCanonicalJson(value as CanonicalJson)
}

function exactTrajectoryDirectionalRecord(
  snapshot: DurableGameSnapshot,
  lifecycle: LifecycleAggregate,
): TrajectoryDirectionalRecord {
  const division = snapshot.division
  const game = snapshot.game
  const record = lifecycle.trajectoryDirectionalRecord
  if (
    !record ||
    lifecycle.trajectoryDirectionalRecordStatus !== 'bound' ||
    lifecycle.versions.trajectoryDirectionalRecord !== record.version ||
    !division ||
    !game?.outcome
  ) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'The current terminal lifecycle is missing its exact trajectory directional record.',
    )
  }

  let expected: TrajectoryDirectionalRecord
  try {
    expected = deriveTrajectoryDirectionalRecord({
      divisionDigest: division.digest,
      divisionSeed: lifecycle.divisionSeed,
      castSeed: lifecycle.castSeed,
      trajectorySeed: lifecycle.trajectorySeed,
      versions: game.versions,
      parts: division.parts,
      events: game.events,
    })
  } catch (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'The terminal game could not reproduce its trajectory directional record.',
      { cause: error },
    )
  }
  if (
    expected.digest !== record.digest ||
    canonicalHash(expected) !== canonicalHash(record)
  ) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'The saved trajectory directional record does not match this exact game replay.',
    )
  }
  return record
}

function requireCurrentLifecycleExecution(
  snapshot: DurableGameSnapshot,
  lifecycle: LifecycleAggregate | null | undefined,
): {
  readonly lifecycle: LifecycleAggregate
  readonly trajectoryDirectionalRecord: TrajectoryDirectionalRecord
} {
  if (
    !lifecycle ||
    !hasCurrentLifecycleExecutionVersions(lifecycle.versions) ||
    snapshot.division?.promptVersion !==
      CURRENT_METHOD_VERSION_TUPLE.divisionPrompt
  ) {
    throw new ApiError(
      'CONFLICT',
      409,
      'This preserved historical lifecycle is read-only. Start a new game to run the current Arachne lifecycle.',
    )
  }
  return {
    lifecycle,
    trajectoryDirectionalRecord: exactTrajectoryDirectionalRecord(
      snapshot,
      lifecycle,
    ),
  }
}

function requireCurrentLifecycleBase(
  snapshot: DurableGameSnapshot,
  lifecycle: LifecycleAggregate | null | undefined,
): LifecycleAggregate {
  const legitimatePreBind = Boolean(
    lifecycle &&
    lifecycle.versions.trajectoryDirectionalRecord === null &&
    lifecycle.trajectoryDirectionalRecord === null &&
    lifecycle.trajectoryDirectionalRecordStatus === 'not_terminal' &&
    lifecycle.terminalFingerprint === null &&
    (lifecycle.state === 'chess_ready' || lifecycle.state === 'chess_playing'),
  )
  if (
    !lifecycle ||
    !hasCurrentLifecycleBaseVersions(lifecycle.versions) ||
    snapshot.division?.promptVersion !==
      CURRENT_METHOD_VERSION_TUPLE.divisionPrompt ||
    (
      lifecycle.versions.trajectoryDirectionalRecord !==
        CURRENT_LIFECYCLE_VERSIONS.trajectoryDirectionalRecord &&
      !legitimatePreBind
    )
  ) {
    throw new ApiError(
      'CONFLICT',
      409,
      'This preserved historical lifecycle is read-only. Start a new game to run the current Arachne lifecycle.',
    )
  }
  return lifecycle
}

const FINALIZED_PORTIA_PROGRESS_STATES = new Set<
  LifecycleAggregate['state']
>([
  'portia_complete',
  'gate_passed',
  'gate_failed',
  'retry_ready',
  'retry_running',
  'charlotte_pending',
  'charlotte_running',
  'charlotte_unavailable',
  'charlotte_complete',
  'wilbur_planning',
  'wilbur_in_progress',
  'wilbur_observed',
  'insufficient_basis',
])

function requireCurrentPortiaProgress(
  lifecycle: LifecycleAggregate,
  directionalRecord?: TrajectoryDirectionalRecord,
): void {
  const progress = lifecycle.portiaProgress
  try {
    if (!directionalRecord) {
      if (
        progress.currentCandidateId !== null ||
        progress.completedCandidateIds.length > 0 ||
        progress.completedAssessments.length > 0
      ) {
        throw new Error(
          'Portia progress cannot predate the bound trajectory directional record.',
        )
      }
      return
    }

    const ordered = orderPortiaCandidates(lifecycle.survivors)
    const immutableReview = lifecycle.portia
    const finalized =
      FINALIZED_PORTIA_PROGRESS_STATES.has(lifecycle.state) ||
      (lifecycle.state === 'abandoned' && immutableReview !== null)
    if (finalized && immutableReview === null) {
      throw new Error(
        'Finalized Portia progress requires its immutable review.',
      )
    }
    if (!finalized && immutableReview !== null) {
      throw new Error(
        'Draft Portia progress cannot contain an immutable review.',
      )
    }
    if (
      new Set(ordered.map((survivor) => survivor.candidateId)).size !==
        ordered.length
    ) {
      throw new Error('Portia survivor candidate IDs must be unique.')
    }
    if (
      new Set(progress.completedCandidateIds).size !==
        progress.completedCandidateIds.length ||
      progress.completedAssessments.length !==
        progress.completedCandidateIds.length ||
      progress.completedAssessments.length > ordered.length
    ) {
      throw new Error(
        'Portia completed progress must be a unique bounded traversal prefix.',
      )
    }
    for (const [index, assessment] of
      progress.completedAssessments.entries()) {
      const survivor = ordered[index]
      if (
        !survivor ||
        progress.completedCandidateIds[index] !== survivor.candidateId ||
        assessment.candidateId !== survivor.candidateId
      ) {
        throw new Error(
          'Portia completed progress must match the canonical survivor traversal prefix.',
        )
      }
      if (
        assessment.redundancyClusterId !== null &&
        !finalized
      ) {
        throw new Error(
          'Portia draft progress cannot pre-assign a redundancy cluster.',
        )
      }
      validatePortiaCandidateAssessment(
        assessment,
        survivor,
        directionalRecord,
      )
    }
    if (finalized) {
      if (
        lifecycle.answerPromptDigest === null ||
        progress.currentCandidateId !== null ||
        progress.completedAssessments.length !== ordered.length
      ) {
        throw new Error(
          'Finalized Portia progress must retain its reviewed prompt and a complete traversal with no active candidate.',
        )
      }
      if (
        canonicalHash(progress.completedAssessments) !==
          canonicalHash(immutableReview!.assessments)
      ) {
        throw new Error(
          'Finalized Portia progress must exactly mirror its immutable review.',
        )
      }
      validatePortiaReview(
        immutableReview,
        lifecycle.survivors,
        lifecycle.answerPromptDigest,
        directionalRecord,
      )
      return
    }
    const nextCandidateId =
      ordered[progress.completedAssessments.length]?.candidateId ?? null
    if (
      progress.currentCandidateId !== null &&
      progress.currentCandidateId !== nextCandidateId
    ) {
      throw new Error(
        'Portia current progress must identify the next canonical survivor.',
      )
    }
  } catch (error) {
    throw new ApiError(
      'CONFLICT',
      409,
      'This lifecycle contains invalid current Portia progress and is read-only.',
      { cause: error },
    )
  }
}

function requireCurrentReviewedGate(
  snapshot: TerminalGameSnapshot,
  lifecycle: LifecycleAggregate | null | undefined,
): {
  readonly lifecycle: LifecycleAggregate
  readonly trajectoryDirectionalRecord: TrajectoryDirectionalRecord
  readonly answerPrompt: ReturnType<typeof boardAnswerPromptPlan>
  readonly portia: PortiaReview
  readonly gate: GateResult
} {
  const current = requireCurrentLifecycleExecution(snapshot, lifecycle)
  const portia = current.lifecycle.portia
  const gate = current.lifecycle.gate
  const answerPrompt = boardAnswerPromptPlan(snapshot, current.lifecycle)
  if (
    !portia ||
    portia.contractVersion !== CURRENT_LIFECYCLE_VERSIONS.portiaContract ||
    !gate ||
    gate.algorithmVersion !== CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm ||
    answerPrompt.plan.promptVersion !== ANSWER_PROMPT_VERSION ||
    current.lifecycle.answerPromptDigest !== answerPrompt.digest ||
    portia.reviewedAnswerPromptDigest !== answerPrompt.digest
  ) {
    throw new ApiError(
      'CONFLICT',
      409,
      'This lifecycle does not contain the exact current Portia review, Answer prompt, and Gate decision.',
    )
  }

  let validatedPortia: PortiaReview
  try {
    validatedPortia = validatePortiaReview(
      portia,
      current.lifecycle.survivors,
      answerPrompt.digest,
      current.trajectoryDirectionalRecord,
    )
  } catch (error) {
    throw new ApiError(
      'CONFLICT',
      409,
      'This lifecycle does not contain a valid current Portia review.',
      { cause: error },
    )
  }
  const expectedGate = evaluateGate(validatedPortia, {
    sameFieldRetryCount: current.lifecycle.sameFieldRetryCount,
    fieldRegenerationCount: current.lifecycle.fieldRegenerationCount,
  }, current.trajectoryDirectionalRecord)
  if (canonicalHash(expectedGate) !== canonicalHash(gate)) {
    throw new ApiError(
      'CONFLICT',
      409,
      'This lifecycle does not contain the exact current deterministic Gate decision.',
    )
  }

  if (gate.passed) {
    const expectedUserPrompt = buildPlayerVisibleAnswerPrompt({
      plan: answerPrompt.plan,
      reviewedPromptDigest: answerPrompt.digest,
      portia: validatedPortia,
      gate,
    })
    if (
      current.lifecycle.answerUserPrompt !== expectedUserPrompt ||
      current.lifecycle.answerUserPromptSha256 !== sha256Hex(expectedUserPrompt)
    ) {
      throw new ApiError(
        'CONFLICT',
        409,
        'This lifecycle does not contain the exact approved current Answer prompt.',
      )
    }
  }

  return {
    ...current,
    answerPrompt,
    portia: validatedPortia,
    gate,
  }
}

function directionalResultSource(
  record: TrajectoryDirectionalRecord | undefined,
): {
  readonly trajectoryDirectionalRecordVersion: string
  readonly trajectoryDirectionalRecordDigest: string
} | Record<string, never> {
  return record
    ? {
        trajectoryDirectionalRecordVersion: record.version,
        trajectoryDirectionalRecordDigest: record.digest,
      }
    : {}
}

function directionalResultSourceMatches(
  source: {
    readonly trajectoryDirectionalRecordVersion?: string
    readonly trajectoryDirectionalRecordDigest?: string
  },
  lifecycle: LifecycleAggregate,
): boolean {
  const record = lifecycle.trajectoryDirectionalRecord
  return Boolean(
    hasCurrentLifecycleExecutionVersions(lifecycle.versions) &&
    record &&
    lifecycle.trajectoryDirectionalRecordStatus === 'bound' &&
    source.trajectoryDirectionalRecordVersion === record.version &&
    source.trajectoryDirectionalRecordDigest === record.digest
  )
}

function utf8Bytes(values: readonly string[]): number {
  const total = values.reduce(
    (bytes, value) => bytes + Buffer.byteLength(value, 'utf8'),
    0,
  )
  if (!Number.isSafeInteger(total)) {
    throw new ApiError(
      'BAD_REQUEST',
      400,
      'The Wilbur mutation text is too large to measure safely.',
    )
  }
  return total
}

function modelResultPayload<T extends ModelResultPayload>(value: T): T {
  return value
}

export function normalizeSoftwareVersion(value: string | undefined): string {
  const version = value?.trim() || FALLBACK_SOFTWARE_VERSION
  if (version.length > 120) {
    throw serviceUnavailable('The WebChess software version is invalid.')
  }
  return version
}

function publicGame(snapshot: DurableGameSnapshot): DurableGame {
  return {
    id: snapshot.id,
    sourceGameId: snapshot.sourceGameId,
    revision: snapshot.revision,
    status: snapshot.status,
    problem: snapshot.problem,
    researchConsent: snapshot.researchConsent,
    division: snapshot.division
      ? {
          seed: snapshot.division.seed,
          facets: snapshot.division.facets,
          parts: snapshot.division.parts,
          model: snapshot.division.model,
        }
      : null,
    state: snapshot.game,
    answer: snapshot.answer,
  }
}

function repositoryError(error: unknown): ApiError | null {
  if (isResearchRepositoryError(error)) {
    switch (error.code) {
      case 'not-found':
        return new ApiError(
          'LIFECYCLE_NOT_FOUND',
          404,
          'This game does not have the requested research record.',
        )
      case 'invalid-input':
        return new ApiError('BAD_REQUEST', 400, 'The research command is invalid.')
      case 'conflict':
        return new ApiError(
          'CONFLICT',
          409,
          'The lifecycle changed before research could be recorded.',
        )
      case 'integrity-error':
        return new ApiError(
          'INTERNAL_ERROR',
          500,
          'The saved research provenance could not be verified.',
        )
    }
  }
  if (isLifecycleRepositoryError(error)) {
    switch (error.code) {
      case 'not-found':
        return new ApiError(
          'LIFECYCLE_NOT_FOUND',
          404,
          'This game does not have a WebChess 2.2 lifecycle record.',
        )
      case 'invalid-input':
        return new ApiError(
          'BAD_REQUEST',
          400,
          'The lifecycle command is invalid.',
        )
      case 'invalid-state':
      case 'conflict':
        return new ApiError(
          'CONFLICT',
          409,
          'The lifecycle changed or cannot perform that operation.',
        )
      case 'storage-limit':
        return new ApiError(
          'PAYLOAD_TOO_LARGE',
          413,
          `${error.message} No Wilbur records were deleted. You may export the account now; only deleting/resetting the account currently frees this lifetime envelope.`,
        )
      case 'integrity-error':
        return new ApiError(
          'INTERNAL_ERROR',
          500,
          'The saved lifecycle could not be verified.',
        )
    }
  }
  if (isGameRepositoryError(error)) {
    switch (error.code) {
      case 'not-found':
        return new ApiError('GAME_NOT_FOUND', 404, 'Game not found.')
      case 'invalid-input':
        return new ApiError('BAD_REQUEST', 400, 'The game command is invalid.')
      case 'conflict':
      case 'idempotency-conflict':
      case 'invalid-state':
      case 'not-terminal':
        return new ApiError(
          'CONFLICT',
          409,
          'The saved game changed or cannot perform that operation.',
        )
      case 'integrity-error':
        return new ApiError(
          'INTERNAL_ERROR',
          500,
          'The saved game could not be verified.',
        )
    }
  }

  if (error instanceof GameRuleError) {
    if (error.code === 'invalid-replay') {
      return new ApiError(
        'INTERNAL_ERROR',
        500,
        'The saved game could not be verified.',
      )
    }
    if (error.code === 'stale-ply' || error.code === 'game-complete') {
      return new ApiError(
        'CONFLICT',
        409,
        'The game changed before that move was accepted.',
      )
    }
    return new ApiError(
      'ILLEGAL_MOVE',
      422,
      'That move is not legal in the current circular-chess position.',
    )
  }

  return null
}

function modelError(error: unknown): ApiError | null {
  if (error instanceof OpenClawAnswerContractError) {
    return new SafePromptApiError(
      'The model did not return a valid WebChess result after one corrective turn.',
      error.publicPrompt,
    )
  }
  if (error instanceof OpenClawProviderError) {
    return new ApiError(
      error.failureCode === 'provider_timeout'
        ? 'UPSTREAM_TIMEOUT'
        : 'UPSTREAM_FAILURE',
      error.failureCode === 'provider_timeout' ? 504 : 502,
      error.message,
    )
  }
  if (error instanceof ModelConfigurationError) {
    return new ApiError(
      'SERVICE_UNAVAILABLE',
      503,
      'The WebChess model service is not configured.',
    )
  }
  if (error instanceof ModelInputError) {
    return new ApiError('BAD_REQUEST', 400, 'The model input is invalid.')
  }
  if (error instanceof ModelContractError) {
    return new ApiError(
      'UPSTREAM_FAILURE',
      502,
      'The model did not return a valid WebChess result.',
    )
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new ApiError(
      'UPSTREAM_TIMEOUT',
      504,
      'The model did not respond before the request timed out.',
    )
  }
  if (
    error instanceof APIConnectionError ||
    error instanceof APIUserAbortError
  ) {
    return new ApiError(
      'UPSTREAM_FAILURE',
      502,
      'The model connection ended before a result was confirmed.',
    )
  }
  if (error instanceof APIError) {
    return new ApiError(
      error.status === 408 ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_FAILURE',
      error.status === 408 ? 504 : 502,
      error.status === 408
        ? 'The model did not respond before the request timed out.'
        : 'The model could not complete this WebChess operation.',
    )
  }
  return null
}

function translateError(error: unknown): ApiError {
  if (isApiError(error)) return error
  return (
    repositoryError(error) ??
    modelError(error) ??
    new ApiError(
      'INTERNAL_ERROR',
      500,
      'WebChess could not complete this request.',
      { cause: error },
    )
  )
}

async function apiOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw translateError(error)
  }
}

function modelName(dependencies: ApiServiceAdapterDependencies): string {
  return dependencies.modelName?.trim() || OPENAI_MODEL
}

function modelProvider(dependencies: ApiServiceAdapterDependencies): string {
  return dependencies.modelProvider?.trim() || OPENAI_PROVIDER
}

function providerIdempotencyKey(
  secret: string,
  ownerId: string,
  operation: ModelOperation,
  browserIdempotencyKey: string,
): string {
  return hmacSha256Hex(
    secret,
    'webchess-openai-idempotency-v1',
    `${ownerId}\0${operation}\0${browserIdempotencyKey}`,
  )
}

function providerUsage(
  generation: ModelGeneration<unknown>,
): ProviderTokenUsage {
  return normalizedProviderUsage(generation.usage)
}

function normalizedProviderUsage(
  usage: ModelGeneration<unknown>['usage'],
): ProviderTokenUsage {
  return {
    reported: usage.reported,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningOutputTokens,
    totalTokens: usage.totalTokens,
  }
}

function classifyProviderFailure(
  error: unknown,
  signal: AbortSignal,
): ProviderFailure {
  if (
    signal.aborted &&
    signal.reason instanceof AnswerOperationDeadlineError
  ) {
    return {
      ambiguous: true,
      failureCode: 'answer_operation_timeout',
    }
  }
  if (error instanceof OpenClawProviderError) {
    return {
      ambiguous: error.ambiguous,
      failureCode: error.failureCode,
    }
  }
  if (error instanceof ModelResponseError) {
    return {
      ambiguous: false,
      failureCode: `provider_${error.status}`,
      ...(error.providerId === null ? {} : { providerId: error.providerId }),
      usage: normalizedProviderUsage(error.usage),
    }
  }
  if (error instanceof ModelContractError) {
    return {
      ambiguous: false,
      failureCode: 'provider_contract_invalid',
    }
  }
  if (
    error instanceof APIConnectionError ||
    error instanceof APIConnectionTimeoutError ||
    error instanceof APIUserAbortError
  ) {
    return {
      ambiguous: true,
      failureCode: error instanceof APIConnectionTimeoutError
        ? 'provider_timeout'
        : 'provider_connection_lost',
    }
  }
  if (error instanceof APIError) {
    return {
      ambiguous: false,
      failureCode: 'provider_http_error',
      ...(typeof error.status === 'number'
        ? { httpStatus: error.status }
        : {}),
    }
  }
  if (error instanceof ModelConfigurationError) {
    return {
      ambiguous: false,
      failureCode: 'model_configuration_error',
    }
  }
  if (error instanceof ModelInputError) {
    return {
      ambiguous: false,
      failureCode: 'model_input_error',
    }
  }
  if (signal.aborted) {
    return {
      ambiguous: true,
      failureCode: 'request_aborted',
    }
  }
  return {
    ambiguous: true,
    failureCode: 'provider_outcome_unknown',
  }
}

function requireLease(reservation: ModelReservation): string {
  if (reservation.kind !== 'reserved' || !reservation.leaseToken) {
    throw new ApiError(
      'CONFLICT',
      409,
      'The model operation is already being processed.',
      { retryAfterSeconds: 2 },
    )
  }
  return reservation.leaseToken
}

/**
 * A settled provider attempt is durable server work. Browser navigation may
 * abandon the HTTP response, but it must not cancel the fenced model request
 * and strand the lifecycle until its lease expires. Provider adapters retain
 * their own bounded timeouts.
 */
function durableProviderSignal(): AbortSignal {
  return new AbortController().signal
}

class AnswerOperationDeadlineError extends OpenClawProviderError {
  override name = 'AnswerOperationDeadlineError'

  constructor() {
    super(
      'provider_timeout',
      true,
      'The Answer stage exceeded its five-minute limit and was saved as a retryable failure.',
    )
  }
}

function durableAnswerOperationDeadline(operationDeadlineAt: Date): {
  readonly assertBeforeDeadline: () => void
  readonly deadlineAt: number
  readonly dispose: () => void
  readonly expired: Promise<never>
  readonly leaseExpiresAtCap: Date
  readonly operationDeadlineAt: Date
  readonly signal: AbortSignal
} {
  const controller = new AbortController()
  const startedAt = Date.now()
  const deadlineAt = operationDeadlineAt.valueOf()
  if (!Number.isFinite(deadlineAt)) {
    throw new TypeError('Answer operationDeadlineAt must be a valid date.')
  }
  if (deadlineAt > startedAt + ANSWER_OPERATION_TIMEOUT_MS) {
    throw new TypeError(
      'Answer operationDeadlineAt cannot extend beyond the five-minute route window.',
    )
  }
  let timer!: ReturnType<typeof setTimeout>
  let rejectExpired!: (error: AnswerOperationDeadlineError) => void
  let deadlineError: AnswerOperationDeadlineError | null = null
  const expire = (): AnswerOperationDeadlineError => {
    const error = deadlineError ?? new AnswerOperationDeadlineError()
    deadlineError = error
    if (!controller.signal.aborted) controller.abort(error)
    rejectExpired(error)
    return error
  }
  const expired = new Promise<never>((_resolve, reject) => {
    rejectExpired = reject
    timer = setTimeout(() => {
      expire()
    }, Math.max(0, deadlineAt - startedAt))
  })
  // The timer starts at Answer entry, before provider work begins. Keep its
  // rejection observed even when setup returns early or reaches the deadline
  // before the provider race is installed.
  void expired.catch(() => undefined)
  timer.unref?.()
  return {
    assertBeforeDeadline: () => {
      if (!controller.signal.aborted && Date.now() < deadlineAt) return
      const reason = controller.signal.reason
      throw reason instanceof AnswerOperationDeadlineError
        ? reason
        : expire()
    },
    deadlineAt,
    dispose: () => clearTimeout(timer),
    expired,
    leaseExpiresAtCap: new Date(
      deadlineAt +
        MODEL_REQUEST_RESPONSE_GRACE_MS +
        MODEL_SETTLEMENT_GRACE_MS,
    ),
    operationDeadlineAt: new Date(deadlineAt),
    signal: controller.signal,
  }
}

function modelOperationLabel(operation: ModelOperation): string {
  return {
    division: 'division',
    answer: 'answer',
    portia: 'Portia review',
    charlotte: 'Charlotte synthesis',
  }[operation]
}

function beginProviderCallError(
  failure: ProviderCallTransitionFailure,
  operation: ModelOperation,
): ApiError {
  if (
    failure.code === 'ACCOUNT_DELETED' ||
    failure.code === 'ACCOUNT_SUSPENDED' ||
    failure.code === 'ACCOUNT_TEMPORARILY_BLOCKED'
  ) {
    return new ApiError(
      'FORBIDDEN',
      403,
      'This WebChess account cannot perform that operation.',
    )
  }

  return new ApiError(
    'CONFLICT',
    failure.httpStatus === 410 ? 410 : 409,
    `The ${modelOperationLabel(operation)} reservation expired before the model call began.`,
    { retryAfterSeconds: 2 },
  )
}

function answerPayload(value: unknown): AnswerResultPayload {
  const parsed = AnswerResultPayloadSchema.safeParse(value)
  if (!parsed.success) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'The saved answer result could not be verified.',
    )
  }
  return parsed.data
}

function approvedAnswerMatchesLifecycle(
  payload: AnswerResultPayload,
  lifecycle: LifecycleAggregate,
): payload is ApprovedAnswerResultPayload {
  return Boolean(
    payload.format === 'webchess-answer-result/2' &&
    lifecycle.answerPromptDigest &&
    lifecycle.gate &&
    payload.approval.lifecycleRunId === lifecycle.id &&
    payload.approval.reviewedPromptDigest === lifecycle.answerPromptDigest &&
    payload.approval.gateInputDigest === lifecycle.gate.inputDigest &&
    directionalResultSourceMatches(payload.approval, lifecycle),
  )
}

async function requireApprovedAnswerPayload(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  game: Pick<DurableGameSnapshot, 'id' | 'answer'>,
  lifecycle: LifecycleAggregate,
): Promise<ApprovedAnswerResultPayload> {
  const result = await dependencies.usage.getSucceededModelResultForGame({
    userId: ownerId,
    gameId: game.id,
    operation: 'answer',
    promptVersion: ANSWER_PROMPT_VERSION,
  })
  if (!result.found || result.status !== 'succeeded' || !result.resultPayload) {
    throw new ApiError(
      'CONFLICT',
      409,
      'The persisted answer has no verifiable Portia and Gate provenance.',
    )
  }
  const payload = answerPayload(result.resultPayload)
  if (
    !approvedAnswerMatchesLifecycle(payload, lifecycle) ||
    !game.answer ||
    canonicalHash(payload.answer) !== canonicalHash(game.answer)
  ) {
    throw new ApiError(
      'CONFLICT',
      409,
      'The persisted answer is not the exact answer generated from this Portia-approved prompt.',
    )
  }
  return payload
}

function portiaPayload(value: unknown): PortiaResultPayload {
  const parsed = PortiaResultPayloadSchema.safeParse(value)
  if (!parsed.success) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'The saved Portia result could not be verified.',
    )
  }
  return parsed.data
}

function charlottePayload(value: unknown): CharlotteResultPayload {
  const parsed = CharlotteResultPayloadSchema.safeParse(value)
  if (!parsed.success) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'The saved Charlotte result could not be verified.',
    )
  }
  return parsed.data
}

function approvedCharlotteMatchesSource(
  payload: CharlotteResultPayload,
  lifecycle: LifecycleAggregate,
  game: Pick<TerminalGameSnapshot, 'answer'>,
): payload is ApprovedCharlotteResultPayload {
  return Boolean(
    payload.format === 'webchess-charlotte-result/3' &&
    game.answer &&
    lifecycle.answerPromptDigest &&
    lifecycle.gate &&
    payload.source.lifecycleRunId === lifecycle.id &&
    payload.source.boardAnswerDigest === canonicalHash(game.answer) &&
    payload.source.reviewedPromptDigest === lifecycle.answerPromptDigest &&
    payload.source.gateInputDigest === lifecycle.gate.inputDigest &&
    directionalResultSourceMatches(payload.source, lifecycle),
  )
}

async function requireApprovedCharlottePayload(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  game: TerminalGameSnapshot,
  lifecycle: LifecycleAggregate,
): Promise<ApprovedCharlotteResultPayload> {
  const result = await dependencies.usage.getSucceededModelResultForGame({
    userId: ownerId,
    gameId: game.id,
    operation: 'charlotte',
    promptVersion: CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
  })
  if (!result.found || result.status !== 'succeeded' || !result.resultPayload) {
    throw new ApiError(
      'CONFLICT',
      409,
      'The persisted Charlotte review has no verifiable answer provenance.',
    )
  }
  const payload = charlottePayload(result.resultPayload)
  if (!approvedCharlotteMatchesSource(payload, lifecycle, game)) {
    throw new ApiError(
      'CONFLICT',
      409,
      'The persisted Charlotte review does not match this exact board answer.',
    )
  }
  return payload
}

function serverEvidence(snapshot: TerminalGameSnapshot): ServerDerivedEvidence {
  return parseServerDerivedEvidence({
    problem: snapshot.problem,
    turnCount: snapshot.game.completedPlies,
    outcome: {
      winner: snapshot.game.outcome.winner,
      reason: snapshot.game.outcome.reason,
      completedTurn: snapshot.game.outcome.completedTurn,
    },
    captures: snapshot.game.captures.map((capture) => ({
      turn: capture.turn,
      resonance: capture.resonance,
      cell: {
        ring: capture.cell.ring,
        sector: capture.cell.sector,
      },
      attacker: {
        side: capture.attacker.side,
        kind: capture.attacker.kind,
      },
      captured: {
        side: capture.captured.side,
        kind: capture.captured.kind,
      },
      part: {
        id: capture.part.id,
        title: capture.part.title,
        focus: capture.part.focus,
        hexagram: capture.part.hexagram,
        hexagramName: capture.part.hexagramName,
        theme: capture.part.theme,
        dimension: capture.part.dimension,
        movement: capture.part.movement,
        prompt: capture.part.prompt,
        keyword: capture.part.keyword,
      },
    })),
  })
}

function researchPromptEvidence(
  record: ResearchRecord,
): ResearchPromptEvidence | null {
  if (
    record.status === 'not_needed' ||
    record.consent.version !== 'webchess-research-consent-v1' ||
    record.consent.decision !== 'allow_search_and_page_fetch'
  ) return null
  if (record.status === 'searching') {
    throw new ApiError(
      'CONFLICT',
      409,
      'Visible research is still being processed before Portia can review the prompt.',
      { retryAfterSeconds: 2 },
    )
  }
  if (!record.materiality || !record.query) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'The saved research decision is missing its materiality or query.',
    )
  }
  return {
    recordId: record.id,
    stage: record.stage,
    materiality: record.materiality,
    reason: record.reason,
    query: record.query,
    provider: record.provider,
    consent: record.consent,
    status: record.status,
    model: record.model,
    untrusted: true,
    contentKind: 'model_generated_search_synthesis',
    directPageTextFetched: record.directPageTextFetched,
    searchSynthesis: record.searchSynthesis,
    retrievedFacts: record.retrievedFacts,
    fetchFailures: record.fetchFailures,
    sourceLinks: record.sources.map((source) => ({
      citationId: source.citationId,
      title: source.title,
      url: source.url,
      trust: source.trust,
    })),
    injectionSignalsDetected: record.injectionSignalsDetected,
    contentDigest: record.contentDigest,
    failureCode: record.failureCode,
  }
}

function boardAnswerPromptPlan(
  snapshot: TerminalGameSnapshot,
  lifecycle: LifecycleAggregate,
): {
  readonly digest: string
  readonly plan: BoardAnswerPromptPackage
} {
  if (!lifecycle.terminalFingerprint) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'The terminal lifecycle is missing its survivor fingerprint.',
    )
  }
  // Runs completed before the v2 prompt-review migration retain their original
  // terminal fingerprint.  The v2 fingerprint deliberately binds the complete
  // survivor ecology, so derive that prompt-local value from the persisted
  // survivors instead of rewriting historical lifecycle provenance.
  const answerPromptFingerprint = terminalFingerprint(lifecycle.survivors)
  const trajectoryDirectionalRecord = exactTrajectoryDirectionalRecord(
    snapshot,
    lifecycle,
  )
  const plan = buildBoardAnswerPromptPackage(
    serverEvidence(snapshot),
    lifecycle.survivors,
    answerPromptFingerprint,
    lifecycle.research.flatMap((record) => {
      const evidence = researchPromptEvidence(record)
      return evidence ? [evidence] : []
    }),
    lifecycle.webMemoryEvidence,
    trajectoryDirectionalRecord,
  )
  return {
    plan,
    digest: canonicalHash(plan),
  }
}

function lifecycleConfigurationDigest(snapshot: DurableGameSnapshot): string {
  return canonicalHash({
    lifecycle: CURRENT_LIFECYCLE_VERSIONS,
    game: snapshot.game?.versions ?? null,
    divisionDigest: snapshot.division?.digest ?? null,
  })
}

function fieldRepairContext(
  lifecycle: LifecycleAggregate,
  gate: GateResult,
): DivisionRepairContext {
  const gateMissingCoverage = gate.coverageResults
    .filter((coverage) => !coverage.satisfied)
    .map((coverage) => coverage.tag)
  return normalizeDivisionRepairContext({
    priorFieldGeneration: lifecycle.fieldGeneration,
    gateMissingRequirements: gate.missingRequirements,
    missingCoverage: [
      ...(lifecycle.portia?.missingCoverage ?? []),
      ...gateMissingCoverage,
    ],
    fieldRepairReasons:
      lifecycle.portia?.recommendedGateInputs.fieldRepairReasons ?? [],
  })
}

function requireLifecycleRepository(
  dependencies: ApiServiceAdapterDependencies,
): LifecycleRepositoryPort {
  if (!dependencies.lifecycleRepository) {
    throw serviceUnavailable('The WebChess 2.2 lifecycle store is not configured.')
  }
  return dependencies.lifecycleRepository
}

function canonicalCharlotteActionForWilbur(
  lifecycle: LifecycleAggregate,
  input: Parameters<WebChessApiServices['createWilburAction']>[0],
) {
  const suggestion = lifecycle.charlotte?.exactlyThreeNextActions[
    input.charlotteActionIndex
  ]
  if (!suggestion) {
    throw new ApiError(
      'CONFLICT',
      409,
      'Wilbur requires one of the exact actions from the saved Charlotte result.',
    )
  }

  if (
    input.actor !== suggestion.actor ||
    input.action !== suggestion.smallestAction ||
    input.testedAssumption !== suggestion.assumptionBeingTested ||
    input.expectedObservation !== suggestion.expectedObservation ||
    input.decisionThreshold !== suggestion.decisionThreshold ||
    input.reviewHorizon !== suggestion.reviewHorizon
  ) {
    throw new ApiError(
      'CONFLICT',
      409,
      'The Wilbur action must exactly match its saved Charlotte suggestion.',
    )
  }

  return suggestion
}

const WILBUR_EXECUTABLE_STATES = new Set<LifecycleAggregate['state']>([
  'charlotte_complete',
  'wilbur_planning',
  'wilbur_in_progress',
  'wilbur_observed',
])

async function requireCurrentWilburExecution(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  gameId: string,
  lifecycle: LifecycleAggregate | null | undefined,
): Promise<LifecycleAggregate> {
  const terminal = await dependencies.repository.getTerminalReplay(
    ownerId,
    gameId,
  )
  const reviewed = requireCurrentReviewedGate(terminal, lifecycle)
  if (!WILBUR_EXECUTABLE_STATES.has(reviewed.lifecycle.state)) {
    throw new ApiError(
      'CONFLICT',
      409,
      'Wilbur requires the exact completed current Charlotte lifecycle.',
    )
  }
  await requireApprovedAnswerPayload(
    dependencies,
    ownerId,
    terminal,
    reviewed.lifecycle,
  )
  const approvedCharlotte = await requireApprovedCharlottePayload(
    dependencies,
    ownerId,
    terminal,
    reviewed.lifecycle,
  )
  if (
    !reviewed.lifecycle.charlotte ||
    canonicalHash(reviewed.lifecycle.charlotte) !==
      canonicalHash(approvedCharlotte.structured) ||
    reviewed.lifecycle.charlotteRenderedAnswer !==
      approvedCharlotte.renderedAnswer
  ) {
    throw new ApiError(
      'CONFLICT',
      409,
      'Wilbur requires the exact persisted current Charlotte result.',
    )
  }
  return reviewed.lifecycle
}

function requireCurrentWilburAction(
  lifecycle: LifecycleAggregate,
  actionId: string,
) {
  const action = lifecycle.wilburActions.find(
    (candidate) => candidate.id === actionId,
  )
  const suggestion = action?.charlotteActionIndex === null ||
      action?.charlotteActionIndex === undefined
    ? null
    : lifecycle.charlotte?.exactlyThreeNextActions[action.charlotteActionIndex]
  if (
    !action ||
    action.lifecycleRunId !== lifecycle.id ||
    action.version !== CURRENT_LIFECYCLE_VERSIONS.wilburRecord ||
    action.charlotteBindingVersion !==
      CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION ||
    !suggestion ||
    action.actor !== suggestion.actor ||
    action.action !== suggestion.smallestAction ||
    action.testedAssumption !== suggestion.assumptionBeingTested ||
    action.expectedObservation !== suggestion.expectedObservation ||
    action.decisionThreshold !== suggestion.decisionThreshold ||
    action.reviewHorizon !== suggestion.reviewHorizon
  ) {
    throw new ApiError(
      'CONFLICT',
      409,
      'This preserved Wilbur action is not bound to the exact current Charlotte result.',
    )
  }
  return action
}

async function ensureLifecycleForNewGame(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  snapshot: DurableGameSnapshot,
): Promise<LifecycleAggregate> {
  const repository = requireLifecycleRepository(dependencies)
  const validate = (candidate: LifecycleAggregate) => {
    const current = requireCurrentLifecycleBase(snapshot, candidate)
    const expectedCastSeed = canonicalHash({
      purpose: 'webchess-cast-seed/v2',
      divisionDigest: snapshot.division?.digest,
      gameId: snapshot.id,
    })
    if (
      current.gameId !== snapshot.id ||
      current.rootRunId !== current.id ||
      current.parentRunId !== null ||
      current.divisionSeed !== snapshot.division?.seed ||
      current.castSeed !== expectedCastSeed ||
      current.trajectorySeed !== snapshot.id
    ) {
      throw new ApiError(
        'CONFLICT',
        409,
        'The saved game has an unrelated lifecycle and is read-only.',
      )
    }
    return current
  }
  const existing = await repository.getForGame(ownerId, snapshot.id)
  if (existing) {
    return validate(existing)
  }
  return validate(await repository.ensureForGame({
    ownerId,
    game: snapshot,
    trajectorySeed: snapshot.id,
  }))
}

function requireExactRetryChildLifecycle(
  parent: LifecycleAggregate,
  child: DurableGameSnapshot,
  existing: LifecycleAggregate,
  mode: 'replay_game' | 'regenerate_field',
  reason: string,
): LifecycleAggregate {
  const current = requireCurrentLifecycleBase(child, existing)
  const division = child.division
  if (!division) {
    throw new ApiError(
      'CONFLICT',
      409,
      'The Retry child has no exact current Division binding.',
    )
  }
  const sameField = mode === 'replay_game'
  const expectedCastSeed = canonicalHash({
    purpose: 'webchess-cast-seed/v2',
    divisionDigest: division.digest,
    gameId: child.id,
  })
  if (
    current.id === parent.id ||
    current.gameId !== child.id ||
    current.rootRunId !== parent.rootRunId ||
    current.parentRunId !== parent.id ||
    current.fieldGeneration !==
      (sameField ? parent.fieldGeneration : parent.fieldGeneration + 1) ||
    current.gameAttempt !== (sameField ? parent.gameAttempt + 1 : 1) ||
    current.sameFieldRetryCount !==
      (sameField
        ? parent.sameFieldRetryCount + 1
        : parent.sameFieldRetryCount) ||
    current.fieldRegenerationCount !==
      (sameField
        ? parent.fieldRegenerationCount
        : parent.fieldRegenerationCount + 1) ||
    current.divisionSeed !== division.seed ||
    current.castSeed !== expectedCastSeed ||
    current.trajectorySeed !== child.id ||
    current.retryReason !== reason
  ) {
    throw new ApiError(
      'CONFLICT',
      409,
      'The Retry child already has unrelated lifecycle state.',
    )
  }
  return current
}

function requireExactSameFieldReplay(
  source: TerminalGameSnapshot,
  child: DurableGameSnapshot,
): void {
  if (
    child.sourceGameId !== source.id ||
    child.problem !== source.problem ||
    child.status !== 'mapped' ||
    !child.division ||
    !child.game ||
    child.game.completedPlies !== 0 ||
    child.game.outcome !== null ||
    canonicalHash(child.division) !== canonicalHash(source.division)
  ) {
    throw new ApiError(
      'CONFLICT',
      409,
      'The replay target is not an exact current same-field child.',
    )
  }
}

async function synchronizeLifecycleWithGame(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  snapshot: DurableGameSnapshot,
): Promise<LifecycleAggregate> {
  const repository = requireLifecycleRepository(dependencies)
  let lifecycle = await repository.getForGame(
    ownerId,
    snapshot.id,
  )
  if (!lifecycle) {
    throw new ApiError(
      'LIFECYCLE_NOT_FOUND',
      404,
      'This legacy game remains readable but has no fabricated WebChess 2.2 lifecycle.',
    )
  }
  const digest = lifecycleConfigurationDigest(snapshot)

  if (
    (snapshot.status === 'playing' || snapshot.game?.outcome != null) &&
    lifecycle.state === 'chess_ready'
  ) {
    lifecycle = await repository.transition({
      ownerId,
      gameId: snapshot.id,
      expectedRevision: lifecycle.revision,
      to: 'chess_playing',
      stage: 'chess',
      activityType: 'game_started',
      inputEntityIds: [snapshot.id],
      outputEntityIds: [snapshot.id],
      responsibleAgentIds: ['player', 'webchess-engine'],
      configurationDigest: digest,
    })
  }

  if (
    snapshot.division &&
    snapshot.game?.outcome &&
    lifecycle.state === 'chess_playing'
  ) {
    const survivors = deriveSurvivorCandidates(
      snapshot.game,
      snapshot.division.parts,
      {
        gameId: snapshot.id,
        attemptId: lifecycle.id,
        divisionDigest: snapshot.division.digest,
        rulesVersion: snapshot.game.versions.rules,
        engineVersion: snapshot.game.versions.engine,
        castVersion: snapshot.game.versions.cast,
        eventVersion: snapshot.game.versions.event,
      },
    )
    const fingerprint = terminalFingerprint(survivors)
    const trajectoryDirectionalRecord =
      lifecycle.versions.lifecycle === CURRENT_LIFECYCLE_VERSIONS.lifecycle
        ? deriveTrajectoryDirectionalRecord({
            divisionDigest: snapshot.division.digest,
            divisionSeed: lifecycle.divisionSeed,
            castSeed: lifecycle.castSeed,
            trajectorySeed: lifecycle.trajectorySeed,
            versions: snapshot.game.versions,
            parts: snapshot.division.parts,
            events: snapshot.game.events,
          })
        : undefined
    lifecycle = await repository.transition({
      ownerId,
      gameId: snapshot.id,
      expectedRevision: lifecycle.revision,
      to: 'chess_terminal',
      stage: 'chess',
      activityType: 'terminal_ecology_derived',
      inputEntityIds: [snapshot.id],
      outputEntityIds: survivors.map((candidate) => candidate.candidateId),
      responsibleAgentIds: ['webchess-engine'],
      configurationDigest: digest,
      terminalFingerprint: fingerprint,
      survivors,
      ...(trajectoryDirectionalRecord
        ? { trajectoryDirectionalRecord }
        : {}),
    })
    if (trajectoryDirectionalRecord) {
      exactTrajectoryDirectionalRecord(snapshot, lifecycle)
    }
  }
  return lifecycle
}

async function preparePortia(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  snapshot: TerminalGameSnapshot,
): Promise<LifecycleAggregate> {
  let lifecycle = await synchronizeLifecycleWithGame(
    dependencies,
    ownerId,
    snapshot,
  )
  const current = requireCurrentLifecycleExecution(snapshot, lifecycle)
  requireCurrentPortiaProgress(
    lifecycle,
    current.trajectoryDirectionalRecord,
  )
  if (lifecycle.state === 'chess_terminal') {
    lifecycle = await requireLifecycleRepository(dependencies).transition({
      ownerId,
      gameId: snapshot.id,
      expectedRevision: lifecycle.revision,
      to: 'portia_pending',
      stage: 'portia',
      activityType: 'adversarial_review_queued',
      inputEntityIds: lifecycle.survivors.map(
        (candidate) => candidate.candidateId,
      ),
      responsibleAgentIds: ['portia'],
      configurationDigest: lifecycleConfigurationDigest(snapshot),
    })
  }
  return lifecycle
}

function pendingConflict(operation: ModelOperation): ApiError {
  return new ApiError(
    'CONFLICT',
    409,
    `This ${modelOperationLabel(operation)} is still being processed.`,
    { retryAfterSeconds: 2 },
  )
}

function terminalModelFailure(operation: ModelOperation): ApiError {
  return new ApiError(
    'UPSTREAM_FAILURE',
    502,
    `The model could not complete a valid WebChess ${modelOperationLabel(operation)}.`,
  )
}

async function releaseBeforeProvider(
  usage: UsageController,
  reservation: ModelReservation,
  ownerId: string,
): Promise<boolean> {
  if (reservation.kind !== 'reserved' || !reservation.leaseToken) return false
  try {
    const released = await usage.releaseReservation({
      userId: ownerId,
      requestId: reservation.requestId,
      leaseToken: reservation.leaseToken,
      reason: 'provider_not_started',
    })
    return released.ok
  } catch {
    // An expiring lease is reconciled durably by the next reservation or poll.
    return false
  }
}

async function failDivisionForOwner(
  repository: GameRepositoryPort,
  ownerId: string,
  snapshot: DurableGameSnapshot,
): Promise<DurableGameSnapshot> {
  if (snapshot.status !== 'dividing') return snapshot
  try {
    return await repository.failDivision({
      ownerId,
      gameId: snapshot.id,
      expectedRevision: snapshot.revision,
    })
  } catch (error) {
    if (!isGameRepositoryError(error) || error.code === 'not-found') throw error
    const current = await repository.getOwnedGame(ownerId, snapshot.id)
    if (current.status !== 'dividing') return current
    throw error
  }
}

async function failAnswerForOwner(
  repository: GameRepositoryPort,
  ownerId: string,
  snapshot: DurableGameSnapshot,
): Promise<DurableGameSnapshot> {
  if (snapshot.status !== 'answering') return snapshot
  try {
    return await repository.failAnswer({
      ownerId,
      gameId: snapshot.id,
      expectedRevision: snapshot.revision,
    })
  } catch (error) {
    if (!isGameRepositoryError(error) || error.code === 'not-found') throw error
    const current = await repository.getOwnedGame(ownerId, snapshot.id)
    if (current.status !== 'answering') return current
    throw error
  }
}

async function failBeforeProviderWithoutMaskingDeletion(
  operation: () => Promise<DurableGameSnapshot>,
): Promise<void> {
  try {
    await operation()
  } catch (error) {
    if (isGameRepositoryError(error) && error.code === 'not-found') return
    throw error
  }
}

async function finishDivisionForOwner(
  repository: GameRepositoryPort,
  ownerId: string,
  snapshot: DurableGameSnapshot,
  stored: DivisionResultPayload,
): Promise<DurableGameSnapshot> {
  if (snapshot.status !== 'dividing') return snapshot
  const parts = composeProblemParts(stored.facets, stored.seed)
  try {
    return await repository.finishDivision({
      ownerId,
      gameId: snapshot.id,
      expectedRevision: snapshot.revision,
      analysis: {
        facets: stored.facets,
        seed: stored.seed,
        model: stored.model,
        prompt: stored.prompt,
      },
      parts,
      promptVersion: stored.format === 'webchess-division-result/1'
        ? LEGACY_DIVISION_PROMPT_VERSION
        : stored.promptVersion,
    })
  } catch (error) {
    if (!isGameRepositoryError(error) || error.code === 'not-found') throw error
    const current = await repository.getOwnedGame(ownerId, snapshot.id)
    if (current.status !== 'dividing') return current
    throw error
  }
}

function requireExactCurrentMappedDivision(
  snapshot: DurableGameSnapshot,
  stored: CastDirectedDivisionResultPayload,
  requestId: string,
): void {
  const division = snapshot.division
  const parts = composeProblemParts(stored.facets, stored.seed)
  const promptSha256 = sha256Hex(stored.prompt)
  if (
    snapshot.id !== requestId ||
    stored.seed !== requestId ||
    snapshot.status !== 'mapped' ||
    !snapshot.game ||
    !division ||
    division.seed !== stored.seed ||
    division.model !== stored.model ||
    division.promptVersion !== stored.promptVersion ||
    division.promptSha256 !== promptSha256 ||
    canonicalHash(division.facets) !== canonicalHash(stored.facets) ||
    canonicalHash(division.parts) !== canonicalHash(parts)
  ) {
    throw new ApiError(
      'CONFLICT',
      409,
      'The saved field is not bound to this exact current Division request.',
    )
  }
}

async function storeAnswerForOwner(
  repository: GameRepositoryPort,
  ownerId: string,
  snapshot: DurableGameSnapshot,
  stored: AnswerResultPayload,
): Promise<DurableGameSnapshot> {
  if (snapshot.status === 'answered') return snapshot
  if (snapshot.status !== 'answering') {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'The saved answer state is inconsistent.',
    )
  }
  try {
    return await repository.storeAnswer({
      ownerId,
      gameId: snapshot.id,
      expectedRevision: snapshot.revision,
      answer: stored.answer,
    })
  } catch (error) {
    if (!isGameRepositoryError(error) || error.code === 'not-found') throw error
    const current = await repository.getOwnedGame(ownerId, snapshot.id)
    if (current.status === 'answered') return current
    throw error
  }
}

async function winningResult(
  usage: UsageController,
  ownerId: string,
  gameId: string,
  operation: ModelOperation,
  result: GetModelRequestResultResult,
  expected?: {
    readonly requestSha256?: string
    readonly promptVersion: string
  },
): Promise<GetModelRequestResultResult> {
  if (
    result.found &&
    result.status === 'succeeded' &&
    result.resultPayload
  ) {
    return result
  }
  if (result.found && result.status === 'rejected') {
    return usage.getSucceededModelResultForGame({
      userId: ownerId,
      gameId,
      operation,
      ...expected,
    })
  }
  return result
}

async function findDivisionRequest(
  usage: UsageController,
  ownerId: string,
  gameId: string,
  options: { readonly attachUnlinked?: boolean } = {},
): Promise<GetModelRequestResultResult> {
  const linked = await usage.getLatestModelRequestForGame({
    userId: ownerId,
    gameId,
    operation: 'division',
  })
  if (linked.found) return linked

  const direct = await usage.getModelRequestResult({
    userId: ownerId,
    requestId: gameId,
  })
  if (!direct.found || direct.operation !== 'division') return { found: false }

  if (
    options.attachUnlinked &&
    direct.gameId === null &&
    direct.status === 'reserved'
  ) {
    const attached = await usage.attachModelRequestGame({
      userId: ownerId,
      requestId: direct.requestId,
      gameId,
    })
    if (!attached.ok) {
      throw new ApiError(
        'CONFLICT',
        409,
        'The saved division request could not be linked to its game.',
      )
    }
  }
  return direct
}

function isCurrentDivisionRequest(
  result: GetModelRequestResultResult,
): result is Extract<GetModelRequestResultResult, { found: true }> {
  return result.found &&
    result.operation === 'division' &&
    result.promptVersion === DIVISION_PROMPT_VERSION
}

function isExactCurrentDivisionRequest(
  result: GetModelRequestResultResult,
  snapshot: DurableGameSnapshot,
  options: {
    readonly allowUnlinkedReserved?: boolean
    readonly requestId?: string
    readonly requestSha256?: string
  } = {},
): result is Extract<GetModelRequestResultResult, { found: true }> {
  if (!isCurrentDivisionRequest(result)) return false
  const requestId = options.requestId ?? snapshot.id
  const linked = result.gameId === snapshot.id
  const permittedUnlinked = options.allowUnlinkedReserved === true &&
    result.gameId === null &&
    result.status === 'reserved'
  if (
    requestId !== snapshot.id ||
    result.requestId !== requestId ||
    (!linked && !permittedUnlinked) ||
    typeof result.requestSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(result.requestSha256) ||
    (
      options.requestSha256 !== undefined &&
      result.requestSha256 !== options.requestSha256
    )
  ) return false
  if (result.status !== 'succeeded') return true
  const payload = currentDivisionPayload(result.resultPayload)
  return payload !== null && payload.seed === requestId
}

function currentDivisionPayload(
  value: unknown,
): CastDirectedDivisionResultPayload | null {
  const parsed = CastDirectedDivisionResultPayloadSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function requireGeneratedCurrentDivisionPayload(
  value: unknown,
): CastDirectedDivisionResultPayload {
  const parsed = CastDirectedDivisionResultPayloadSchema.safeParse(value)
  if (!parsed.success) {
    throw new ModelContractError(
      'The model returned an invalid current cast-bound Division result.',
    )
  }
  return parsed.data
}

async function reconcilePendingGame(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  snapshot: DurableGameSnapshot,
  options: {
    readonly divisionRequestId?: string
    readonly divisionRequestSha256?: string
  } = {},
): Promise<DurableGameSnapshot> {
  const operation: ModelOperation | null =
    snapshot.status === 'dividing'
      ? 'division'
      : snapshot.status === 'answering'
        ? 'answer'
        : null
  if (!operation) return snapshot

  let executableAnswerLifecycle: LifecycleAggregate | null = null
  if (operation === 'answer') {
    const lifecycle = await dependencies.lifecycleRepository?.getForGame(
      ownerId,
      snapshot.id,
    )
    if (!lifecycle || !hasCurrentLifecycleExecutionVersions(lifecycle.versions)) {
      // Historical rows remain available for inspection. A GET must not turn
      // an unsupported old request into a current mutation or usage recovery.
      return snapshot
    }
    executableAnswerLifecycle = requireCurrentReviewedGate(
      snapshot as TerminalGameSnapshot,
      lifecycle,
    ).lifecycle
  }

  let found: GetModelRequestResultResult
  if (operation === 'division') {
    const observed = await findDivisionRequest(
      dependencies.usage,
      ownerId,
      snapshot.id,
    )
    if (!isExactCurrentDivisionRequest(observed, snapshot, {
      allowUnlinkedReserved: true,
      ...(options.divisionRequestId === undefined
        ? {}
        : { requestId: options.divisionRequestId }),
      ...(options.divisionRequestSha256 === undefined
        ? {}
        : { requestSha256: options.divisionRequestSha256 }),
    })) {
      return snapshot
    }
    if (observed.gameId === null && observed.status === 'reserved') {
      await findDivisionRequest(dependencies.usage, ownerId, snapshot.id, {
        attachUnlinked: true,
      })
    }
    await dependencies.usage.reconcileExpiredLeases()
    found = await findDivisionRequest(
      dependencies.usage,
      ownerId,
      snapshot.id,
    )
    if (!isExactCurrentDivisionRequest(found, snapshot, {
      ...(options.divisionRequestId === undefined
        ? {}
        : { requestId: options.divisionRequestId }),
      ...(options.divisionRequestSha256 === undefined
        ? {}
        : { requestSha256: options.divisionRequestSha256 }),
    })) return snapshot
  } else {
    await dependencies.usage.reconcileExpiredLeases()
    found = await dependencies.usage.getLatestModelRequestForGame({
      userId: ownerId,
      gameId: snapshot.id,
      operation,
    })
  }
  const result = await winningResult(
    dependencies.usage,
    ownerId,
    snapshot.id,
    operation,
    found,
    operation === 'division'
      ? {
          ...(found.found && found.requestSha256
            ? { requestSha256: found.requestSha256 }
            : {}),
          promptVersion: DIVISION_PROMPT_VERSION,
        }
      : undefined,
  )

  if (operation === 'division' && !isExactCurrentDivisionRequest(
    result,
    snapshot,
    {
      ...(options.divisionRequestId === undefined
        ? {}
        : { requestId: options.divisionRequestId }),
      ...(options.divisionRequestSha256 === undefined
        ? {}
        : { requestSha256: options.divisionRequestSha256 }),
    },
  )) {
    return snapshot
  }

  if (!result.found) {
    return operation === 'division'
      ? failDivisionForOwner(dependencies.repository, ownerId, snapshot)
      : failAnswerForOwner(dependencies.repository, ownerId, snapshot)
  }
  if (result.status === 'succeeded') {
    if (!result.resultPayload) {
      throw new ApiError(
        'INTERNAL_ERROR',
        500,
        'The saved model result is incomplete.',
      )
    }
    if (operation === 'division') {
      const stored = currentDivisionPayload(result.resultPayload)
      if (!stored) return snapshot
      return finishDivisionForOwner(
        dependencies.repository,
        ownerId,
        snapshot,
        stored,
      )
    }
    const storedAnswer = answerPayload(result.resultPayload)
    if (
      !executableAnswerLifecycle ||
      !approvedAnswerMatchesLifecycle(storedAnswer, executableAnswerLifecycle)
    ) {
      return failAnswerForOwner(dependencies.repository, ownerId, snapshot)
    }
    return storeAnswerForOwner(
      dependencies.repository,
      ownerId,
      snapshot,
      storedAnswer,
    )
  }
  if (result.status === 'reserved' || result.status === 'in_progress') {
    return snapshot
  }
  return operation === 'division'
    ? failDivisionForOwner(dependencies.repository, ownerId, snapshot)
    : failAnswerForOwner(dependencies.repository, ownerId, snapshot)
}

async function settleDefinitiveFailure(
  dependencies: ApiServiceAdapterDependencies,
  input: {
    ownerId: string
    reservation: ModelReservation
    leaseToken: string
    error: unknown
    signal: AbortSignal
    settleAmbiguous?: boolean
  },
): Promise<boolean> {
  const failure = classifyProviderFailure(input.error, input.signal)
  if (failure.ambiguous && !input.settleAmbiguous) return false

  const settled = await dependencies.usage.settleModelRequest({
    userId: input.ownerId,
    requestId: input.reservation.requestId,
    leaseToken: input.leaseToken,
    outcome: failure.ambiguous ? 'indeterminate' : 'failed',
    failureCode: failure.failureCode,
    ...(failure.providerId === undefined
      ? {}
      : { providerResponseId: failure.providerId }),
    ...(failure.usage === undefined ? {} : { usage: failure.usage }),
    ...(failure.httpStatus === undefined
      ? {}
      : { providerHttpStatus: failure.httpStatus }),
  })
  return settled.ok
}

async function reconcileTerminalAnswerFailure(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  requestId: string,
): Promise<boolean> {
  await dependencies.usage.reconcileExpiredLeases()
  const result = await dependencies.usage.getModelRequestResult({
    userId: ownerId,
    requestId,
  })
  return result.found && (
    result.status === 'failed' ||
    result.status === 'indeterminate' ||
    result.status === 'rejected'
  )
}

async function recoverCommittedResult(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  gameId: string,
  operation: ModelOperation,
  expected?: {
    readonly requestSha256: string
    readonly promptVersion: string
  },
): Promise<GetModelRequestResultResult> {
  return dependencies.usage.getSucceededModelResultForGame({
    userId: ownerId,
    gameId,
    operation,
    ...expected,
  })
}

async function requireCurrentMappedDivisionBinding(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  snapshot: DurableGameSnapshot,
  requestId: string,
  requestSha256: string,
): Promise<CastDirectedDivisionResultPayload> {
  const recovered = await recoverCommittedResult(
    dependencies,
    ownerId,
    snapshot.id,
    'division',
    {
      requestSha256,
      promptVersion: DIVISION_PROMPT_VERSION,
    },
  )
  if (
    !recovered.found ||
    recovered.status !== 'succeeded' ||
    recovered.gameId !== snapshot.id ||
    recovered.operation !== 'division' ||
    recovered.requestSha256 !== requestSha256 ||
    recovered.promptVersion !== DIVISION_PROMPT_VERSION
  ) {
    throw new ApiError(
      'CONFLICT',
      409,
      'The saved field has no exact current Division result binding.',
    )
  }
  const stored = currentDivisionPayload(recovered.resultPayload)
  if (!stored || recovered.requestId !== requestId) {
    throw new ApiError(
      'CONFLICT',
      409,
      'The saved field has no exact current Division result binding.',
    )
  }
  requireExactCurrentMappedDivision(snapshot, stored, requestId)
  return stored
}

async function commitPortiaAndGate(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  game: TerminalGameSnapshot,
  lifecycle: LifecycleAggregate,
  modelRequestId: string,
  inputDigest: string,
  reviewValue: unknown,
): Promise<LifecycleAggregate> {
  const repository = requireLifecycleRepository(dependencies)
  const trajectoryDirectionalRecord = exactTrajectoryDirectionalRecord(
    game,
    lifecycle,
  )
  const review = validatePortiaReview(
    reviewValue,
    lifecycle.survivors,
    lifecycle.answerPromptDigest ?? undefined,
    trajectoryDirectionalRecord,
  )
  let current = lifecycle
  if (current.state === 'portia_pending') {
    current = await repository.beginPortiaAttempt({
      ownerId,
      gameId: game.id,
      expectedRevision: current.revision,
      modelRequestId,
      requestDigest: inputDigest,
      answerPromptDigest: review.reviewedAnswerPromptDigest,
      activityType: 'adversarial_review_recovered',
      configurationDigest: lifecycleConfigurationDigest(game),
    })
  }
  if (current.state === 'portia_running') {
    current = await repository.storePortia({
      ownerId,
      gameId: game.id,
      expectedRevision: current.revision,
      modelRequestId,
      inputDigest,
      outputDigest: canonicalHash({
        format: 'webchess-portia-result/1',
        review,
      }),
      review,
      configurationDigest: lifecycleConfigurationDigest(game),
    })
  }
  if (current.state === 'portia_complete') {
    const gate = evaluateGate(review, {
      sameFieldRetryCount: current.sameFieldRetryCount,
      fieldRegenerationCount: current.fieldRegenerationCount,
    }, trajectoryDirectionalRecord)
    let answerUserPrompt: string | null = null
    if (gate.passed) {
      const reviewed = boardAnswerPromptPlan(game, current)
      if (
        current.answerPromptDigest !== reviewed.digest ||
        review.reviewedAnswerPromptDigest !== reviewed.digest
      ) {
        throw new ApiError(
          'CONFLICT',
          409,
          'The player-visible Answer prompt no longer matches the exact prompt Portia reviewed.',
        )
      }
      answerUserPrompt = buildPlayerVisibleAnswerPrompt({
        plan: reviewed.plan,
        reviewedPromptDigest: reviewed.digest,
        portia: review,
        gate,
      })
    }
    current = await repository.storeGate({
      ownerId,
      gameId: game.id,
      expectedRevision: current.revision,
      result: gate,
      answerUserPrompt,
      configurationDigest: lifecycleConfigurationDigest(game),
    })
  }
  current = await concludeInsufficientBasisGate(
    dependencies,
    ownerId,
    game,
    current,
  )
  return current
}

async function concludeInsufficientBasisGate(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  game: DurableGameSnapshot,
  lifecycle: LifecycleAggregate,
): Promise<LifecycleAggregate> {
  if (
    lifecycle.state !== 'gate_failed' ||
    lifecycle.gate?.recommendedNextTransition !== 'insufficient_basis'
  ) {
    return lifecycle
  }

  requireCurrentReviewedGate(game as TerminalGameSnapshot, lifecycle)

  return requireLifecycleRepository(dependencies).transition({
    ownerId,
    gameId: game.id,
    expectedRevision: lifecycle.revision,
    to: 'insufficient_basis',
    stage: 'retry',
    activityType: 'retry_budget_exhausted',
    status: 'refused',
    inputEntityIds: [game.id],
    responsibleAgentIds: ['retry-policy'],
    configurationDigest: lifecycleConfigurationDigest(game),
  })
}

async function transitionAfterPortiaProviderFailure(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  game: Pick<TerminalGameSnapshot, 'id'> & DurableGameSnapshot,
  lifecycle: LifecycleAggregate,
  modelRequestId: string,
  requestDigest: string,
  retryActivityType:
    | 'adversarial_review_failed'
    | 'adversarial_review_recovered_for_retry',
): Promise<LifecycleAggregate> {
  if (lifecycle.state !== 'portia_running') return lifecycle
  return requireLifecycleRepository(dependencies).failPortiaAttempt({
    ownerId,
    gameId: game.id,
    expectedRevision: lifecycle.revision,
    modelRequestId,
    requestDigest,
    activityType: retryActivityType,
    configurationDigest: lifecycleConfigurationDigest(game),
  })
}

async function transitionAfterCharlotteProviderFailure(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  game: Pick<TerminalGameSnapshot, 'id'> & DurableGameSnapshot,
  lifecycle: LifecycleAggregate,
  modelRequestId: string,
  requestDigest: string,
  retryActivityType:
    | 'qualification_failed'
    | 'qualification_recovered_for_retry',
): Promise<LifecycleAggregate> {
  if (lifecycle.state !== 'charlotte_running') return lifecycle
  return requireLifecycleRepository(dependencies).failCharlotteAttempt({
    ownerId,
    gameId: game.id,
    expectedRevision: lifecycle.revision,
    modelRequestId,
    requestDigest,
    activityType: retryActivityType,
    configurationDigest: lifecycleConfigurationDigest(game),
  })
}

async function commitCharlotte(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  game: TerminalGameSnapshot,
  lifecycle: LifecycleAggregate,
  modelRequestId: string,
  inputDigest: string,
  payload: CharlotteResultPayload,
): Promise<LifecycleAggregate> {
  exactTrajectoryDirectionalRecord(game, lifecycle)
  if (!approvedCharlotteMatchesSource(payload, lifecycle, game)) {
    throw new ApiError(
      'CONFLICT',
      409,
      'Charlotte did not qualify the exact persisted Portia-approved board answer.',
    )
  }
  const repository = requireLifecycleRepository(dependencies)
  let current = lifecycle
  if (current.state === 'charlotte_pending') {
    current = await repository.beginCharlotteAttempt({
      ownerId,
      gameId: game.id,
      expectedRevision: current.revision,
      modelRequestId,
      requestDigest: inputDigest,
      activityType: 'qualification_recovered',
      configurationDigest: lifecycleConfigurationDigest(game),
    })
  }
  if (current.state !== 'charlotte_running') return current
  return repository.storeCharlotte({
    ownerId,
    gameId: game.id,
    expectedRevision: current.revision,
    modelRequestId,
    inputDigest,
    outputDigest: canonicalHash(payload),
    result: payload.structured,
    renderedAnswer: payload.renderedAnswer,
    configurationDigest: lifecycleConfigurationDigest(game),
  })
}

async function reconcileRunningLifecycleModel(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  game: TerminalGameSnapshot,
  lifecycle: LifecycleAggregate,
): Promise<LifecycleAggregate> {
  const operation = lifecycle.state === 'portia_running'
    ? 'portia'
    : lifecycle.state === 'charlotte_running'
      ? 'charlotte'
      : null
  if (!operation) return lifecycle

  if (operation === 'portia') {
    const current = requireCurrentLifecycleExecution(game, lifecycle)
    requireCurrentPortiaProgress(
      lifecycle,
      current.trajectoryDirectionalRecord,
    )
  } else {
    requireCurrentReviewedGate(game, lifecycle)
  }

  const answerPrompt = operation === 'portia'
    ? boardAnswerPromptPlan(game, lifecycle)
    : null
  const portiaInput: PortiaInput | null = answerPrompt
    ? {
        problem: game.problem,
        survivors: lifecycle.survivors,
        answerPromptPackage: answerPrompt.plan,
        answerPromptDigest: answerPrompt.digest,
        completedAssessments: lifecycle.portiaProgress.completedAssessments,
      }
    : null
  let charlotteInput: CharlotteInput | null = null
  if (operation === 'charlotte') {
    if (
      !game.answer ||
      !lifecycle.portia ||
      lifecycle.portia.contractVersion !==
        CURRENT_LIFECYCLE_VERSIONS.portiaContract ||
      !lifecycle.gate ||
      !lifecycle.answerPromptDigest
    ) {
      throw new ApiError(
        'INTERNAL_ERROR',
        500,
        'The saved Charlotte result is missing its board-answer inputs.',
      )
    }
    const charlottePromptPlan = boardAnswerPromptPlan(game, lifecycle).plan
    const researchEvidence = charlottePromptPlan.researchEvidence
    charlotteInput = {
      problem: game.problem,
      boardAnswer: game.answer,
      boardAnswerDigest: canonicalHash(game.answer),
      reviewedPromptDigest: lifecycle.answerPromptDigest,
      portia: lifecycle.portia,
      gate: lifecycle.gate,
      ...(researchEvidence?.length ? { researchEvidence } : {}),
      ...(charlottePromptPlan.trajectoryDirectionalRecord
        ? {
            trajectoryDirectionalRecord:
              charlottePromptPlan.trajectoryDirectionalRecord,
          }
        : {}),
    }
    await requireApprovedAnswerPayload(
      dependencies,
      ownerId,
      game,
      lifecycle,
    )
  }
  const requestSha256 = canonicalHash(operation === 'portia'
    ? {
        operation: 'portia/v4-directional',
        gameId: game.id,
        terminalFingerprint: answerPrompt!.plan.terminalFingerprint,
        input: {
          problem: portiaInput!.problem,
          survivors: portiaInput!.survivors,
          answerPromptPackage: portiaInput!.answerPromptPackage,
          answerPromptDigest: portiaInput!.answerPromptDigest,
        },
        model: modelName(dependencies),
        promptVersion: CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
        contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
      }
    : {
        operation: 'charlotte/v4-directional',
        gameId: game.id,
        input: charlotteInput,
        model: modelName(dependencies),
        promptVersion: CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
        contractVersion: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
      })
  const promptVersion = operation === 'portia'
    ? CURRENT_LIFECYCLE_VERSIONS.portiaPrompt
    : CURRENT_LIFECYCLE_VERSIONS.charlottePrompt

  await dependencies.usage.reconcileExpiredLeases()
  const activeRequestId = operation === 'portia'
    ? lifecycle.portiaActiveModelRequestId
    : lifecycle.charlotteActiveModelRequestId
  if (operation === 'charlotte' && !activeRequestId) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'Charlotte’s running lifecycle is missing its provider-attempt fence.',
    )
  }
  const latest = activeRequestId
    ? await dependencies.usage.getModelRequestResult({
        userId: ownerId,
        requestId: activeRequestId,
      })
    : await dependencies.usage.getLatestModelRequestForGame({
        userId: ownerId,
        gameId: game.id,
        operation,
        requestSha256,
        promptVersion,
      })
  if (
    activeRequestId &&
    (
      !latest.found ||
      latest.gameId !== game.id ||
      latest.operation !== operation ||
      (latest.requestSha256 !== undefined && latest.requestSha256 !== requestSha256) ||
      (latest.promptVersion !== undefined && latest.promptVersion !== promptVersion)
    )
  ) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `${operation === 'portia' ? 'Portia' : 'Charlotte'}’s saved provider-attempt fence is inconsistent.`,
    )
  }
  if (
    latest.found &&
    (latest.status === 'reserved' || latest.status === 'in_progress')
  ) {
    return lifecycle
  }

  const succeeded = latest.found && latest.status === 'succeeded'
    ? latest
    : { found: false as const }
  if (succeeded.found && succeeded.status === 'succeeded' && succeeded.resultPayload) {
    if (operation === 'portia') {
      if (!answerPrompt || !portiaInput) {
        throw new ApiError('INTERNAL_ERROR', 500, 'Portia recovery input is missing.')
      }
      if (lifecycle.portiaActiveModelRequestId === null) {
        lifecycle = await requireLifecycleRepository(dependencies).transition({
          ownerId,
          gameId: game.id,
          expectedRevision: lifecycle.revision,
          to: 'portia_pending',
          stage: 'portia',
          activityType: 'legacy_review_recovered_for_binding',
          status: 'failed',
          responsibleAgentIds: ['portia'],
          configurationDigest: lifecycleConfigurationDigest(game),
        })
        lifecycle = await requireLifecycleRepository(dependencies)
          .beginPortiaAttempt({
            ownerId,
            gameId: game.id,
            expectedRevision: lifecycle.revision,
            modelRequestId: succeeded.requestId,
            requestDigest: requestSha256,
            answerPromptDigest: answerPrompt.digest,
            activityType: 'adversarial_review_recovered',
            configurationDigest: lifecycleConfigurationDigest(game),
          })
      }
      return commitPortiaAndGate(
        dependencies,
        ownerId,
        game,
        lifecycle,
        succeeded.requestId,
        requestSha256,
        portiaPayload(succeeded.resultPayload).review,
      )
    }

    return commitCharlotte(
      dependencies,
      ownerId,
      game,
      lifecycle,
      succeeded.requestId,
      requestSha256,
      charlottePayload(succeeded.resultPayload),
    )
  }

  if (operation === 'portia') {
    if (activeRequestId && latest.found && (
      latest.status === 'failed' || latest.status === 'indeterminate'
    )) {
      return transitionAfterPortiaProviderFailure(
        dependencies,
        ownerId,
        game,
        lifecycle,
        activeRequestId,
        requestSha256,
        'adversarial_review_recovered_for_retry',
      )
    }
    if (activeRequestId) {
      throw new ApiError(
        'INTERNAL_ERROR',
        500,
        'Portia’s active provider attempt ended in an unsupported state.',
      )
    }
    return requireLifecycleRepository(dependencies).transition({
      ownerId,
      gameId: game.id,
      expectedRevision: lifecycle.revision,
      to: 'portia_pending',
      stage: 'portia',
      activityType: 'legacy_review_recovered_for_retry',
      status: 'failed',
      responsibleAgentIds: ['portia'],
      configurationDigest: lifecycleConfigurationDigest(game),
    })
  }

  if (activeRequestId && latest.found && (
    latest.status === 'failed' || latest.status === 'indeterminate'
  )) {
    return transitionAfterCharlotteProviderFailure(
      dependencies,
      ownerId,
      game,
      lifecycle,
      activeRequestId,
      requestSha256,
      'qualification_recovered_for_retry',
    )
  }
  throw new ApiError(
    'INTERNAL_ERROR',
    500,
    'Charlotte’s active provider attempt ended in an unsupported state.',
  )
}

export function createApiServicesWithDependencies(
  dependencies: ApiServiceAdapterDependencies,
): WebChessApiServices {
  const divisionRequestHash = (
    problem: string,
    memoryObservationIds: readonly string[],
    researchConsent: Omit<ResearchConsent, 'recordedAt'>,
  ) =>
    canonicalHash({
      operation: 'division/v4-web-memory-research-consent',
      problem,
      memoryObservationIds,
      researchConsent,
      model: modelName(dependencies),
      promptVersion: DIVISION_PROMPT_VERSION,
      softwareVersion: dependencies.softwareVersion,
    })

  const services: WebChessApiServices = {
    ...createDataControlServicesWithDependencies(dependencies),
    divide(input) {
      return apiOperation(async () => {
        const problem = normalizeProblem(input.problem)
        const memoryObservationIds = [...new Set(input.memoryObservationIds ?? [])]
        const requestSha256 = divisionRequestHash(
          problem,
          memoryObservationIds,
          input.researchConsent,
        )
        const lifecycleRepository = memoryObservationIds.length > 0
          ? requireLifecycleRepository(dependencies)
          : null
        const webMemoryEvidence = memoryObservationIds.length === 0
          ? []
          : await lifecycleRepository!.getWebMemoryEvidence(
              input.ownerId,
              memoryObservationIds,
            )
        const reservation = await dependencies.usage.reserveModelRequest({
          requestId: input.requestId,
          gameId: null,
          userId: input.ownerId,
          operation: 'division',
          idempotencyKey: input.idempotencyKey,
          requestSha256,
          provider: modelProvider(dependencies),
          model: modelName(dependencies),
          promptVersion: DIVISION_PROMPT_VERSION,
          softwareVersion: dependencies.softwareVersion,
          countsAsGameStart: true,
          ipAddress: input.ipAddress,
        })
        if (!reservation.ok) throw usageError(reservation)

        let shell: DurableGameSnapshot | null = null
        let providerStarted = false
        let successCommitted = false

        try {
          const division = await dependencies.repository.getOrCreateDivision({
            ownerId: input.ownerId,
            problem,
            softwareVersion: dependencies.softwareVersion,
            gameId: reservation.requestId,
            researchConsent: input.researchConsent,
          })
          shell = division.game

          if (memoryObservationIds.length > 0) {
            await lifecycleRepository!.attachWebMemoryEvidence(
              input.ownerId,
              shell.id,
              memoryObservationIds,
            )
          }

          const attached = await dependencies.usage.attachModelRequestGame({
            userId: input.ownerId,
            requestId: reservation.requestId,
            gameId: shell.id,
          })
          if (!attached.ok) {
            throw new ApiError(
              'CONFLICT',
              409,
              'The durable division request could not be linked to its game.',
            )
          }

          if (reservation.kind === 'existing') {
            const recovered = await reconcilePendingGame(
              dependencies,
              input.ownerId,
              shell,
              {
                divisionRequestId: reservation.requestId,
                divisionRequestSha256: requestSha256,
              },
            )
            if (recovered.status === 'division_failed') {
              throw terminalModelFailure('division')
            }
            if (recovered.status === 'mapped') {
              await requireCurrentMappedDivisionBinding(
                dependencies,
                input.ownerId,
                recovered,
                reservation.requestId,
                requestSha256,
              )
            }
            if (
              recovered.status !== 'dividing' &&
              dependencies.lifecycleRepository
            ) {
              await ensureLifecycleForNewGame(
                dependencies,
                input.ownerId,
                recovered,
              )
            }
            return publicGame(recovered)
          }

          const leaseToken = requireLease(reservation)
          const began = await dependencies.usage.beginProviderCall({
            userId: input.ownerId,
            requestId: reservation.requestId,
            leaseToken,
          })
          if (!began.ok) {
            throw beginProviderCallError(began, 'division')
          }
          providerStarted = true
          const providerSignal = durableProviderSignal()

          let winning: CastDirectedDivisionResultPayload
          try {
            const generated = await dependencies.divisionGenerator(
              {
                problem,
                divisionSeed: reservation.requestId,
                ...(webMemoryEvidence.length > 0
                  ? { webMemoryEvidence }
                  : {}),
              },
              {
              userId: input.ownerId,
              safetyHmacSecret: dependencies.hmacSecret,
              signal: providerSignal,
              idempotencyKey: providerIdempotencyKey(
                dependencies.hmacSecret,
                input.ownerId,
                'division',
                input.idempotencyKey,
              ),
              },
            )
            const stored = requireGeneratedCurrentDivisionPayload({
              format: 'webchess-division-result/2',
              promptVersion: CAST_DIRECTED_DIVISION_PROMPT_VERSION,
              castBindingVersion: DIVISION_CAST_BINDING_VERSION,
              seed: reservation.requestId,
              facets: generated.result.facets,
              model: generated.model,
              prompt: generated.prompt,
            })
            const payload = modelResultPayload(stored)
            const settled = await dependencies.usage.settleModelRequest({
              userId: input.ownerId,
              requestId: reservation.requestId,
              leaseToken,
              outcome: 'succeeded',
              usage: providerUsage(generated),
              ...(generated.providerId === null
                ? {}
                : { providerResponseId: generated.providerId }),
              responseSha256: canonicalHash(payload),
              resultPayload: payload,
            })

            winning = stored
            if (!settled.ok) {
              const recovered = await recoverCommittedResult(
                dependencies,
                input.ownerId,
                shell.id,
                'division',
                {
                  requestSha256,
                  promptVersion: DIVISION_PROMPT_VERSION,
                },
              )
              if (!recovered.found || recovered.status !== 'succeeded') {
                throw new ApiError(
                  'INTERNAL_ERROR',
                  500,
                  'The division result could not be committed safely.',
                )
              }
              const currentWinner = currentDivisionPayload(
                recovered.resultPayload,
              )
              if (
                !currentWinner ||
                currentWinner.seed !== reservation.requestId ||
                recovered.requestId !== reservation.requestId ||
                recovered.gameId !== shell.id ||
                recovered.operation !== 'division' ||
                recovered.requestSha256 !== requestSha256 ||
                recovered.promptVersion !== DIVISION_PROMPT_VERSION
              ) {
                throw new ApiError(
                  'INTERNAL_ERROR',
                  500,
                  'The division result could not be committed safely.',
                )
              }
              winning = currentWinner
            }
            successCommitted = true
          } catch (error) {
            const settled = await settleDefinitiveFailure(dependencies, {
              ownerId: input.ownerId,
              reservation,
              leaseToken,
              error,
              signal: providerSignal,
              // The bounded bridge owns one stable turn identity. A timeout or
              // lost response cannot continue as a second provider call, so
              // settle it immediately and expose a clean Division retry.
              settleAmbiguous: true,
            })
            if (settled && shell) {
              shell = await failDivisionForOwner(
                dependencies.repository,
                input.ownerId,
                shell,
              )
            }
            throw error
          }
          shell = await finishDivisionForOwner(
            dependencies.repository,
            input.ownerId,
            shell,
            winning,
          )
          requireExactCurrentMappedDivision(
            shell,
            winning,
            reservation.requestId,
          )
          if (dependencies.lifecycleRepository) {
            await ensureLifecycleForNewGame(
              dependencies,
              input.ownerId,
              shell,
            )
          }
          return publicGame(shell)
        } catch (error) {
          if (!providerStarted) {
            await releaseBeforeProvider(
              dependencies.usage,
              reservation,
              input.ownerId,
            )
            if (shell) {
              await failBeforeProviderWithoutMaskingDeletion(() =>
                failDivisionForOwner(
                  dependencies.repository,
                  input.ownerId,
                  shell!,
                ),
              )
            }
          } else if (successCommitted) {
            // The ledger payload is the recovery authority. Never overwrite it
            // with a failed game merely because finalization was interrupted.
          }
          throw error
        }
      })
    },

    getCurrentGame(input) {
      return apiOperation(async () => {
        const snapshot = await dependencies.repository.getCurrentGame(input.ownerId)
        if (!snapshot) return null
        return publicGame(
          await reconcilePendingGame(dependencies, input.ownerId, snapshot),
        )
      })
    },

    getWebMemory(input) {
      return apiOperation(() =>
        requireLifecycleRepository(dependencies).listWebMemory(input.ownerId),
      )
    },

    getGame(input) {
      return apiOperation(async () => {
        const snapshot = await dependencies.repository.getOwnedGame(
          input.ownerId,
          input.gameId,
        )
        return publicGame(
          await reconcilePendingGame(dependencies, input.ownerId, snapshot),
        )
      })
    },

    getDivisionIntent(input) {
      return apiOperation(async () => {
        const intent = await dependencies.usage
          .getModelRequestByIdempotencyKey({
            userId: input.ownerId,
            operation: 'division',
            idempotencyKey: input.idempotencyKey,
          })
        if (!intent.found || intent.gameId === null) {
          throw new ApiError('GAME_NOT_FOUND', 404, 'Game not found.')
        }

        const snapshot = await dependencies.repository.getOwnedGame(
          input.ownerId,
          intent.gameId,
        )
        return publicGame(
          await reconcilePendingGame(dependencies, input.ownerId, snapshot),
        )
      })
    },

    startGame(input) {
      return apiOperation(async () => {
        const snapshot = await dependencies.repository.startGame({
          ownerId: input.ownerId,
          gameId: input.gameId,
          expectedRevision: input.expectedRevision,
          idempotencyKey: input.idempotencyKey,
        })
        const lifecycle = await dependencies.lifecycleRepository?.getForGame(
          input.ownerId,
          snapshot.id,
        )
        if (lifecycle) {
          await synchronizeLifecycleWithGame(
            dependencies,
            input.ownerId,
            snapshot,
          )
        }
        return publicGame(snapshot)
      })
    },

    move(input) {
      return apiOperation(async () => {
        const allowed = await dependencies.usage.consumeGameMoveRate({
          userId: input.ownerId,
          ipAddress: input.ipAddress,
        })
        if (!allowed.ok) throw usageError(allowed)

        const moved = await dependencies.repository.appendMove({
          ownerId: input.ownerId,
          gameId: input.gameId,
          expectedRevision: input.expectedRevision,
          idempotencyKey: input.idempotencyKey,
          command: {
            pieceId: input.pieceId,
            to: input.to,
          },
        })
        const lifecycle = await dependencies.lifecycleRepository?.getForGame(
          input.ownerId,
          moved.game.id,
        )
        if (lifecycle) {
          await synchronizeLifecycleWithGame(
            dependencies,
            input.ownerId,
            moved.game,
          )
        }
        return publicGame(moved.game)
      })
    },

    answer(input) {
      const providerDeadline = durableAnswerOperationDeadline(
        input.operationDeadlineAt,
      )
      return apiOperation(async () => {
        providerDeadline.assertBeforeDeadline()
        let terminal = await dependencies.repository.getTerminalReplay(
          input.ownerId,
          input.gameId,
        )
        providerDeadline.assertBeforeDeadline()
        let lifecycle = await dependencies.lifecycleRepository?.getForGame(
          input.ownerId,
          input.gameId,
        )
        providerDeadline.assertBeforeDeadline()
        let approvedLifecycle = requireCurrentReviewedGate(terminal, lifecycle)
        lifecycle = approvedLifecycle.lifecycle
        if (terminal.status === 'answered' && terminal.answer) {
          await requireApprovedAnswerPayload(
            dependencies,
            input.ownerId,
            terminal,
            lifecycle,
          )
          return {
            game: publicGame(terminal),
            answer: terminal.answer,
          }
        }
        if (terminal.status === 'answering') {
          const reconciled = await reconcilePendingGame(
            dependencies,
            input.ownerId,
            terminal,
          )
          if (reconciled.status === 'answered' && reconciled.answer) {
            const reconciledTerminal = await dependencies.repository
              .getTerminalReplay(input.ownerId, input.gameId)
            approvedLifecycle = requireCurrentReviewedGate(
              reconciledTerminal,
              lifecycle,
            )
            lifecycle = approvedLifecycle.lifecycle
            await requireApprovedAnswerPayload(
              dependencies,
              input.ownerId,
              reconciledTerminal,
              lifecycle,
            )
            return {
              game: publicGame(reconciled),
              answer: reconciled.answer,
            }
          }
          if (reconciled.status === 'answering') {
            throw pendingConflict('answer')
          }
          terminal = await dependencies.repository.getTerminalReplay(
            input.ownerId,
            input.gameId,
          )
          approvedLifecycle = requireCurrentReviewedGate(terminal, lifecycle)
          lifecycle = approvedLifecycle.lifecycle
        }

        if (lifecycle.state !== 'gate_passed' || !approvedLifecycle.gate.passed) {
          throw new ApiError(
            'CONFLICT',
            409,
            'The exact current board-derived Answer prompt must be permitted by Portia and the Gate before generation.',
          )
        }
        const answerInput: AnswerGenerationInput = {
          plan: approvedLifecycle.answerPrompt.plan,
          reviewedPromptDigest: approvedLifecycle.answerPrompt.digest,
          portia: approvedLifecycle.portia,
          gate: approvedLifecycle.gate,
        }
        const trajectoryDirectionalRecord =
          approvedLifecycle.trajectoryDirectionalRecord
        const requestSha256 = canonicalHash({
          operation: 'answer/v4-directional-approved',
          gameId: input.gameId,
          expectedRevision: input.expectedRevision,
          input: answerInput,
          model: modelName(dependencies),
          promptVersion: ANSWER_PROMPT_VERSION,
          softwareVersion: dependencies.softwareVersion,
        })
        providerDeadline.assertBeforeDeadline()
        const reservation = await dependencies.usage.reserveModelRequest({
          requestId: input.requestId,
          gameId: input.gameId,
          userId: input.ownerId,
          operation: 'answer',
          idempotencyKey: input.idempotencyKey,
          requestSha256,
          provider: modelProvider(dependencies),
          model: modelName(dependencies),
          promptVersion: ANSWER_PROMPT_VERSION,
          softwareVersion: dependencies.softwareVersion,
          operationDeadlineAt: providerDeadline.operationDeadlineAt,
          leaseExpiresAtCap: providerDeadline.leaseExpiresAtCap,
          countsAsGameStart: false,
          ipAddress: input.ipAddress,
        })
        try {
          providerDeadline.assertBeforeDeadline()
        } catch (error) {
          if (reservation.ok && reservation.kind === 'reserved') {
            await releaseBeforeProvider(
              dependencies.usage,
              reservation,
              input.ownerId,
            )
          }
          throw error
        }
        if (!reservation.ok) throw usageError(reservation)
        if (reservation.kind === 'existing') {
          const direct = await dependencies.usage.getModelRequestResult({
            userId: input.ownerId,
            requestId: reservation.requestId,
          })
          const existing = await winningResult(
            dependencies.usage,
            input.ownerId,
            input.gameId,
            'answer',
            direct,
            {
              requestSha256,
              promptVersion: ANSWER_PROMPT_VERSION,
            },
          )
          if (
            existing.found &&
            existing.status === 'succeeded' &&
            existing.resultPayload
          ) {
            const stored = answerPayload(existing.resultPayload)
            if (lifecycle && !approvedAnswerMatchesLifecycle(stored, lifecycle)) {
              throw new ApiError(
                'CONFLICT',
                409,
                'The recovered answer does not match this Portia-approved prompt.',
              )
            }
            const pending = terminal.status === 'answering'
              ? terminal
              : await dependencies.repository.beginAnswer({
                  ownerId: input.ownerId,
                  gameId: input.gameId,
                  expectedRevision: input.expectedRevision,
                })
            const answered = await storeAnswerForOwner(
              dependencies.repository,
              input.ownerId,
              pending,
              stored,
            )
            if (!answered.answer) {
              throw new ApiError(
                'INTERNAL_ERROR',
                500,
                'The saved answer result is incomplete.',
              )
            }
            return {
              game: publicGame(answered),
              answer: answered.answer,
            }
          }
          if (
            existing.found &&
            (existing.status === 'reserved' ||
              existing.status === 'in_progress')
          ) {
            throw pendingConflict('answer')
          }
          throw terminalModelFailure('answer')
        }

        let pending: DurableGameSnapshot | null = null
        let providerReleasedBeforeDispatch = false
        let providerStarted = false
        let successCommitted = false
        try {
          pending = await dependencies.repository.beginAnswer({
            ownerId: input.ownerId,
            gameId: input.gameId,
            expectedRevision: input.expectedRevision,
          })
          if (pending.status === 'answered' && pending.answer) {
            await releaseBeforeProvider(
              dependencies.usage,
              reservation,
              input.ownerId,
            )
            return {
              game: publicGame(pending),
              answer: pending.answer,
            }
          }

          const leaseToken = requireLease(reservation)
          const providerSignal = providerDeadline.signal
          const failProviderAttempt = async (error: unknown): Promise<never> => {
            if (!providerStarted) {
              if (providerSignal.aborted) {
                throw new OpenClawProviderError(
                  'provider_timeout',
                  false,
                  'The Answer stage exceeded its five-minute limit before provider execution began.',
                  { cause: error },
                )
              }
              throw error
            }
            const settled = await settleDefinitiveFailure(dependencies, {
              ownerId: input.ownerId,
              reservation,
              leaseToken,
              error,
              signal: providerSignal,
              settleAmbiguous: true,
            })
            const terminalFailure = settled ||
              await reconcileTerminalAnswerFailure(
                dependencies,
                input.ownerId,
                reservation.requestId,
              )
            if (terminalFailure && pending) {
              pending = await failAnswerForOwner(
                dependencies.repository,
                input.ownerId,
                pending,
              )
            }
            if (providerSignal.aborted) {
              throw new OpenClawProviderError(
                'provider_timeout',
                false,
                'The Answer stage exceeded its five-minute limit and was saved as a retryable failure.',
                { cause: error },
              )
            }
            throw error
          }

          const generated = await (async () => {
            try {
              providerDeadline.assertBeforeDeadline()
              const result = await Promise.race([
                dependencies.answerGenerator(answerInput, {
                  userId: input.ownerId,
                  safetyHmacSecret: dependencies.hmacSecret,
                  signal: providerSignal,
                  idempotencyKey: providerIdempotencyKey(
                    dependencies.hmacSecret,
                    input.ownerId,
                    'answer',
                    input.idempotencyKey,
                  ),
                  onProviderTurnStart: async () => {
                    providerDeadline.assertBeforeDeadline()
                    const priorProviderTurnStarted = providerStarted
                    const began = await dependencies.usage.beginProviderCall({
                      userId: input.ownerId,
                      requestId: reservation.requestId,
                      leaseToken,
                    })
                    if (!began.ok) {
                      throw beginProviderCallError(began, 'answer')
                    }
                    const providerWasAlreadyStarted =
                      priorProviderTurnStarted || began.alreadyStarted
                    try {
                      providerDeadline.assertBeforeDeadline()
                    } catch (error) {
                      const rolledBack = providerWasAlreadyStarted
                        ? false
                        : await releaseBeforeProvider(
                            dependencies.usage,
                            reservation,
                            input.ownerId,
                          )
                      providerReleasedBeforeDispatch = rolledBack
                      // If the fenced rollback could not prove that dispatch
                      // remained unstarted, use the conservative settlement
                      // path so no in-progress lease can be orphaned.
                      providerStarted = !rolledBack
                      throw error
                    }
                    providerStarted = true
                  },
                }),
                providerDeadline.expired,
              ])
              providerDeadline.assertBeforeDeadline()
              return result
            } catch (error) {
              return failProviderAttempt(error)
            }
          })()

          const stored = ApprovedAnswerResultPayloadSchema.parse({
            format: 'webchess-answer-result/2',
            answer: {
              answer: generated.result.answer,
              model: generated.model,
              prompt: generated.prompt,
            },
            approval: {
              lifecycleRunId: lifecycle.id,
              reviewedPromptDigest: approvedLifecycle.answerPrompt.digest,
              gateInputDigest: approvedLifecycle.gate.inputDigest,
              ...directionalResultSource(trajectoryDirectionalRecord),
            },
          })
          const payload = modelResultPayload(stored)
          try {
            providerDeadline.assertBeforeDeadline()
          } catch (error) {
            await failProviderAttempt(error)
          }
          const settled = await dependencies.usage.settleModelRequest({
            userId: input.ownerId,
            requestId: reservation.requestId,
            leaseToken,
            outcome: 'succeeded',
            usage: providerUsage(generated),
            ...(generated.providerId === null
              ? {}
              : { providerResponseId: generated.providerId }),
            responseSha256: canonicalHash(payload),
            resultPayload: payload,
          })

          let winning = stored
          if (!settled.ok) {
            let recovered = await recoverCommittedResult(
              dependencies,
              input.ownerId,
              input.gameId,
              'answer',
              {
                requestSha256,
                promptVersion: ANSWER_PROMPT_VERSION,
              },
            )
            if (!recovered.found || recovered.status !== 'succeeded') {
              const terminalFailure =
                await reconcileTerminalAnswerFailure(
                  dependencies,
                  input.ownerId,
                  reservation.requestId,
                )
              recovered = await recoverCommittedResult(
                dependencies,
                input.ownerId,
                input.gameId,
                'answer',
                {
                  requestSha256,
                  promptVersion: ANSWER_PROMPT_VERSION,
                },
              )
              if (
                terminalFailure &&
                (!recovered.found || recovered.status !== 'succeeded')
              ) {
                pending = await failAnswerForOwner(
                  dependencies.repository,
                  input.ownerId,
                  pending,
                )
                throw new ApiError(
                  'UPSTREAM_TIMEOUT',
                  504,
                  'The Answer result arrived after its durable deadline and was saved as a retryable failure.',
                )
              }
            }
            if (!recovered.found || recovered.status !== 'succeeded') {
              throw new ApiError(
                'INTERNAL_ERROR',
                500,
                'The answer result could not be committed safely.',
              )
            }
            winning = ApprovedAnswerResultPayloadSchema.parse(
              recovered.resultPayload,
            )
          }
          if (!approvedAnswerMatchesLifecycle(winning, lifecycle)) {
            throw new ApiError(
              'INTERNAL_ERROR',
              500,
              'The committed answer lost its Portia and Gate provenance.',
            )
          }
          successCommitted = true
          pending = await storeAnswerForOwner(
            dependencies.repository,
            input.ownerId,
            pending,
            winning,
          )
          if (!pending.answer) {
            throw new ApiError(
              'INTERNAL_ERROR',
              500,
              'The saved answer result is incomplete.',
            )
          }
          return {
            game: publicGame(pending),
            answer: pending.answer,
          }
        } catch (error) {
          if (!providerStarted) {
            if (!providerReleasedBeforeDispatch) {
              await releaseBeforeProvider(
                dependencies.usage,
                reservation,
                input.ownerId,
              )
            }
            if (pending) {
              await failBeforeProviderWithoutMaskingDeletion(() =>
                failAnswerForOwner(
                  dependencies.repository,
                  input.ownerId,
                  pending!,
                ),
              )
            }
          } else if (successCommitted) {
            // The result payload remains the authority for the next GET poll.
          }
          throw error
        }
      }).finally(providerDeadline.dispose)
    },

    getLifecycle(input) {
      return apiOperation(async () => {
        const repository = requireLifecycleRepository(dependencies)
        const game = await dependencies.repository.getOwnedGame(
          input.ownerId,
          input.gameId,
        )
        const storedLifecycle = await repository.getForGame(
          input.ownerId,
          input.gameId,
        )
        if (!storedLifecycle) {
          throw new ApiError(
            'LIFECYCLE_NOT_FOUND',
            404,
            'This game has no lifecycle provenance.',
          )
        }
        let baseLifecycle: LifecycleAggregate
        try {
          baseLifecycle = requireCurrentLifecycleBase(game, storedLifecycle)
        } catch (error) {
          if (!isApiError(error) || error.code !== 'CONFLICT') throw error
          // Preserve historical rows as read-only evidence. Polling them must
          // never reconcile a lease or advance a modern lifecycle state.
          return storedLifecycle
        }
        if (game.game?.outcome) {
          const existingDirectionalRecord =
            baseLifecycle.versions.trajectoryDirectionalRecord ===
              CURRENT_LIFECYCLE_VERSIONS.trajectoryDirectionalRecord
              ? requireCurrentLifecycleExecution(
                  game,
                  baseLifecycle,
                ).trajectoryDirectionalRecord
              : undefined
          // Validate persisted Portia state before the terminal synchronization
          // CAS so corrupt or mixed progress can never trigger lifecycle writes.
          requireCurrentPortiaProgress(
            baseLifecycle,
            existingDirectionalRecord,
          )
        }
        let lifecycle = await synchronizeLifecycleWithGame(
          dependencies,
          input.ownerId,
          game,
        )
        if (game.game?.outcome) {
          const current = requireCurrentLifecycleExecution(game, lifecycle)
          requireCurrentPortiaProgress(
            lifecycle,
            current.trajectoryDirectionalRecord,
          )
        }
        if (
          lifecycle.state === 'portia_running' ||
          lifecycle.state === 'charlotte_running'
        ) {
          const terminal = await dependencies.repository.getTerminalReplay(
            input.ownerId,
            input.gameId,
          )
          if (lifecycle.state === 'portia_running') {
            requireCurrentLifecycleExecution(terminal, lifecycle)
          } else {
            requireCurrentReviewedGate(terminal, lifecycle)
            await requireApprovedAnswerPayload(
              dependencies,
              input.ownerId,
              terminal,
              lifecycle,
            )
          }
          lifecycle = await reconcileRunningLifecycleModel(
            dependencies,
            input.ownerId,
            terminal,
            lifecycle,
          )
        }
        return concludeInsufficientBasisGate(
          dependencies,
          input.ownerId,
          game,
          lifecycle,
        )
      })
    },

    runPortia(input) {
      return apiOperation(async () => {
        const terminal = await dependencies.repository.getTerminalReplay(
          input.ownerId,
          input.gameId,
        )
        if (terminal.revision !== input.expectedRevision) {
          throw new ApiError(
            'CONFLICT',
            409,
            'The game revision changed before Portia began.',
          )
        }
        const storedLifecycle = await requireLifecycleRepository(dependencies)
          .getForGame(input.ownerId, terminal.id)
        const baseLifecycle = requireCurrentLifecycleBase(
          terminal,
          storedLifecycle,
        )
        const existingDirectionalRecord =
          baseLifecycle.versions.trajectoryDirectionalRecord ===
            CURRENT_LIFECYCLE_VERSIONS.trajectoryDirectionalRecord
            ? requireCurrentLifecycleExecution(
                terminal,
                baseLifecycle,
              ).trajectoryDirectionalRecord
            : undefined
        requireCurrentPortiaProgress(
          baseLifecycle,
          existingDirectionalRecord,
        )
        let lifecycle = await preparePortia(
          dependencies,
          input.ownerId,
          terminal,
        )
        lifecycle = await concludeInsufficientBasisGate(
          dependencies,
          input.ownerId,
          terminal,
          lifecycle,
        )
        if (lifecycle.state === 'portia_running') {
          lifecycle = await reconcileRunningLifecycleModel(
            dependencies,
            input.ownerId,
            terminal,
            lifecycle,
          )
          if (lifecycle.state === 'portia_running') {
            throw pendingConflict('portia')
          }
        }
        if (lifecycle.state === 'portia_complete' && lifecycle.portia) {
          return commitPortiaAndGate(
            dependencies,
            input.ownerId,
            terminal,
            lifecycle,
            lifecycle.id,
            canonicalHash({
              operation: 'portia/v4-directional-recovery',
              gameId: terminal.id,
              terminalFingerprint: lifecycle.terminalFingerprint,
              trajectoryDirectionalRecordVersion:
                lifecycle.trajectoryDirectionalRecord!.version,
              trajectoryDirectionalRecordDigest:
                lifecycle.trajectoryDirectionalRecord!.digest,
            }),
            lifecycle.portia,
          )
        }
        if (
          lifecycle.portia &&
          lifecycle.gate &&
          lifecycle.state !== 'portia_pending'
        ) {
          return lifecycle
        }
        if (
          lifecycle.state !== 'portia_pending'
        ) {
          throw new ApiError(
            'CONFLICT',
            409,
            'Portia cannot run from the current lifecycle state.',
          )
        }

        if (dependencies.researchBroker) {
          const research = await dependencies.researchBroker.ensureForStage({
            ownerId: input.ownerId,
            gameId: terminal.id,
            lifecycleRunId: lifecycle.id,
            lifecycleState: lifecycle.state,
            stage: 'portia',
            problem: terminal.problem,
            researchConsent: terminal.researchConsent,
          })
          if (research.status === 'searching') {
            throw pendingConflict('portia')
          }
          const refreshed = await requireLifecycleRepository(dependencies)
            .getForGame(input.ownerId, terminal.id)
          if (!refreshed) {
            throw new ApiError(
              'INTERNAL_ERROR',
              500,
              'The lifecycle disappeared after research completed.',
            )
          }
          lifecycle = refreshed
        }

        const generator = dependencies.portiaGenerator
        if (!generator) {
          throw serviceUnavailable('The Portia model stage is not configured.')
        }

        const current = requireCurrentLifecycleExecution(terminal, lifecycle)
        requireCurrentPortiaProgress(
          lifecycle,
          current.trajectoryDirectionalRecord,
        )
        await dependencies.usage.reconcileExpiredLeases()
        const answerPrompt = boardAnswerPromptPlan(terminal, lifecycle)
        const portiaInput: PortiaInput = {
          problem: terminal.problem,
          survivors: lifecycle.survivors,
          answerPromptPackage: answerPrompt.plan,
          answerPromptDigest: answerPrompt.digest,
          completedAssessments: lifecycle.portiaProgress.completedAssessments,
        }
        const requestSha256 = canonicalHash({
          operation: 'portia/v4-directional',
          gameId: terminal.id,
          terminalFingerprint: answerPrompt.plan.terminalFingerprint,
          input: {
            problem: portiaInput.problem,
            survivors: portiaInput.survivors,
            answerPromptPackage: portiaInput.answerPromptPackage,
            answerPromptDigest: portiaInput.answerPromptDigest,
          },
          model: modelName(dependencies),
          promptVersion: CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
          contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
        })
        const reservation = await dependencies.usage.reserveModelRequest({
          requestId: input.requestId,
          gameId: terminal.id,
          userId: input.ownerId,
          operation: 'portia',
          idempotencyKey: input.idempotencyKey,
          requestSha256,
          provider: modelProvider(dependencies),
          model: modelName(dependencies),
          promptVersion: CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
          softwareVersion: dependencies.softwareVersion,
          countsAsGameStart: false,
          ipAddress: input.ipAddress,
        })
        if (!reservation.ok) throw usageError(reservation)

        if (reservation.kind === 'existing') {
          const found = await dependencies.usage.getModelRequestResult({
            userId: input.ownerId,
            requestId: reservation.requestId,
          })
          const winning = await winningResult(
            dependencies.usage,
            input.ownerId,
            terminal.id,
            'portia',
            found,
            {
              requestSha256,
              promptVersion: CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
            },
          )
          if (
            winning.found &&
            winning.status === 'succeeded' &&
            winning.resultPayload
          ) {
            return commitPortiaAndGate(
              dependencies,
              input.ownerId,
              terminal,
              lifecycle,
              winning.requestId,
              requestSha256,
              portiaPayload(winning.resultPayload).review,
            )
          }
          if (
            winning.found &&
            (winning.status === 'reserved' || winning.status === 'in_progress')
          ) {
            throw pendingConflict('portia')
          }
          return lifecycle
        }

        const leaseToken = requireLease(reservation)
        const began = await dependencies.usage.beginProviderCall({
          userId: input.ownerId,
          requestId: reservation.requestId,
          leaseToken,
        })
        if (!began.ok) throw beginProviderCallError(began, 'portia')
        lifecycle = await requireLifecycleRepository(dependencies)
          .beginPortiaAttempt({
          ownerId: input.ownerId,
          gameId: terminal.id,
          expectedRevision: lifecycle.revision,
          modelRequestId: reservation.requestId,
          requestDigest: requestSha256,
          answerPromptDigest: answerPrompt.digest,
          activityType: 'adversarial_review_started',
          configurationDigest: lifecycleConfigurationDigest(terminal),
        })
        const providerSignal = durableProviderSignal()
        let generated: Awaited<ReturnType<typeof generatePortiaReview>>
        try {
          generated = await generator(portiaInput, {
            userId: input.ownerId,
            safetyHmacSecret: dependencies.hmacSecret,
            signal: providerSignal,
            idempotencyKey: providerIdempotencyKey(
              dependencies.hmacSecret,
              input.ownerId,
              'portia',
              input.idempotencyKey,
            ),
            onProgress: async (progress) => {
              const renewed = await dependencies.usage.beginProviderCall({
                userId: input.ownerId,
                requestId: reservation.requestId,
                leaseToken,
              })
              if (!renewed.ok) {
                throw beginProviderCallError(renewed, 'portia')
              }
              const known = new Set(
                lifecycle.survivors.map((candidate) => candidate.candidateId),
              )
              if (
                progress.totalCandidateCount !== lifecycle.survivors.length ||
                (progress.currentCandidateId !== null &&
                  !known.has(progress.currentCandidateId)) ||
                progress.completedCandidateIds.some(
                  (candidateId) => !known.has(candidateId),
                )
              ) {
                throw new ModelContractError(
                  'Portia reported progress for an unknown board signal.',
                )
              }
              try {
                requireCurrentPortiaProgress(
                  {
                    ...lifecycle,
                    portiaProgress: {
                      currentCandidateId: progress.currentCandidateId,
                      completedCandidateIds: progress.completedCandidateIds,
                      completedAssessments: progress.completedAssessments,
                    },
                  },
                  current.trajectoryDirectionalRecord,
                )
                const expectedCurrentCandidateId = orderPortiaCandidates(
                  lifecycle.survivors,
                )[progress.completedAssessments.length]?.candidateId ?? null
                if (progress.currentCandidateId !== expectedCurrentCandidateId) {
                  throw new Error(
                    'Portia progress did not identify the next canonical survivor.',
                  )
                }
              } catch (error) {
                throw new ModelContractError(
                  'Portia reported invalid current directional progress.',
                  { cause: error },
                )
              }
              lifecycle = await requireLifecycleRepository(dependencies)
                .updatePortiaProgress({
                  ownerId: input.ownerId,
                  gameId: terminal.id,
                  expectedRevision: lifecycle.revision,
                  modelRequestId: reservation.requestId,
                  answerPromptDigest: answerPrompt.digest,
                  currentCandidateId: progress.currentCandidateId,
                  completedCandidateIds: progress.completedCandidateIds,
                  completedAssessments: progress.completedAssessments,
                })
            },
          })
        } catch (error) {
          const settled = await settleDefinitiveFailure(dependencies, {
            ownerId: input.ownerId,
            reservation,
            leaseToken,
            error,
            signal: providerSignal,
          })
          if (settled) {
            lifecycle = await transitionAfterPortiaProviderFailure(
              dependencies,
              input.ownerId,
              terminal,
              lifecycle,
              reservation.requestId,
              requestSha256,
              'adversarial_review_failed',
            )
            if (lifecycle.state === 'portia_unavailable') return lifecycle
          }
          throw error
        }
        const stored = PortiaResultPayloadSchema.parse({
          format: 'webchess-portia-result/1',
          review: generated.result,
        })
        const payload = modelResultPayload(stored)
        const settled = await dependencies.usage.settleModelRequest({
          userId: input.ownerId,
          requestId: reservation.requestId,
          leaseToken,
          outcome: 'succeeded',
          usage: providerUsage(generated),
          ...(generated.providerId === null
            ? {}
            : { providerResponseId: generated.providerId }),
          responseSha256: canonicalHash(payload),
          resultPayload: payload,
        })
        let winning = stored
        if (!settled.ok) {
          const recovered = await recoverCommittedResult(
            dependencies,
            input.ownerId,
            terminal.id,
            'portia',
            {
              requestSha256,
              promptVersion: CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
            },
          )
          if (!recovered.found || recovered.status !== 'succeeded') {
            throw new ApiError(
              'INTERNAL_ERROR',
              500,
              'The Portia result could not be committed safely.',
            )
          }
          winning = portiaPayload(recovered.resultPayload)
        }
        return commitPortiaAndGate(
          dependencies,
          input.ownerId,
          terminal,
          lifecycle,
          reservation.requestId,
          requestSha256,
          winning.review,
        )
      })
    },

    runCharlotte(input) {
      return apiOperation(async () => {
        const terminal = await dependencies.repository.getTerminalReplay(
          input.ownerId,
          input.gameId,
        )
        if (terminal.revision !== input.expectedRevision) {
          throw new ApiError(
            'CONFLICT',
            409,
            'The game revision changed before Charlotte began.',
          )
        }
        const storedLifecycle = await requireLifecycleRepository(dependencies)
          .getForGame(input.ownerId, terminal.id)
        const approvedLifecycle = requireCurrentReviewedGate(
          terminal,
          storedLifecycle,
        )
        let lifecycle = approvedLifecycle.lifecycle
        await requireApprovedAnswerPayload(
          dependencies,
          input.ownerId,
          terminal,
          lifecycle,
        )
        if (lifecycle.state === 'charlotte_unavailable') return lifecycle
        if (
          lifecycle.charlotte &&
          lifecycle.state !== 'charlotte_pending' &&
          lifecycle.state !== 'charlotte_running'
        ) {
          await requireApprovedCharlottePayload(
            dependencies,
            input.ownerId,
            terminal,
            lifecycle,
          )
          return lifecycle
        }
        const portia = approvedLifecycle.portia
        const gate = approvedLifecycle.gate
        if (
          !portia ||
          portia.contractVersion !== CURRENT_LIFECYCLE_VERSIONS.portiaContract ||
          !gate?.passed ||
          !terminal.answer
        ) {
          throw new ApiError(
            'CONFLICT',
            409,
            'Charlotte requires the persisted board answer, Portia review, and passed Gate.',
          )
        }
        const reviewedPromptDigest = lifecycle.answerPromptDigest
        if (
          !reviewedPromptDigest ||
          portia.reviewedAnswerPromptDigest !== reviewedPromptDigest
        ) {
          throw new ApiError(
            'CONFLICT',
            409,
            'Charlotte cannot qualify an answer whose reviewed prompt provenance changed.',
          )
        }
        if (lifecycle.state === 'gate_passed') {
          lifecycle = await requireLifecycleRepository(dependencies).transition({
            ownerId: input.ownerId,
            gameId: terminal.id,
            expectedRevision: lifecycle.revision,
            to: 'charlotte_pending',
            stage: 'charlotte',
            activityType: 'qualification_authorized',
            inputEntityIds: [terminal.id],
            responsibleAgentIds: ['answer', 'charlotte'],
            configurationDigest: lifecycleConfigurationDigest(terminal),
          })
        }
        if (
          lifecycle.state !== 'charlotte_pending' &&
          lifecycle.state !== 'charlotte_running'
        ) {
          throw new ApiError(
            'CONFLICT',
            409,
            'Charlotte cannot run from the current lifecycle state.',
          )
        }

        const generator = dependencies.charlotteGenerator
        if (!generator) {
          throw serviceUnavailable('The Charlotte model stage is not configured.')
        }

        await dependencies.usage.reconcileExpiredLeases()
        const answerPromptPlan = approvedLifecycle.answerPrompt.plan
        const researchEvidence = answerPromptPlan.researchEvidence
        const trajectoryDirectionalRecord =
          approvedLifecycle.trajectoryDirectionalRecord
        const modelInput: CharlotteInput = {
          problem: terminal.problem,
          boardAnswer: terminal.answer,
          boardAnswerDigest: canonicalHash(terminal.answer),
          reviewedPromptDigest,
          portia,
          gate,
          ...(researchEvidence?.length ? { researchEvidence } : {}),
          ...(trajectoryDirectionalRecord
            ? { trajectoryDirectionalRecord }
            : {}),
        }
        const requestSha256 = canonicalHash({
          operation: 'charlotte/v4-directional',
          gameId: terminal.id,
          input: modelInput,
          model: modelName(dependencies),
          promptVersion: CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
          contractVersion: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
        })
        const reservation = await dependencies.usage.reserveModelRequest({
          requestId: input.requestId,
          gameId: terminal.id,
          userId: input.ownerId,
          operation: 'charlotte',
          idempotencyKey: input.idempotencyKey,
          requestSha256,
          provider: modelProvider(dependencies),
          model: modelName(dependencies),
          promptVersion: CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
          softwareVersion: dependencies.softwareVersion,
          countsAsGameStart: false,
          ipAddress: input.ipAddress,
        })
        if (!reservation.ok) throw usageError(reservation)
        if (reservation.kind === 'existing') {
          const found = await dependencies.usage.getModelRequestResult({
            userId: input.ownerId,
            requestId: reservation.requestId,
          })
          const winning = await winningResult(
            dependencies.usage,
            input.ownerId,
            terminal.id,
            'charlotte',
            found,
            {
              requestSha256,
              promptVersion: CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
            },
          )
          if (
            winning.found &&
            winning.status === 'succeeded' &&
            winning.resultPayload
          ) {
            return commitCharlotte(
              dependencies,
              input.ownerId,
              terminal,
              lifecycle,
              winning.requestId,
              requestSha256,
              charlottePayload(winning.resultPayload),
            )
          }
          if (
            winning.found &&
            (winning.status === 'reserved' || winning.status === 'in_progress')
          ) {
            throw pendingConflict('charlotte')
          }
          if (lifecycle.state === 'charlotte_running') {
            if (
              lifecycle.charlotteActiveModelRequestId !==
              reservation.requestId
            ) {
              throw new ApiError(
                'INTERNAL_ERROR',
                500,
                'Charlotte’s saved provider attempt does not match the idempotent request.',
              )
            }
            lifecycle = await transitionAfterCharlotteProviderFailure(
              dependencies,
              input.ownerId,
              terminal,
              lifecycle,
              reservation.requestId,
              requestSha256,
              'qualification_recovered_for_retry',
            )
          }
          return lifecycle
        }

        const leaseToken = requireLease(reservation)
        const began = await dependencies.usage.beginProviderCall({
          userId: input.ownerId,
          requestId: reservation.requestId,
          leaseToken,
        })
        if (!began.ok) throw beginProviderCallError(began, 'charlotte')
        lifecycle = await requireLifecycleRepository(dependencies)
          .beginCharlotteAttempt({
          ownerId: input.ownerId,
          gameId: terminal.id,
          expectedRevision: lifecycle.revision,
          modelRequestId: reservation.requestId,
          requestDigest: requestSha256,
          activityType: 'qualification_started',
          configurationDigest: lifecycleConfigurationDigest(terminal),
        })
        const providerSignal = durableProviderSignal()
        let generated: ModelGeneration<CharlotteGenerationResult>
        try {
          generated = await generator(modelInput, {
            userId: input.ownerId,
            safetyHmacSecret: dependencies.hmacSecret,
            signal: providerSignal,
            idempotencyKey: providerIdempotencyKey(
              dependencies.hmacSecret,
              input.ownerId,
              'charlotte',
              input.idempotencyKey,
            ),
          })
        } catch (error) {
          const settled = await settleDefinitiveFailure(dependencies, {
            ownerId: input.ownerId,
            reservation,
            leaseToken,
            error,
            signal: providerSignal,
          })
          if (settled) {
            lifecycle = await transitionAfterCharlotteProviderFailure(
              dependencies,
              input.ownerId,
              terminal,
              lifecycle,
              reservation.requestId,
              requestSha256,
              'qualification_failed',
            )
            if (lifecycle.state === 'charlotte_unavailable') return lifecycle
          }
          throw error
        }
        const stored = ApprovedCharlotteResultPayloadSchema.parse({
          format: 'webchess-charlotte-result/3',
          ...generated.result,
          source: {
            lifecycleRunId: lifecycle.id,
            boardAnswerDigest: modelInput.boardAnswerDigest,
            reviewedPromptDigest,
            gateInputDigest: gate.inputDigest,
            ...directionalResultSource(trajectoryDirectionalRecord),
          },
        })
        const payload = modelResultPayload(stored)
        const settled = await dependencies.usage.settleModelRequest({
          userId: input.ownerId,
          requestId: reservation.requestId,
          leaseToken,
          outcome: 'succeeded',
          usage: providerUsage(generated),
          ...(generated.providerId === null
            ? {}
            : { providerResponseId: generated.providerId }),
          responseSha256: canonicalHash(payload),
          resultPayload: payload,
        })
        let winning = stored
        if (!settled.ok) {
          const recovered = await recoverCommittedResult(
            dependencies,
            input.ownerId,
            terminal.id,
            'charlotte',
            {
              requestSha256,
              promptVersion: CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
            },
          )
          if (!recovered.found || recovered.status !== 'succeeded') {
            throw new ApiError(
              'INTERNAL_ERROR',
              500,
              'The Charlotte result could not be committed safely.',
            )
          }
          winning = ApprovedCharlotteResultPayloadSchema.parse(
            recovered.resultPayload,
          )
        }
        return commitCharlotte(
          dependencies,
          input.ownerId,
          terminal,
          lifecycle,
          reservation.requestId,
          requestSha256,
          winning,
        )
      })
    },

    retryLifecycle(input) {
      return apiOperation(async () => {
        const repository = requireLifecycleRepository(dependencies)
        const terminal = await dependencies.repository.getTerminalReplay(
          input.ownerId,
          input.gameId,
        )
        const storedLifecycle = await repository.getForGame(
          input.ownerId,
          terminal.id,
        )
        const reviewedLifecycle = requireCurrentReviewedGate(
          terminal,
          storedLifecycle,
        )
        const inheritedWebMemory = await repository.getWebMemoryEvidenceForGame(
          input.ownerId,
          terminal.id,
        )
        const inheritedObservationIds = inheritedWebMemory.map(
          (evidence) => evidence.observationId,
        )
        if (terminal.revision !== input.expectedRevision) {
          throw new ApiError('CONFLICT', 409, 'The game revision changed before Retry began.')
        }
        let lifecycle = reviewedLifecycle.lifecycle
        const trajectoryDirectionalRecord =
          reviewedLifecycle.trajectoryDirectionalRecord
        const promptBoundPortia = reviewedLifecycle.portia
        const retryAlreadyRunning = lifecycle.state === 'retry_running'
        const reopeningTerminal = canReopenInsufficientBasis(lifecycle)
          && promptBoundPortia !== null
        if (
          (!retryAlreadyRunning &&
            lifecycle.state !== 'gate_failed' &&
            !reopeningTerminal)
          || !lifecycle.gate
        ) {
          throw new ApiError('CONFLICT', 409, 'Retry requires a failed deterministic Gate.')
        }
        const failedGate = reopeningTerminal
          ? evaluateGate(promptBoundPortia, {
              sameFieldRetryCount: lifecycle.sameFieldRetryCount,
              fieldRegenerationCount: lifecycle.fieldRegenerationCount,
            }, trajectoryDirectionalRecord)
          : lifecycle.gate
        const duplicateTerminalFingerprint = lifecycle.terminalFingerprint
          ? await repository.hasPriorTerminalFingerprint(
              input.ownerId,
              lifecycle.rootRunId,
              lifecycle.terminalFingerprint,
              lifecycle.id,
            )
          : false
        const decision = decideRetry({
          gate: failedGate,
          sameFieldRetryCount: lifecycle.sameFieldRetryCount,
          fieldRegenerationCount: lifecycle.fieldRegenerationCount,
          duplicateTerminalFingerprint,
        })
        const repairContext = decision.mode === 'regenerate_field'
          ? fieldRepairContext(lifecycle, failedGate)
          : null
        const regeneratedFieldRequestSha256 = repairContext
          ? canonicalHash({
              operation: 'division/v2-field-retry',
              problem: terminal.problem,
              repairContext,
              memoryObservationIds: inheritedObservationIds,
              sourceGameId: terminal.id,
              fieldGeneration: lifecycle.fieldGeneration + 1,
              model: modelName(dependencies),
              promptVersion: DIVISION_PROMPT_VERSION,
              softwareVersion: dependencies.softwareVersion,
            })
          : null

        if (retryAlreadyRunning) {
          const retryMode = decision.mode
          if (retryMode === 'insufficient_basis') {
            throw new ApiError(
              'CONFLICT',
              409,
              'Retry is already running under a different idempotency target.',
            )
          }
          let child: DurableGameSnapshot | null = null
          if (
            retryMode === 'regenerate_field' &&
            repairContext
          ) {
            const existingRequest = await dependencies.usage
              .getModelRequestByIdempotencyKey({
                userId: input.ownerId,
                operation: 'division',
                idempotencyKey: input.idempotencyKey,
              })
            if (!existingRequest.found) {
              throw new ApiError(
                'CONFLICT',
                409,
                'Retry is already running under a different idempotency target.',
              )
            }
            const existingRequestSha256 = canonicalHash({
              operation: 'division/v2-field-retry',
              problem: terminal.problem,
              repairContext,
              memoryObservationIds: inheritedObservationIds,
              sourceGameId: terminal.id,
              fieldGeneration: lifecycle.fieldGeneration + 1,
              model: modelName(dependencies),
              promptVersion: DIVISION_PROMPT_VERSION,
              softwareVersion: dependencies.softwareVersion,
            })
            const payload = currentDivisionPayload(existingRequest.resultPayload)
            if (
              existingRequest.gameId !== existingRequest.requestId ||
              existingRequest.operation !== 'division' ||
              existingRequest.requestSha256 !== existingRequestSha256 ||
              existingRequest.promptVersion !== DIVISION_PROMPT_VERSION ||
              existingRequest.status !== 'succeeded' ||
              !payload ||
              payload.seed !== existingRequest.requestId
            ) {
              throw new ApiError(
                'CONFLICT',
                409,
                'Retry is already running under a different idempotency target.',
              )
            }
            child = await dependencies.repository.getOwnedGame(
              input.ownerId,
              existingRequest.gameId,
            )
            requireExactCurrentMappedDivision(
              child,
              payload,
              existingRequest.requestId,
            )
          } else if (retryMode === 'replay_game') {
            try {
              child = await dependencies.repository.getOwnedGame(
                input.ownerId,
                input.idempotencyKey,
              )
            } catch (error) {
              if (!isGameRepositoryError(error) || error.code !== 'not-found') {
                throw error
              }
            }
            if (child) requireExactSameFieldReplay(terminal, child)
          }
          const existingChildLifecycle = child
            ? await repository.getForGame(input.ownerId, child.id)
            : null
          if (!child || !existingChildLifecycle) {
            throw new ApiError(
              'CONFLICT',
              409,
              'Retry is already running under a different idempotency target.',
            )
          }
          return {
            game: publicGame(child),
            lifecycle: requireExactRetryChildLifecycle(
              lifecycle,
              child,
              existingChildLifecycle,
              retryMode,
              decision.reason,
            ),
          }
        }
        if (decision.mode === 'insufficient_basis') {
          lifecycle = await repository.transition({
            ownerId: input.ownerId,
            gameId: terminal.id,
            expectedRevision: lifecycle.revision,
            to: 'insufficient_basis',
            stage: 'retry',
            activityType: 'retry_budget_exhausted',
            status: 'refused',
            inputEntityIds: [terminal.id],
            responsibleAgentIds: ['retry-policy'],
            configurationDigest: lifecycleConfigurationDigest(terminal),
          })
          return { game: null, lifecycle }
        }

        let child: DurableGameSnapshot
        if (decision.mode === 'replay_game') {
          const allowed = await dependencies.usage.consumeReplayGameStart({
            userId: input.ownerId,
            sourceGameId: terminal.id,
            expectedRevision: terminal.revision,
            idempotencyKey: input.idempotencyKey,
            ipAddress: input.ipAddress,
          })
          if (!allowed.ok) throw usageError(allowed)
          child = await dependencies.repository.getOwnedGame(
            input.ownerId,
            allowed.gameId,
          )
        } else {
          if (!repairContext || !regeneratedFieldRequestSha256) {
            throw new ApiError(
              'INTERNAL_ERROR',
              500,
              'The regenerated field request could not be derived safely.',
            )
          }
          const requestSha256 = regeneratedFieldRequestSha256
          const reservation = await dependencies.usage.reserveModelRequest({
            requestId: input.requestId,
            gameId: null,
            userId: input.ownerId,
            operation: 'division',
            idempotencyKey: input.idempotencyKey,
            requestSha256,
            provider: modelProvider(dependencies),
            model: modelName(dependencies),
            promptVersion: DIVISION_PROMPT_VERSION,
            softwareVersion: dependencies.softwareVersion,
            countsAsGameStart: true,
            ipAddress: input.ipAddress,
          })
          if (!reservation.ok) throw usageError(reservation)
          let shell: DurableGameSnapshot | null = null
          let providerStarted = false
          let successCommitted = false
          try {
            const shellResult = await dependencies.repository
              .getOrCreateDivision({
                ownerId: input.ownerId,
                problem: terminal.problem,
                softwareVersion: dependencies.softwareVersion,
                gameId: reservation.requestId,
                sourceGameId: terminal.id,
            })
            shell = shellResult.game
            child = shell
            const attached = await dependencies.usage.attachModelRequestGame({
              userId: input.ownerId,
              requestId: reservation.requestId,
              gameId: child.id,
            })
            if (!attached.ok) {
              throw new ApiError('CONFLICT', 409, 'The regenerated field could not be linked safely.')
            }
            if (reservation.kind === 'existing') {
              child = await reconcilePendingGame(
                dependencies,
                input.ownerId,
                child,
                {
                  divisionRequestId: reservation.requestId,
                  divisionRequestSha256: requestSha256,
                },
              )
              if (child.status !== 'mapped') {
                if (child.status === 'dividing') throw pendingConflict('division')
                throw terminalModelFailure('division')
              }
              await requireCurrentMappedDivisionBinding(
                dependencies,
                input.ownerId,
                child,
                reservation.requestId,
                requestSha256,
              )
            } else {
              const leaseToken = requireLease(reservation)
              const began = await dependencies.usage.beginProviderCall({
                userId: input.ownerId,
                requestId: reservation.requestId,
                leaseToken,
              })
              if (!began.ok) throw beginProviderCallError(began, 'division')
              providerStarted = true
              const providerSignal = durableProviderSignal()
              let winning: CastDirectedDivisionResultPayload
              try {
                const generated = await dependencies.divisionGenerator(
                  {
                    problem: terminal.problem,
                    divisionSeed: reservation.requestId,
                    repairContext,
                    ...(inheritedWebMemory.length > 0
                      ? { webMemoryEvidence: inheritedWebMemory }
                      : {}),
                  },
                  {
                    userId: input.ownerId,
                    safetyHmacSecret: dependencies.hmacSecret,
                    signal: providerSignal,
                    idempotencyKey: providerIdempotencyKey(
                      dependencies.hmacSecret,
                      input.ownerId,
                      'division',
                      input.idempotencyKey,
                    ),
                  },
                )
                const stored = requireGeneratedCurrentDivisionPayload({
                  format: 'webchess-division-result/2',
                  promptVersion: CAST_DIRECTED_DIVISION_PROMPT_VERSION,
                  castBindingVersion: DIVISION_CAST_BINDING_VERSION,
                  seed: reservation.requestId,
                  facets: generated.result.facets,
                  model: generated.model,
                  prompt: generated.prompt,
                })
                const payload = modelResultPayload(stored)
                const settled = await dependencies.usage.settleModelRequest({
                  userId: input.ownerId,
                  requestId: reservation.requestId,
                  leaseToken,
                  outcome: 'succeeded',
                  usage: providerUsage(generated),
                  ...(generated.providerId === null
                    ? {}
                    : { providerResponseId: generated.providerId }),
                  responseSha256: canonicalHash(payload),
                  resultPayload: payload,
                })
                winning = stored
                if (!settled.ok) {
                  const recovered = await recoverCommittedResult(
                    dependencies,
                    input.ownerId,
                    child.id,
                    'division',
                    {
                      requestSha256,
                      promptVersion: DIVISION_PROMPT_VERSION,
                    },
                  )
                  if (
                    !recovered.found ||
                    recovered.status !== 'succeeded' ||
                    recovered.requestId !== reservation.requestId ||
                    recovered.gameId !== child.id ||
                    recovered.operation !== 'division' ||
                    recovered.requestSha256 !== requestSha256 ||
                    recovered.promptVersion !== DIVISION_PROMPT_VERSION
                  ) {
                    throw new ApiError('INTERNAL_ERROR', 500, 'The regenerated field could not be committed safely.')
                  }
                  const currentWinner = currentDivisionPayload(
                    recovered.resultPayload,
                  )
                  if (
                    !currentWinner ||
                    currentWinner.seed !== reservation.requestId
                  ) {
                    throw new ApiError('INTERNAL_ERROR', 500, 'The regenerated field could not be committed safely.')
                  }
                  winning = currentWinner
                }
                successCommitted = true
              } catch (error) {
                const settled = await settleDefinitiveFailure(dependencies, {
                  ownerId: input.ownerId,
                  reservation,
                  leaseToken,
                  error,
                  signal: providerSignal,
                  settleAmbiguous: true,
                })
                if (settled && shell) {
                  shell = await failDivisionForOwner(
                    dependencies.repository,
                    input.ownerId,
                    shell,
                  )
                }
                throw error
              }
              child = await finishDivisionForOwner(
                dependencies.repository,
                input.ownerId,
                child,
                winning,
              )
              requireExactCurrentMappedDivision(
                child,
                winning,
                reservation.requestId,
              )
            }
          } catch (error) {
            if (reservation.kind === 'reserved' && !providerStarted) {
              await releaseBeforeProvider(
                dependencies.usage,
                reservation,
                input.ownerId,
              )
              if (shell) {
                await failBeforeProviderWithoutMaskingDeletion(() =>
                  failDivisionForOwner(
                    dependencies.repository,
                    input.ownerId,
                    shell!,
                  ),
                )
              }
            } else if (successCommitted) {
              // Exact current Division evidence remains authoritative; never
              // rewrite the child as failed after its provider result commits.
            }
            throw error
          }
        }
        if (decision.mode === 'replay_game') {
          requireExactSameFieldReplay(terminal, child)
        }
        const existingChildLifecycle = await repository.getForGame(
          input.ownerId,
          child.id,
        )
        if (existingChildLifecycle) {
          return {
            game: publicGame(child),
            lifecycle: requireExactRetryChildLifecycle(
              lifecycle,
              child,
              existingChildLifecycle,
              decision.mode,
              decision.reason,
            ),
          }
        }
        if (inheritedObservationIds.length > 0) {
          await repository.attachWebMemoryEvidence(
            input.ownerId,
            child.id,
            inheritedObservationIds,
          )
        }
        lifecycle = await repository.createRetryRun({
          ownerId: input.ownerId,
          parentGameId: terminal.id,
          childGame: child,
          trajectorySeed: child.id,
          mode: decision.mode,
          reason: decision.reason,
          configurationDigest: lifecycleConfigurationDigest(child),
        })
        return { game: publicGame(child), lifecycle }
      })
    },

    getProvenance(input) {
      return apiOperation(async () => {
        const lifecycle = await requireLifecycleRepository(dependencies)
          .getForGame(input.ownerId, input.gameId)
        if (!lifecycle) {
          throw new ApiError('LIFECYCLE_NOT_FOUND', 404, 'Lifecycle provenance not found.')
        }
        return lifecycle.activities
      })
    },

    createWilburAction(input) {
      return apiOperation(async () => {
        const repository = requireLifecycleRepository(dependencies)
        const storedLifecycle = await repository.getForGame(
          input.ownerId,
          input.gameId,
        )
        if (!storedLifecycle) {
          throw new ApiError(
            'LIFECYCLE_NOT_FOUND',
            404,
            'Lifecycle provenance not found.',
          )
        }
        const lifecycle = await requireCurrentWilburExecution(
          dependencies,
          input.ownerId,
          input.gameId,
          storedLifecycle,
        )
        const suggestion = canonicalCharlotteActionForWilbur(lifecycle, input)
        const requestDigest = canonicalHash({
          operation: 'wilbur-action/v3',
          gameId: input.gameId,
          charlotteActionIndex: input.charlotteActionIndex,
          actor: suggestion.actor,
          action: suggestion.smallestAction,
          testedAssumption: suggestion.assumptionBeingTested,
          expectedObservation: suggestion.expectedObservation,
          decisionThreshold: suggestion.decisionThreshold,
          reviewHorizon: suggestion.reviewHorizon,
          followUpAt: input.followUpAt ?? null,
        })
        const claimInput = {
          ownerId: input.ownerId,
          gameId: input.gameId,
          actionId: null,
          idempotencyKey: input.idempotencyKey,
          operation: 'create_action' as const,
          requestDigest,
          rateKind: 'action' as const,
          reservedFutureRows: 2 as const,
          reservedTextBytes: utf8Bytes([
            suggestion.actor,
            suggestion.smallestAction,
            suggestion.assumptionBeingTested,
            suggestion.expectedObservation,
            suggestion.decisionThreshold,
            suggestion.reviewHorizon,
          ]),
          storageRowLimit: dependencies.wilburStorageRowLimit,
          storageTextBytesLimit: dependencies.wilburStorageTextBytesLimit,
        }
        let claim = await repository.claimWilburMutation(claimInput)
        if (claim.kind === 'committed' && 'action' in claim) {
          return claim.action
        }
        if (lifecycle.wilburActions.some((action) =>
          action.charlotteBindingVersion ===
            CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION &&
          action.charlotteActionIndex === input.charlotteActionIndex)) {
          await repository.settleWilburMutationConflict(claimInput)
          throw new ApiError(
            'CONFLICT',
            409,
            'That Charlotte suggestion already has a current Wilbur action.',
          )
        }

        const allowed = await dependencies.usage.consumeWilburMutationRate({
          userId: input.ownerId,
          ipAddress: input.ipAddress,
          kind: 'action',
          operation: 'create_action',
          idempotencyKey: input.idempotencyKey,
          requestDigest,
        })
        if (!allowed.ok) throw usageError(allowed)

        claim = await repository.claimWilburMutation(claimInput)
        if (claim.kind === 'committed' && 'action' in claim) {
          return claim.action
        }

        try {
          return await repository.createWilburAction({
          ownerId: input.ownerId,
          gameId: input.gameId,
          id: input.requestId,
          idempotencyKey: input.idempotencyKey,
          requestDigest,
          charlotteActionIndex: input.charlotteActionIndex,
          actor: suggestion.actor,
          action: suggestion.smallestAction,
          testedAssumption: suggestion.assumptionBeingTested,
          expectedObservation: suggestion.expectedObservation,
          decisionThreshold: suggestion.decisionThreshold,
          reviewHorizon: suggestion.reviewHorizon,
          followUpAt: input.followUpAt ?? null,
          configurationDigest: canonicalHash(CURRENT_LIFECYCLE_VERSIONS),
          })
        } catch (error) {
          if (!isLifecycleRepositoryError(error) || error.code !== 'conflict') {
            throw error
          }
          const recovered = await repository.claimWilburMutation(claimInput)
          if (recovered.kind === 'committed' && 'action' in recovered) {
            return recovered.action
          }
          await repository.settleWilburMutationConflict(claimInput)
          const raced = await repository.claimWilburMutation(claimInput)
          if (raced.kind === 'committed' && 'action' in raced) {
            return raced.action
          }
          throw error
        }
      })
    },

    updateWilburAction(input) {
      return apiOperation(async () => {
        const repository = requireLifecycleRepository(dependencies)
        const storedLifecycle = await repository.getForGame(
          input.ownerId,
          input.gameId,
        )
        if (!storedLifecycle) {
          throw new ApiError('LIFECYCLE_NOT_FOUND', 404, 'Wilbur action not found.')
        }
        const lifecycle = await requireCurrentWilburExecution(
          dependencies,
          input.ownerId,
          input.gameId,
          storedLifecycle,
        )
        const currentAction = requireCurrentWilburAction(
          lifecycle,
          input.actionId,
        )
        const requestDigest = canonicalHash({
          operation: 'wilbur-action-status/v2',
          gameId: input.gameId,
          actionId: input.actionId,
          expectedRevision: input.expectedRevision,
          status: input.status,
          followUpAt: input.followUpAt ?? null,
        })
        const claimInput = {
          ownerId: input.ownerId,
          gameId: input.gameId,
          actionId: input.actionId,
          idempotencyKey: input.idempotencyKey,
          operation: 'update_action' as const,
          requestDigest,
          rateKind: 'action' as const,
          reservedFutureRows: 1 as const,
          reservedTextBytes: 0,
          storageRowLimit: dependencies.wilburStorageRowLimit,
          storageTextBytesLimit: dependencies.wilburStorageTextBytesLimit,
        }
        let claim = await repository.claimWilburMutation(claimInput)
        if (claim.kind === 'committed' && 'action' in claim) {
          return claim.action
        }
        if (currentAction.revision !== input.expectedRevision) {
          await repository.settleWilburMutationConflict(claimInput)
          throw new ApiError(
            'CONFLICT',
            409,
            'The Wilbur action revision changed before this update.',
          )
        }
        const allowed = await dependencies.usage.consumeWilburMutationRate({
          userId: input.ownerId,
          ipAddress: input.ipAddress,
          kind: 'action',
          operation: 'update_action',
          idempotencyKey: input.idempotencyKey,
          requestDigest,
        })
        if (!allowed.ok) throw usageError(allowed)

        claim = await repository.claimWilburMutation(claimInput)
        if (claim.kind === 'committed' && 'action' in claim) {
          return claim.action
        }
        try {
          return await repository.updateWilburAction({
            ownerId: input.ownerId,
            gameId: input.gameId,
            actionId: input.actionId,
            idempotencyKey: input.idempotencyKey,
            requestDigest,
            expectedRevision: input.expectedRevision,
            status: input.status,
            followUpAt: input.followUpAt ?? null,
            configurationDigest: canonicalHash(CURRENT_LIFECYCLE_VERSIONS),
          })
        } catch (error) {
          if (!isLifecycleRepositoryError(error) || error.code !== 'conflict') {
            throw error
          }
          const recovered = await repository.claimWilburMutation(claimInput)
          if (recovered.kind === 'committed' && 'action' in recovered) {
            return recovered.action
          }
          await repository.settleWilburMutationConflict(claimInput)
          const raced = await repository.claimWilburMutation(claimInput)
          if (raced.kind === 'committed' && 'action' in raced) {
            return raced.action
          }
          throw error
        }
      })
    },

    appendWilburObservation(input) {
      return apiOperation(async () => {
        const repository = requireLifecycleRepository(dependencies)
        const storedLifecycle = await repository.getForGame(
          input.ownerId,
          input.gameId,
        )
        if (!storedLifecycle) {
          throw new ApiError('LIFECYCLE_NOT_FOUND', 404, 'Wilbur action not found.')
        }
        const lifecycle = await requireCurrentWilburExecution(
          dependencies,
          input.ownerId,
          input.gameId,
          storedLifecycle,
        )
        requireCurrentWilburAction(lifecycle, input.actionId)
        const requestDigest = canonicalHash({
          operation: 'wilbur-observation/v2',
          gameId: input.gameId,
          actionId: input.actionId,
          observedAt: input.observedAt,
          observation: input.observation,
          evidenceClassification: input.evidenceClassification,
          expectedEffect: input.expectedEffect,
          unexpectedEffect: input.unexpectedEffect,
          stakeholderResponse: input.stakeholderResponse,
          assumptionResult: input.assumptionResult,
          nextDecision: input.nextDecision,
        })
        const claimInput = {
          ownerId: input.ownerId,
          gameId: input.gameId,
          actionId: input.actionId,
          idempotencyKey: input.idempotencyKey,
          operation: 'append_observation' as const,
          requestDigest,
          rateKind: 'observation' as const,
          reservedFutureRows: 2 as const,
          reservedTextBytes: utf8Bytes([
            input.observation,
            input.evidenceClassification,
            input.expectedEffect,
            input.unexpectedEffect,
            input.stakeholderResponse,
            input.assumptionResult,
            input.nextDecision,
          ]),
          storageRowLimit: dependencies.wilburStorageRowLimit,
          storageTextBytesLimit: dependencies.wilburStorageTextBytesLimit,
        }
        let claim = await repository.claimWilburMutation(claimInput)
        if (claim.kind === 'committed' && 'observation' in claim) {
          return claim.observation
        }
        const allowed = await dependencies.usage.consumeWilburMutationRate({
          userId: input.ownerId,
          ipAddress: input.ipAddress,
          kind: 'observation',
          operation: 'append_observation',
          idempotencyKey: input.idempotencyKey,
          requestDigest,
        })
        if (!allowed.ok) throw usageError(allowed)

        claim = await repository.claimWilburMutation(claimInput)
        if (claim.kind === 'committed' && 'observation' in claim) {
          return claim.observation
        }
        try {
          return await repository.appendWilburObservation({
          ownerId: input.ownerId,
          gameId: input.gameId,
          actionId: input.actionId,
          id: input.requestId,
          idempotencyKey: input.idempotencyKey,
          requestDigest,
          observedAt: input.observedAt,
          observation: input.observation,
          evidenceClassification: input.evidenceClassification,
          expectedEffect: input.expectedEffect,
          unexpectedEffect: input.unexpectedEffect,
          stakeholderResponse: input.stakeholderResponse,
          assumptionResult: input.assumptionResult,
          nextDecision: input.nextDecision,
          configurationDigest: canonicalHash(CURRENT_LIFECYCLE_VERSIONS),
          })
        } catch (error) {
          if (!isLifecycleRepositoryError(error) || error.code !== 'conflict') {
            throw error
          }
          const recovered = await repository.claimWilburMutation(claimInput)
          if (recovered.kind === 'committed' && 'observation' in recovered) {
            return recovered.observation
          }
          await repository.settleWilburMutationConflict(claimInput)
          const raced = await repository.claimWilburMutation(claimInput)
          if (raced.kind === 'committed' && 'observation' in raced) {
            return raced.observation
          }
          throw error
        }
      })
    },

    replay(input) {
      return apiOperation(async () => {
        const terminal = await dependencies.repository.getTerminalReplay(
          input.ownerId,
          input.gameId,
        )
        if (terminal.revision !== input.expectedRevision) {
          throw new ApiError(
            'CONFLICT',
            409,
            'The game revision changed before replay began.',
          )
        }
        const lifecycle = await requireLifecycleRepository(dependencies)
          .getForGame(input.ownerId, terminal.id)
        requireCurrentLifecycleExecution(terminal, lifecycle)

        const allowed = await dependencies.usage.consumeReplayGameStart({
          userId: input.ownerId,
          sourceGameId: input.gameId,
          expectedRevision: input.expectedRevision,
          idempotencyKey: input.idempotencyKey,
          ipAddress: input.ipAddress,
        })
        if (!allowed.ok) throw usageError(allowed)

        return publicGame(
          await dependencies.repository.getOwnedGame(
            input.ownerId,
            allowed.gameId,
          ),
        )
      })
    },

    abandon(input) {
      return apiOperation(async () =>
        publicGame(
          await dependencies.repository.abandonGame({
            ownerId: input.ownerId,
            gameId: input.gameId,
            expectedRevision: input.expectedRevision,
            idempotencyKey: input.idempotencyKey,
          }),
        ),
      )
    },

    exportCase(input: {
      ownerId: string
      gameId: string
      profile: WebChessCaseProfile
      ipAddress: string
      requestId: string
      signal: AbortSignal
    }) {
      return apiOperation(async () => {
        const allowed = await dependencies.usage.consumeAccountExportRate({
          userId: input.ownerId,
          ipAddress: input.ipAddress,
        })
        if (!allowed.ok) throw usageError(allowed)

        const results = await dependencies.database.transaction(
          caseBundleStatements(input.ownerId, input.gameId),
          {
            isolationLevel: 'RepeatableRead',
            readOnly: true,
          },
        )
        let sourceRows
        try {
          sourceRows = caseBundleRows(results)
        } catch (error) {
          if (error instanceof Error && error.message === 'CASE_GAME_NOT_FOUND') {
            throw new ApiError('GAME_NOT_FOUND', 404, 'Game not found.')
          }
          if (
            error instanceof Error &&
            error.message === 'CASE_LIFECYCLE_NOT_FOUND'
          ) {
            throw new ApiError(
              'LIFECYCLE_NOT_FOUND',
              409,
              'This game does not have a lifecycle record to export.',
            )
          }
          throw error
        }
        const bundle = createCaseBundle({
          ...sourceRows,
          profile: input.profile,
          exportedAt: new Date().toISOString(),
          packageName: 'webchess',
          packageVersion: WEBCHESS_SOFTWARE_VERSION,
          sourceCommit: dependencies.sourceCommit ?? null,
          runtimeArtifactSha256: dependencies.runtimeArtifactSha256 ?? null,
        })
        if (!verifyCaseBundle(bundle).ok) {
          throw new ApiError(
            'INTERNAL_ERROR',
            500,
            'The saved case could not be exported with verifiable integrity.',
          )
        }
        if (
          new TextEncoder().encode(`${JSON.stringify(bundle, null, 2)}\n`)
            .byteLength > dependencies.accountExportMaxBytes
        ) {
          throw new ApiError(
            'PAYLOAD_TOO_LARGE',
            413,
            'This WebChess case bundle is too large for the selected profile. Try a more restrictive profile.',
          )
        }
        return bundle
      })
    },

  }
  return services
}

/** Retained only as an explicit fail-closed compatibility export. */
export async function createApiServices(): Promise<WebChessApiServices> {
  throw serviceUnavailable(
    'The hosted and source-checkout service adapters are retired. Start the account-authenticated packed OpenClaw runtime.',
  )
}
