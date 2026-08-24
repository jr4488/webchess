import 'server-only'

import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from 'openai'
import { z } from 'zod'

import { composeProblemParts } from '../../lib/division'
import { GameRuleError } from '../../lib/game-replay'
import {
  CURRENT_LIFECYCLE_VERSIONS,
  CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION,
  WEBCHESS_SOFTWARE_VERSION,
  canReopenInsufficientBasis,
  charlotteResultSchema,
  decideRetry,
  deriveSurvivorCandidates,
  evaluateGate,
  isPromptBoundPortiaReview,
  portiaReviewSchema,
  terminalFingerprint,
  type GateResult,
  validatePortiaReview,
} from '../../lib/lifecycle'
import type { DurableGame } from '../../lib/webchess-api'
import { MAX_PERSISTED_MODEL_PROMPT_CHARS } from '../../types'
import {
  getDatabase,
  hashCanonicalJson,
  hmacSha256Hex,
  sha256Hex,
} from '../db'
import {
  isLocalHostedPostgresMigrationAuthorized,
  shouldUseLocalPostgresWireProtocol,
} from '../db/adapter-kind'
import {
  ensureLocalHostedSchema,
} from '../db/local-postgres'
import type {
  CanonicalJson,
  SqlAdapter,
  SqlRow,
  SqlStatement,
} from '../db'
import {
  DurableGameRepository,
  isGameRepositoryError,
  normalizeProblem,
} from '../games'
import type {
  DurableGameSnapshot,
  TerminalGameSnapshot,
} from '../games'
import {
  ANSWER_PROMPT_VERSION,
  buildBoardAnswerPromptPackage,
  buildPlayerVisibleAnswerPrompt,
  DIVISION_PROMPT_VERSION,
  DivisionFacetSchema,
  generateAnswer,
  generateCharlotteSynthesis,
  generateDivision,
  generatePortiaReview,
  ModelConfigurationError,
  ModelContractError,
  ModelInputError,
  ModelResponseError,
  normalizeDivisionRepairContext,
  OPENAI_MODEL,
  OPENAI_PROVIDER,
  parseServerDerivedEvidence,
} from '../openai'
import type {
  AnswerGenerationInput,
  BoardAnswerPromptPackage,
  CharlotteGenerationResult,
  CharlotteInput,
  DivisionRepairContext,
  ModelGeneration,
  PortiaInput,
  ServerDerivedEvidence,
} from '../openai'
import {
  DurableLifecycleRepository,
  isLifecycleRepositoryError,
} from '../lifecycle'
import type {
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
  createUsageController,
  hashUserRateKey,
  loadUsageConfig,
} from '../usage'
import {
  OpenClawAnswerContractError,
  OpenClawProviderError,
} from '../openclaw/errors'
import type {
  GetModelRequestResultResult,
  ModelOperation,
  ModelResultPayload,
  ModelReservation,
  ProviderCallTransitionFailure,
  ProviderTokenUsage,
  UsageController,
  UsageDenied,
} from '../usage'
import {
  ApiError,
  isApiError,
  SafePromptApiError,
  serviceUnavailable,
} from './errors'
import type { WebChessApiServices } from './ports'

const FALLBACK_SOFTWARE_VERSION = `webchess@${WEBCHESS_SOFTWARE_VERSION}`
const ACCOUNT_EXPORT_FORMAT = 'webchess-account-export/4'
const DEFAULT_ACCOUNT_EXPORT_MAX_BYTES = 3_000_000
const MAX_ACCOUNT_EXPORT_BYTES = 100_000_000
const DEFAULT_WILBUR_STORAGE_ROW_LIMIT = 500
const DEFAULT_WILBUR_STORAGE_TEXT_BYTES_LIMIT = 250_000
const ACCOUNT_EXPORT_GUARD_SETTING = 'webchess.account_export_allowed'

const DivisionResultPayloadSchema = z.strictObject({
  format: z.literal('webchess-division-result/1'),
  seed: z.string().trim().min(1).max(512),
  facets: z.array(DivisionFacetSchema).length(64),
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
  }),
})

const CharlotteResultPayloadSchema = z.discriminatedUnion('format', [
  LegacyCharlotteResultPayloadSchema,
  LegacyApprovedCharlotteResultPayloadSchema,
  ApprovedCharlotteResultPayloadSchema,
])

type DivisionResultPayload = z.infer<typeof DivisionResultPayloadSchema>
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
  readonly openAiApiKey?: string
  readonly requiresModelApiKey?: boolean
  readonly repository: GameRepositoryPort
  readonly lifecycleRepository?: LifecycleRepositoryPort
  readonly portiaGenerator?: typeof generatePortiaReview
  /** Local OpenClaw injects the durable Codex Search broker. */
  readonly researchBroker?: ResearchBrokerPort
  readonly softwareVersion: string
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

export function normalizeAccountExportMaxBytes(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_ACCOUNT_EXPORT_MAX_BYTES
  }

  const parsed = Number(value)
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_ACCOUNT_EXPORT_BYTES
  ) {
    throw serviceUnavailable(
      `The WebChess account export size limit must be between 1 and ${MAX_ACCOUNT_EXPORT_BYTES} bytes.`,
    )
  }
  return parsed
}

function normalizeWilburStorageLimit(
  value: string | undefined,
  label: string,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return Math.min(fallback, maximum)
  if (!/^[1-9]\d*$/u.test(value)) {
    throw serviceUnavailable(`${label} must be a positive integer.`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw serviceUnavailable(`${label} must be at most ${maximum}.`)
  }
  return parsed
}

function productionDependencies(
  database: SqlAdapter = getDatabase(),
): ApiServiceAdapterDependencies {
  const usageConfig = loadUsageConfig()
  const accountExportMaxBytes = normalizeAccountExportMaxBytes(
    process.env.WEBCHESS_ACCOUNT_EXPORT_MAX_BYTES,
  )
  // Reserve most of the synchronous export envelope for games, model records,
  // provenance, and JSON escaping. These limits bound only Wilbur's share; a
  // sufficiently large non-Wilbur account can still exceed synchronous export.
  const maximumWilburRows = Math.max(
    1,
    Math.floor(accountExportMaxBytes / (5 * 1_024)),
  )
  const maximumWilburTextBytes = Math.max(
    1,
    Math.floor(accountExportMaxBytes / 12),
  )

  return {
    accountExportMaxBytes,
    answerGenerator: generateAnswer,
    charlotteGenerator: generateCharlotteSynthesis,
    database,
    divisionGenerator: generateDivision,
    hmacSecret: usageConfig.hmacSecret,
    modelName: OPENAI_MODEL,
    modelProvider: OPENAI_PROVIDER,
    openAiApiKey: process.env.OPENAI_API_KEY,
    requiresModelApiKey: true,
    repository: new DurableGameRepository(database),
    lifecycleRepository: new DurableLifecycleRepository(database),
    portiaGenerator: generatePortiaReview,
    softwareVersion: normalizeSoftwareVersion(
      process.env.WEBCHESS_SOFTWARE_VERSION ||
        process.env.VERCEL_GIT_COMMIT_SHA,
    ),
    usage: createUsageController({
      db: database,
      config: usageConfig,
    }),
    wilburStorageRowLimit: normalizeWilburStorageLimit(
      process.env.WEBCHESS_WILBUR_STORAGE_ROW_LIMIT,
      'WEBCHESS_WILBUR_STORAGE_ROW_LIMIT',
      DEFAULT_WILBUR_STORAGE_ROW_LIMIT,
      maximumWilburRows,
    ),
    wilburStorageTextBytesLimit: normalizeWilburStorageLimit(
      process.env.WEBCHESS_WILBUR_STORAGE_TEXT_BYTES_LIMIT,
      'WEBCHESS_WILBUR_STORAGE_TEXT_BYTES_LIMIT',
      DEFAULT_WILBUR_STORAGE_TEXT_BYTES_LIMIT,
      maximumWilburTextBytes,
    ),
  }
}

function publicGame(snapshot: DurableGameSnapshot): DurableGame {
  return {
    id: snapshot.id,
    sourceGameId: snapshot.sourceGameId,
    revision: snapshot.revision,
    status: snapshot.status,
    problem: snapshot.problem,
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

function usageError(denial: UsageDenied): ApiError {
  const options = denial.retryAfterSeconds === null
    ? {}
    : { retryAfterSeconds: denial.retryAfterSeconds }

  if (
    denial.code === 'ACCOUNT_SUSPENDED' ||
    denial.code === 'ACCOUNT_TEMPORARILY_BLOCKED' ||
    denial.code === 'ACCOUNT_DELETED'
  ) {
    return new ApiError(
      'FORBIDDEN',
      403,
      'This WebChess account cannot perform that operation.',
      options,
    )
  }

  if (
    denial.code === 'GAME_START_DAILY_QUOTA_EXCEEDED' ||
    denial.code === 'MODEL_DAILY_QUOTA_EXCEEDED'
  ) {
    return new ApiError(
      'QUOTA_EXCEEDED',
      429,
      'This account has reached its current WebChess allowance.',
      options,
    )
  }

  if (
    denial.code === 'MODEL_GLOBAL_DAILY_CAPACITY' ||
    denial.code === 'MODEL_GLOBAL_CAPACITY'
  ) {
    return new ApiError(
      'SERVICE_UNAVAILABLE',
      503,
      'WebChess model capacity is temporarily unavailable.',
      options,
    )
  }

  if (
    denial.code === 'GAME_OWNERSHIP_CONFLICT' ||
    denial.code === 'IDEMPOTENCY_CONFLICT' ||
    denial.code === 'WILBUR_MUTATION_EXPIRED' ||
    denial.code === 'WILBUR_MUTATION_CONFLICT' ||
    denial.code === 'GAME_REVISION_CONFLICT' ||
    denial.code === 'GAME_INVALID_REPLAY_STATE'
  ) {
    return new ApiError(
      'CONFLICT',
      409,
      'That operation conflicts with existing durable state.',
      options,
    )
  }

  return new ApiError(
    'RATE_LIMITED',
    429,
    'Too many WebChess operations were requested. Please wait and try again.',
    options,
  )
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

function modelApiKey(
  dependencies: ApiServiceAdapterDependencies,
): string | undefined {
  const apiKey = dependencies.openAiApiKey?.trim()
  if (!apiKey && dependencies.requiresModelApiKey !== false) {
    throw serviceUnavailable('The WebChess model service is not configured.')
  }
  return apiKey
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

function divisionPayload(value: unknown): DivisionResultPayload {
  const parsed = DivisionResultPayloadSchema.safeParse(value)
  if (!parsed.success) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'The saved division result could not be verified.',
    )
  }
  return parsed.data
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
    payload.approval.gateInputDigest === lifecycle.gate.inputDigest,
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
    payload.source.gateInputDigest === lifecycle.gate.inputDigest,
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
  if (record.status === 'not_needed') return null
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
    status: record.status,
    model: record.model,
    untrusted: true,
    contentKind: 'model_generated_search_synthesis',
    directPageTextFetched: false,
    searchSynthesis: record.searchSynthesis,
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
  const plan = buildBoardAnswerPromptPackage(
    serverEvidence(snapshot),
    lifecycle.survivors,
    answerPromptFingerprint,
    lifecycle.research.flatMap((record) => {
      const evidence = researchPromptEvidence(record)
      return evidence ? [evidence] : []
    }),
    lifecycle.webMemoryEvidence,
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

async function ensurePlayerVisibleAnswerPrompt(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  snapshot: TerminalGameSnapshot,
  lifecycle: LifecycleAggregate,
): Promise<{
  readonly lifecycle: LifecycleAggregate
  readonly answerInput: AnswerGenerationInput
  readonly exactPromptAvailable: boolean
}> {
  const reviewed = boardAnswerPromptPlan(snapshot, lifecycle)
  const portia = lifecycle.portia
  const gate = lifecycle.gate
  if (
    !portia ||
    !isPromptBoundPortiaReview(portia) ||
    portia.promptDecision !== 'permit' ||
    !gate?.passed ||
    gate.recommendedNextTransition !== 'answer' ||
    lifecycle.answerPromptDigest !== reviewed.digest ||
    portia.reviewedAnswerPromptDigest !== reviewed.digest
  ) {
    throw new ApiError(
      'CONFLICT',
      409,
      'The exact board-derived answer prompt must be permitted by Portia and the Gate before generation.',
    )
  }

  const answerInput: AnswerGenerationInput = {
    plan: reviewed.plan,
    reviewedPromptDigest: reviewed.digest,
    portia,
    gate,
  }
  const playerVisiblePrompt = buildPlayerVisibleAnswerPrompt(answerInput)
  let ensured = lifecycle
  if (
    ensured.state === 'gate_passed' &&
    ensured.answerUserPrompt === null &&
    ensured.answerUserPromptSha256 === null
  ) {
    ensured = await requireLifecycleRepository(dependencies).storeGate({
      ownerId,
      gameId: snapshot.id,
      expectedRevision: ensured.revision,
      result: gate,
      answerUserPrompt: playerVisiblePrompt,
      configurationDigest: lifecycleConfigurationDigest(snapshot),
    })
  }

  if (
    ensured.answerUserPrompt === null &&
    ensured.answerUserPromptSha256 === null
  ) {
    // Completed histories created before prompt disclosure remain readable,
    // but are not retroactively assigned provenance they never persisted.
    return {
      lifecycle: ensured,
      answerInput,
      exactPromptAvailable: false,
    }
  }
  if (
    ensured.answerUserPrompt !== playerVisiblePrompt ||
    ensured.answerUserPromptSha256 !== sha256Hex(playerVisiblePrompt)
  ) {
    throw new ApiError(
      'CONFLICT',
      409,
      'The persisted player-visible Answer prompt does not match this Portia-approved generation.',
    )
  }
  return {
    lifecycle: ensured,
    answerInput,
    exactPromptAvailable: true,
  }
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

async function ensureLifecycleForNewGame(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  snapshot: DurableGameSnapshot,
): Promise<LifecycleAggregate> {
  return requireLifecycleRepository(dependencies).ensureForGame({
    ownerId,
    game: snapshot,
    trajectorySeed: snapshot.id,
  })
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
    })
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
): Promise<void> {
  if (reservation.kind !== 'reserved' || !reservation.leaseToken) return
  try {
    await usage.releaseReservation({
      userId: ownerId,
      requestId: reservation.requestId,
      leaseToken: reservation.leaseToken,
      reason: 'provider_not_started',
    })
  } catch {
    // An expiring lease is reconciled durably by the next reservation or poll.
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
      promptVersion: DIVISION_PROMPT_VERSION,
    })
  } catch (error) {
    if (!isGameRepositoryError(error) || error.code === 'not-found') throw error
    const current = await repository.getOwnedGame(ownerId, snapshot.id)
    if (current.status !== 'dividing') return current
    throw error
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
    readonly requestSha256: string
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

  if (direct.gameId === null && direct.status === 'reserved') {
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

async function reconcilePendingGame(
  dependencies: ApiServiceAdapterDependencies,
  ownerId: string,
  snapshot: DurableGameSnapshot,
): Promise<DurableGameSnapshot> {
  const operation: ModelOperation | null =
    snapshot.status === 'dividing'
      ? 'division'
      : snapshot.status === 'answering'
        ? 'answer'
        : null
  if (!operation) return snapshot

  await dependencies.usage.reconcileExpiredLeases()
  const found = operation === 'division'
    ? await findDivisionRequest(dependencies.usage, ownerId, snapshot.id)
    : await dependencies.usage.getLatestModelRequestForGame({
        userId: ownerId,
        gameId: snapshot.id,
        operation,
      })
  const result = await winningResult(
    dependencies.usage,
    ownerId,
    snapshot.id,
    operation,
    found,
  )

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
      return finishDivisionForOwner(
        dependencies.repository,
        ownerId,
        snapshot,
        divisionPayload(result.resultPayload),
      )
    }
    const storedAnswer = answerPayload(result.resultPayload)
    const lifecycle = await dependencies.lifecycleRepository?.getForGame(
      ownerId,
      snapshot.id,
    )
    if (
      lifecycle?.versions.portiaContract === CURRENT_LIFECYCLE_VERSIONS.portiaContract &&
      !approvedAnswerMatchesLifecycle(storedAnswer, lifecycle)
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
  },
): Promise<boolean> {
  const failure = classifyProviderFailure(input.error, input.signal)
  if (failure.ambiguous) return false

  const settled = await dependencies.usage.settleModelRequest({
    userId: input.ownerId,
    requestId: input.reservation.requestId,
    leaseToken: input.leaseToken,
    outcome: 'failed',
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

function exportValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(exportValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, exportValue(item)]),
    )
  }
  return value
}

function rowsAt(
  results: readonly { readonly rows: readonly SqlRow[] }[],
  index: number,
): readonly Record<string, unknown>[] {
  return (results[index]?.rows ?? []).map(
    (row) => exportValue(row) as Record<string, unknown>,
  )
}

function accountExportEstimatedBytes(
  results: readonly { readonly rows: readonly SqlRow[] }[],
): bigint {
  const value = results[0]?.rows[0]?.estimatedBytes

  if (typeof value === 'bigint' && value >= 0n) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value)
  }
  if (typeof value === 'string' && /^\d+$/u.test(value)) {
    return BigInt(value)
  }

  throw new ApiError(
    'INTERNAL_ERROR',
    500,
    'The WebChess account export size could not be verified.',
  )
}

function accountExportStatements(
  ownerId: string,
  maxBytes: number,
  ownerRateKey: string,
): readonly SqlStatement[] {
  const exportGuard = `
    WITH export_gate AS MATERIALIZED (
      SELECT
        current_setting('${ACCOUNT_EXPORT_GUARD_SETTING}', true) = 'on'
          AS allowed
    )
  `

  return [
    {
      text: `
        WITH exported_row_sizes AS MATERIALIZED (
          SELECT
            greatest(
              pg_column_size(controls)::bigint,
              octet_length(to_jsonb(controls)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(controls)))::bigint
            ) + 128 AS bytes
          FROM user_controls AS controls
          WHERE controls.clerk_user_id = $1::text

          UNION ALL

          SELECT
            greatest(
              pg_column_size(owned_games)::bigint,
              octet_length(to_jsonb(owned_games)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(owned_games)))::bigint
            ) + 128
          FROM games AS owned_games
          WHERE owned_games.clerk_user_id = $1::text

          UNION ALL

          SELECT
            greatest(
              pg_column_size(events)::bigint,
              octet_length(to_jsonb(events)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(events)))::bigint
            ) + 128
          FROM game_events AS events
          JOIN games AS event_games ON event_games.id = events.game_id
          WHERE event_games.clerk_user_id = $1::text

          UNION ALL

          SELECT
            greatest(
              pg_column_size(requests)::bigint,
              octet_length(to_jsonb(requests)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(requests)))::bigint
            ) + 128
          FROM model_requests AS requests
          WHERE requests.clerk_user_id = $1::text

          UNION ALL

          SELECT
            greatest(
              pg_column_size(buckets)::bigint,
              octet_length(to_jsonb(buckets)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(buckets)))::bigint
            ) + 128
          FROM usage_buckets AS buckets
          WHERE buckets.subject_type = 'user'
            AND buckets.subject_key = $1::text

          UNION ALL

          SELECT
            greatest(
              pg_column_size(rate_windows)::bigint,
              octet_length(to_jsonb(rate_windows)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(rate_windows)))::bigint
            ) + 128
          FROM rate_buckets AS rate_windows
          WHERE rate_windows.key_type = 'user'
            AND rate_windows.key_hash = $3::char(64)

          UNION ALL

          SELECT
            greatest(
              pg_column_size(starts)::bigint,
              octet_length(to_jsonb(starts)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(starts)))::bigint
            ) + 128
          FROM game_start_requests AS starts
          WHERE starts.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(runs)::bigint,
            octet_length(to_jsonb(runs)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(runs)))::bigint
          ) + 128
          FROM lifecycle_runs AS runs
          WHERE runs.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(reviews)::bigint,
            octet_length(to_jsonb(reviews)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(reviews)))::bigint
          ) + 128
          FROM portia_reviews AS reviews
          WHERE reviews.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(decisions)::bigint,
            octet_length(to_jsonb(decisions)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(decisions)))::bigint
          ) + 128
          FROM gate_decisions AS decisions
          WHERE decisions.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(results)::bigint,
            octet_length(to_jsonb(results)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(results)))::bigint
          ) + 128
          FROM charlotte_results AS results
          WHERE results.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(actions)::bigint,
            octet_length(to_jsonb(actions)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(actions)))::bigint
          ) + 128
          FROM wilbur_actions AS actions
          WHERE actions.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(observations)::bigint,
            octet_length(to_jsonb(observations)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(observations)))::bigint
          ) + 128
          FROM wilbur_observations AS observations
          WHERE observations.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(mutations)::bigint,
            octet_length(to_jsonb(mutations)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(mutations)))::bigint
          ) + 128
          FROM wilbur_mutation_requests AS mutations
          WHERE mutations.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(memory_links)::bigint,
            octet_length(to_jsonb(memory_links)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(memory_links)))::bigint
          ) + 128
          FROM web_memory_links AS memory_links
          WHERE memory_links.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(research)::bigint,
            octet_length(to_jsonb(research)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(research)))::bigint
          ) + 128
          FROM research_requests AS research
          WHERE research.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(sources)::bigint,
            octet_length(to_jsonb(sources)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(sources)))::bigint
          ) + 128
          FROM research_sources AS sources
          WHERE sources.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(activities)::bigint,
            octet_length(to_jsonb(activities)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(activities)))::bigint
          ) + 128
          FROM lifecycle_events AS activities
          WHERE activities.clerk_user_id = $1::text
        ),
        estimate AS MATERIALIZED (
          SELECT (4096 + coalesce(sum(bytes), 0))::bigint AS estimated_bytes
          FROM exported_row_sizes
        )
        SELECT
          estimate.estimated_bytes::text AS "estimatedBytes",
          set_config(
            '${ACCOUNT_EXPORT_GUARD_SETTING}',
            CASE
              WHEN estimate.estimated_bytes <= $2::bigint THEN 'on'
              ELSE 'off'
            END,
            true
          ) AS "exportAllowed"
        FROM estimate
      `,
      values: [ownerId, maxBytes, ownerRateKey],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          suspended,
          blocked_until AS "blockedUntil",
          reason_code AS "reasonCode",
          daily_game_limit AS "dailyGameLimit",
          daily_model_request_limit AS "dailyModelRequestLimit",
          hourly_model_request_limit AS "hourlyModelRequestLimit",
          concurrent_model_limit AS "concurrentModelLimit",
          created_at AS "createdAt",
          last_seen_at AS "lastSeenAt",
          updated_at AS "updatedAt"
        FROM user_controls
        CROSS JOIN export_gate
        WHERE export_gate.allowed
          AND clerk_user_id = $1::text
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          id::text,
          source_game_id::text AS "sourceGameId",
          is_current AS "isCurrent",
          revision::text,
          status,
          problem,
          problem_sha256 AS "problemSha256",
          division_seed AS "divisionSeed",
          division_facets AS "divisionFacets",
          problem_parts AS "problemParts",
          division_model AS "divisionModel",
          division_prompt_version AS "divisionPromptVersion",
          division_prompt_sha256 AS "divisionPromptSha256",
          division_digest AS "divisionDigest",
          rules_version AS "rulesVersion",
          engine_version AS "engineVersion",
          cast_version AS "castVersion",
          event_version AS "eventVersion",
          software_version AS "softwareVersion",
          outcome,
          answer_payload AS "answer",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          completed_at AS "completedAt",
          answered_at AS "answeredAt"
        FROM games
        CROSS JOIN export_gate
        WHERE export_gate.allowed
          AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          events.game_id::text AS "gameId",
          events.ply,
          events.kind,
          events.source,
          events.side,
          events.piece_id AS "pieceId",
          events.captured_piece_id AS "capturedPieceId",
          events.promoted_to AS "promotedTo",
          events.from_ring AS "fromRing",
          events.from_sector AS "fromSector",
          events.to_ring AS "toRing",
          events.to_sector AS "toSector",
          events.idempotency_key::text AS "idempotencyKey",
          events.request_sha256 AS "requestSha256",
          events.game_revision::text AS "gameRevision",
          events.created_at AS "createdAt"
        FROM game_events AS events
        JOIN games ON games.id = events.game_id
        CROSS JOIN export_gate
        WHERE export_gate.allowed
          AND games.clerk_user_id = $1::text
        ORDER BY events.game_id, events.ply
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          id::text,
          game_id::text AS "gameId",
          operation,
          idempotency_key::text AS "idempotencyKey",
          request_sha256 AS "requestSha256",
          status,
          attempt,
          provider,
          model,
          prompt_version AS "promptVersion",
          software_version AS "softwareVersion",
          provider_response_id AS "providerResponseId",
          response_sha256 AS "responseSha256",
          result_payload AS "resultPayload",
          usage_reported AS "usageReported",
          input_tokens::text AS "inputTokens",
          cached_input_tokens::text AS "cachedInputTokens",
          cache_write_input_tokens::text AS "cacheWriteInputTokens",
          output_tokens::text AS "outputTokens",
          reasoning_tokens::text AS "reasoningTokens",
          total_tokens::text AS "totalTokens",
          provider_started_at AS "providerStartedAt",
          completed_at AS "completedAt",
          failure_code AS "failureCode",
          provider_http_status AS "providerHttpStatus",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM model_requests
        CROSS JOIN export_gate
        WHERE export_gate.allowed
          AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          metric,
          bucket_start AS "bucketStart",
          bucket_seconds AS "bucketSeconds",
          used::text,
          reserved::text,
          updated_at AS "updatedAt"
        FROM usage_buckets
        CROSS JOIN export_gate
        WHERE export_gate.allowed
          AND subject_type = 'user'
          AND subject_key = $1::text
        ORDER BY bucket_start, metric
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          idempotency_key::text AS "idempotencyKey",
          kind,
          source_game_id::text AS "sourceGameId",
          expected_revision::text AS "expectedRevision",
          activated_at AS "activatedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM game_start_requests
        CROSS JOIN export_gate
        WHERE export_gate.allowed
          AND clerk_user_id = $1::text
        ORDER BY created_at, idempotency_key
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          id::text, game_id::text AS "gameId",
          root_run_id::text AS "rootRunId",
          parent_run_id::text AS "parentRunId",
          state, revision::text, field_generation AS "fieldGeneration",
          game_attempt AS "gameAttempt",
          same_field_retry_count AS "sameFieldRetryCount",
          field_regeneration_count AS "fieldRegenerationCount",
          division_seed AS "divisionSeed", cast_seed AS "castSeed",
          trajectory_seed AS "trajectorySeed", retry_reason AS "retryReason",
          terminal_fingerprint AS "terminalFingerprint",
          answer_prompt_digest AS "answerPromptDigest",
          survivor_set AS survivors,
          portia_current_candidate_id AS "portiaCurrentCandidateId",
          portia_active_model_request_id::text AS "portiaActiveModelRequestId",
          portia_failed_attempt_count AS "portiaFailedAttemptCount",
          portia_failure_limit AS "portiaFailureLimit",
          portia_completed_candidate_ids AS "portiaCompletedCandidateIds",
          portia_assessment_drafts AS "portiaAssessmentDrafts",
          charlotte_active_model_request_id::text AS "charlotteActiveModelRequestId",
          charlotte_failed_attempt_count AS "charlotteFailedAttemptCount",
          charlotte_failure_limit AS "charlotteFailureLimit",
          software_version AS "softwareVersion",
          lifecycle_version AS "lifecycleVersion",
          rules_version AS "rulesVersion", engine_version AS "engineVersion",
          cast_version AS "castVersion", event_version AS "eventVersion",
          portia_prompt_version AS "portiaPromptVersion",
          portia_contract_version AS "portiaContractVersion",
          gate_algorithm_version AS "gateAlgorithmVersion",
          retry_policy_version AS "retryPolicyVersion",
          charlotte_prompt_version AS "charlottePromptVersion",
          charlotte_contract_version AS "charlotteContractVersion",
          wilbur_record_version AS "wilburRecordVersion",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM lifecycle_runs CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, game_id::text AS "gameId",
          lifecycle_run_id::text AS "lifecycleRunId", stage,
          requested_by AS "requestedBy", policy_version AS "policyVersion",
          materiality, reason, query, status, provider, transport, model,
          invocation_limit AS "invocationLimit",
          result_limit AS "resultLimit", source_limit AS "sourceLimit",
          timeout_ms AS "timeoutMs",
          synthesis_character_limit AS "synthesisCharacterLimit",
          attempt_count AS "attemptCount",
          executed_queries AS "executedQueries",
          search_synthesis AS "searchSynthesis",
          direct_page_text_fetched AS "directPageTextFetched",
          retrieved_facts AS "retrievedFacts",
          omitted_source_count AS "omittedSourceCount",
          injection_signals AS "injectionSignals",
          content_digest AS "contentDigest", failure_code AS "failureCode",
          started_at AS "startedAt", completed_at AS "completedAt",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM research_requests CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, research_request_id::text AS "researchRequestId",
          ordinal, citation_id AS "citationId", title, url, hostname, trust,
          discovered_from AS "discoveredFrom", created_at AS "createdAt"
        FROM research_sources CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY research_request_id, ordinal
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, lifecycle_run_id::text AS "lifecycleRunId",
          model_request_id::text AS "modelRequestId",
          input_digest AS "inputDigest", output_digest AS "outputDigest",
          prompt_version AS "promptVersion",
          contract_version AS "contractVersion", review,
          created_at AS "createdAt"
        FROM portia_reviews CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, lifecycle_run_id::text AS "lifecycleRunId",
          algorithm_version AS "algorithmVersion",
          input_digest AS "inputDigest", passed, result,
          answer_user_prompt AS "answerUserPrompt",
          answer_user_prompt_sha256 AS "answerUserPromptSha256",
          created_at AS "createdAt"
        FROM gate_decisions CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, lifecycle_run_id::text AS "lifecycleRunId",
          model_request_id::text AS "modelRequestId",
          input_digest AS "inputDigest", output_digest AS "outputDigest",
          prompt_version AS "promptVersion",
          contract_version AS "contractVersion", result,
          rendered_answer AS "renderedAnswer", created_at AS "createdAt"
        FROM charlotte_results CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, lifecycle_run_id::text AS "lifecycleRunId",
          charlotte_action_index AS "charlotteActionIndex",
          charlotte_binding_version AS "charlotteBindingVersion",
          idempotency_key::text AS "idempotencyKey",
          request_digest AS "requestDigest", actor, action,
          tested_assumption AS "testedAssumption",
          expected_observation AS "expectedObservation",
          decision_threshold AS "decisionThreshold",
          review_horizon AS "reviewHorizon",
          follow_up_at AS "followUpAt", status, revision::text,
          record_version AS "recordVersion",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM wilbur_actions CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, target_game_id::text AS "targetGameId",
          source_observation_id::text AS "sourceObservationId",
          selection_ordinal AS "selectionOrdinal",
          consent_version AS "consentVersion",
          created_at AS "createdAt"
        FROM web_memory_links CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, action_id::text AS "actionId",
          idempotency_key::text AS "idempotencyKey",
          request_digest AS "requestDigest", observed_at AS "observedAt",
          observation, evidence_classification AS "evidenceClassification",
          expected_effect AS "expectedEffect",
          unexpected_effect AS "unexpectedEffect",
          stakeholder_response AS "stakeholderResponse",
          assumption_result AS "assumptionResult",
          next_decision AS "nextDecision", record_version AS "recordVersion",
          created_at AS "createdAt"
        FROM wilbur_observations CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY observed_at, created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          idempotency_key::text AS "idempotencyKey",
          operation,
          request_digest AS "requestDigest",
          target_game_id::text AS "targetGameId",
          target_action_id::text AS "targetActionId",
          rate_kind AS "rateKind",
          rate_admitted_at AS "rateAdmittedAt",
          denial_code AS "denialCode",
          retry_at AS "retryAt",
          status,
          result_entity_id::text AS "resultEntityId",
          result_revision::text AS "resultRevision",
          result_status AS "resultStatus",
          result_follow_up_at AS "resultFollowUpAt",
          result_updated_at AS "resultUpdatedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM wilbur_mutation_requests CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, idempotency_key
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, lifecycle_run_id::text AS "lifecycleRunId",
          sequence::text, stage, activity_type AS "activityType",
          state_from AS "stateFrom", state_to AS "stateTo",
          input_entity_ids AS "inputEntityIds",
          output_entity_ids AS "outputEntityIds",
          responsible_agent_ids AS "responsibleAgentIds",
          configuration_digest AS "configurationDigest", status,
          event_version AS "eventVersion", created_at AS "createdAt"
        FROM lifecycle_events CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY lifecycle_run_id, sequence
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          action,
          window_start AS "windowStart",
          window_seconds AS "windowSeconds",
          count,
          expires_at AS "expiresAt"
        FROM rate_buckets
        CROSS JOIN export_gate
        WHERE export_gate.allowed
          AND key_type = 'user'
          AND key_hash = $1::char(64)
        ORDER BY window_start, action
      `,
      values: [ownerRateKey],
    },
  ]
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
  const review = validatePortiaReview(
    reviewValue,
    lifecycle.survivors,
    lifecycle.answerPromptDigest ?? undefined,
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
    })
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
      !isPromptBoundPortiaReview(lifecycle.portia) ||
      !lifecycle.gate ||
      !lifecycle.answerPromptDigest
    ) {
      throw new ApiError(
        'INTERNAL_ERROR',
        500,
        'The saved Charlotte result is missing its board-answer inputs.',
      )
    }
    const researchEvidence = boardAnswerPromptPlan(game, lifecycle)
      .plan.researchEvidence
    charlotteInput = {
      problem: game.problem,
      boardAnswer: game.answer,
      boardAnswerDigest: canonicalHash(game.answer),
      reviewedPromptDigest: lifecycle.answerPromptDigest,
      portia: lifecycle.portia,
      gate: lifecycle.gate,
      ...(researchEvidence?.length ? { researchEvidence } : {}),
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
        operation: 'portia/v3',
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
        operation: 'charlotte/v3',
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
  ) =>
    canonicalHash({
      operation: 'division/v3-web-memory',
      problem,
      memoryObservationIds,
      model: modelName(dependencies),
      promptVersion: DIVISION_PROMPT_VERSION,
      softwareVersion: dependencies.softwareVersion,
    })

  const services: WebChessApiServices = {
    divide(input) {
      return apiOperation(async () => {
        const problem = normalizeProblem(input.problem)
        const memoryObservationIds = [...new Set(input.memoryObservationIds ?? [])]
        const lifecycleRepository = memoryObservationIds.length > 0
          ? requireLifecycleRepository(dependencies)
          : null
        const webMemoryEvidence = memoryObservationIds.length === 0
          ? []
          : await lifecycleRepository!.getWebMemoryEvidence(
              input.ownerId,
              memoryObservationIds,
            )
        const apiKey = modelApiKey(dependencies)
        const reservation = await dependencies.usage.reserveModelRequest({
          requestId: input.requestId,
          gameId: null,
          userId: input.ownerId,
          operation: 'division',
          idempotencyKey: input.idempotencyKey,
          requestSha256: divisionRequestHash(problem, memoryObservationIds),
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
            )
            if (recovered.status === 'division_failed') {
              throw terminalModelFailure('division')
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

          let generated: Awaited<ReturnType<typeof generateDivision>>
          try {
            generated = await dependencies.divisionGenerator(
              webMemoryEvidence.length > 0
                ? { problem, webMemoryEvidence }
                : problem,
              {
              userId: input.ownerId,
              safetyHmacSecret: dependencies.hmacSecret,
              apiKey,
              signal: providerSignal,
              idempotencyKey: providerIdempotencyKey(
                dependencies.hmacSecret,
                input.ownerId,
                'division',
                input.idempotencyKey,
              ),
              },
            )
          } catch (error) {
            const settled = await settleDefinitiveFailure(dependencies, {
              ownerId: input.ownerId,
              reservation,
              leaseToken,
              error,
              signal: providerSignal,
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

          const stored = DivisionResultPayloadSchema.parse({
            format: 'webchess-division-result/1',
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

          let winning = stored
          if (!settled.ok) {
            const recovered = await recoverCommittedResult(
              dependencies,
              input.ownerId,
              shell.id,
              'division',
            )
            if (!recovered.found || recovered.status !== 'succeeded') {
              throw new ApiError(
                'INTERNAL_ERROR',
                500,
                'The division result could not be committed safely.',
              )
            }
            winning = divisionPayload(recovered.resultPayload)
          }
          successCommitted = true
          shell = await finishDivisionForOwner(
            dependencies.repository,
            input.ownerId,
            shell,
            winning,
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
      return apiOperation(async () => {
        const apiKey = modelApiKey(dependencies)
        let terminal = await dependencies.repository.getTerminalReplay(
          input.ownerId,
          input.gameId,
        )
        let lifecycle = await dependencies.lifecycleRepository?.getForGame(
          input.ownerId,
          input.gameId,
        )
        if (terminal.status === 'answered' && terminal.answer) {
          if (lifecycle?.versions.portiaContract === CURRENT_LIFECYCLE_VERSIONS.portiaContract) {
            if (!lifecycle.portia || !isPromptBoundPortiaReview(lifecycle.portia)) {
              throw new ApiError(
                'CONFLICT',
                409,
                'This answer predates the required prompt-bound Portia review.',
              )
            }
            lifecycle = (await ensurePlayerVisibleAnswerPrompt(
              dependencies,
              input.ownerId,
              terminal,
              lifecycle,
            )).lifecycle
            await requireApprovedAnswerPayload(
              dependencies,
              input.ownerId,
              terminal,
              lifecycle,
            )
          }
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
            if (lifecycle?.versions.portiaContract === CURRENT_LIFECYCLE_VERSIONS.portiaContract) {
              const reconciledTerminal = await dependencies.repository
                .getTerminalReplay(input.ownerId, input.gameId)
              lifecycle = (await ensurePlayerVisibleAnswerPrompt(
                dependencies,
                input.ownerId,
                reconciledTerminal,
                lifecycle,
              )).lifecycle
              await requireApprovedAnswerPayload(
                dependencies,
                input.ownerId,
                reconciledTerminal,
                lifecycle,
              )
            }
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
        }

        const evidence = serverEvidence(terminal)
        let answerInput: AnswerGenerationInput = evidence
        if (lifecycle) {
          if (lifecycle.state !== 'gate_passed') {
            throw new ApiError(
              'CONFLICT',
              409,
              'The exact board-derived answer prompt must be permitted by Portia and the Gate before generation.',
            )
          }
          const ensured = await ensurePlayerVisibleAnswerPrompt(
            dependencies,
            input.ownerId,
            terminal,
            lifecycle,
          )
          if (!ensured.exactPromptAvailable) {
            throw new ApiError(
              'CONFLICT',
              409,
              'The exact player-visible Answer prompt was not persisted before generation.',
            )
          }
          lifecycle = ensured.lifecycle
          answerInput = ensured.answerInput
        }
        const requestSha256 = canonicalHash({
          operation: lifecycle ? 'answer/v3-approved' : 'answer/v1',
          gameId: input.gameId,
          expectedRevision: input.expectedRevision,
          input: answerInput,
          model: modelName(dependencies),
          promptVersion: ANSWER_PROMPT_VERSION,
          softwareVersion: dependencies.softwareVersion,
        })
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
          countsAsGameStart: false,
          ipAddress: input.ipAddress,
        })
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
          const began = await dependencies.usage.beginProviderCall({
            userId: input.ownerId,
            requestId: reservation.requestId,
            leaseToken,
          })
          if (!began.ok) {
            throw beginProviderCallError(began, 'answer')
          }
          providerStarted = true
          const providerSignal = durableProviderSignal()

          let generated: Awaited<ReturnType<typeof generateAnswer>>
          try {
            generated = await dependencies.answerGenerator(answerInput, {
              userId: input.ownerId,
              safetyHmacSecret: dependencies.hmacSecret,
              apiKey,
              signal: providerSignal,
              idempotencyKey: providerIdempotencyKey(
                dependencies.hmacSecret,
                input.ownerId,
                'answer',
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
            if (settled && pending) {
              pending = await failAnswerForOwner(
                dependencies.repository,
                input.ownerId,
                pending,
              )
            }
            throw error
          }

          const stored = AnswerResultPayloadSchema.parse(
            lifecycle && lifecycle.answerPromptDigest && lifecycle.gate
              ? {
                  format: 'webchess-answer-result/2',
                  answer: {
                    answer: generated.result.answer,
                    model: generated.model,
                    prompt: generated.prompt,
                  },
                  approval: {
                    lifecycleRunId: lifecycle.id,
                    reviewedPromptDigest: lifecycle.answerPromptDigest,
                    gateInputDigest: lifecycle.gate.inputDigest,
                  },
                }
              : {
                  format: 'webchess-answer-result/1',
                  answer: {
                    answer: generated.result.answer,
                    model: generated.model,
                    prompt: generated.prompt,
                  },
                },
          )
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
              input.gameId,
              'answer',
              {
                requestSha256,
                promptVersion: ANSWER_PROMPT_VERSION,
              },
            )
            if (!recovered.found || recovered.status !== 'succeeded') {
              throw new ApiError(
                'INTERNAL_ERROR',
                500,
                'The answer result could not be committed safely.',
              )
            }
            winning = answerPayload(recovered.resultPayload)
          }
          if (lifecycle && !approvedAnswerMatchesLifecycle(winning, lifecycle)) {
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
            await releaseBeforeProvider(
              dependencies.usage,
              reservation,
              input.ownerId,
            )
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
      })
    },

    getLifecycle(input) {
      return apiOperation(async () => {
        const game = await dependencies.repository.getOwnedGame(
          input.ownerId,
          input.gameId,
        )
        let lifecycle = await synchronizeLifecycleWithGame(
          dependencies,
          input.ownerId,
          game,
        )
        if (
          lifecycle.state === 'portia_running' ||
          lifecycle.state === 'charlotte_running'
        ) {
          const terminal = await dependencies.repository.getTerminalReplay(
            input.ownerId,
            input.gameId,
          )
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
              operation: 'portia/v3-recovery',
              gameId: terminal.id,
              terminalFingerprint: lifecycle.terminalFingerprint,
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

        const apiKey = modelApiKey(dependencies)
        const generator = dependencies.portiaGenerator
        if (!generator) {
          throw serviceUnavailable('The Portia model stage is not configured.')
        }

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
          operation: 'portia/v3',
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
            apiKey,
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
        let lifecycle = await synchronizeLifecycleWithGame(
          dependencies,
          input.ownerId,
          terminal,
        )
        if (lifecycle.state === 'charlotte_unavailable') return lifecycle
        if (
          lifecycle.charlotte &&
          lifecycle.state !== 'charlotte_pending' &&
          lifecycle.state !== 'charlotte_running'
        ) {
          if (
            lifecycle.versions.charlottePrompt ===
              CURRENT_LIFECYCLE_VERSIONS.charlottePrompt
          ) {
            lifecycle = (await ensurePlayerVisibleAnswerPrompt(
              dependencies,
              input.ownerId,
              terminal,
              lifecycle,
            )).lifecycle
            await requireApprovedAnswerPayload(
              dependencies,
              input.ownerId,
              terminal,
              lifecycle,
            )
            await requireApprovedCharlottePayload(
              dependencies,
              input.ownerId,
              terminal,
              lifecycle,
            )
          }
          return lifecycle
        }
        const portia = lifecycle.portia
        const gate = lifecycle.gate
        if (
          !portia ||
          !isPromptBoundPortiaReview(portia) ||
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
        lifecycle = (await ensurePlayerVisibleAnswerPrompt(
          dependencies,
          input.ownerId,
          terminal,
          lifecycle,
        )).lifecycle
        await requireApprovedAnswerPayload(
          dependencies,
          input.ownerId,
          terminal,
          lifecycle,
        )
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

        const apiKey = modelApiKey(dependencies)
        const generator = dependencies.charlotteGenerator
        if (!generator) {
          throw serviceUnavailable('The Charlotte model stage is not configured.')
        }

        await dependencies.usage.reconcileExpiredLeases()
        const researchEvidence = boardAnswerPromptPlan(terminal, lifecycle)
          .plan.researchEvidence
        const modelInput = {
          problem: terminal.problem,
          boardAnswer: terminal.answer,
          boardAnswerDigest: canonicalHash(terminal.answer),
          reviewedPromptDigest,
          portia,
          gate,
          ...(researchEvidence?.length ? { researchEvidence } : {}),
        }
        const requestSha256 = canonicalHash({
          operation: 'charlotte/v3',
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
            apiKey,
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
        let lifecycle = await synchronizeLifecycleWithGame(
          dependencies,
          input.ownerId,
          terminal,
        )
        const promptBoundPortia = lifecycle.portia
          && isPromptBoundPortiaReview(lifecycle.portia)
          ? lifecycle.portia
          : null
        const reopeningTerminal = canReopenInsufficientBasis(lifecycle)
          && promptBoundPortia !== null
        if (
          (lifecycle.state !== 'gate_failed' && !reopeningTerminal)
          || !lifecycle.gate
        ) {
          throw new ApiError('CONFLICT', 409, 'Retry requires a failed deterministic Gate.')
        }
        const failedGate = reopeningTerminal
          ? evaluateGate(promptBoundPortia, {
              sameFieldRetryCount: lifecycle.sameFieldRetryCount,
              fieldRegenerationCount: lifecycle.fieldRegenerationCount,
            })
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
          const apiKey = modelApiKey(dependencies)
          const repairContext = fieldRepairContext(lifecycle, failedGate)
          const requestSha256 = canonicalHash({
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
          const shellResult = await dependencies.repository.getOrCreateDivision({
            ownerId: input.ownerId,
            problem: terminal.problem,
            softwareVersion: dependencies.softwareVersion,
            gameId: reservation.requestId,
            sourceGameId: terminal.id,
          })
          child = shellResult.game
          if (inheritedObservationIds.length > 0) {
            await repository.attachWebMemoryEvidence(
              input.ownerId,
              child.id,
              inheritedObservationIds,
            )
          }
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
            )
            if (child.status !== 'mapped') throw terminalModelFailure('division')
          } else {
            const leaseToken = requireLease(reservation)
            const began = await dependencies.usage.beginProviderCall({
              userId: input.ownerId,
              requestId: reservation.requestId,
              leaseToken,
            })
            if (!began.ok) throw beginProviderCallError(began, 'division')
            const providerSignal = durableProviderSignal()
            const generated = await dependencies.divisionGenerator(
              {
                problem: terminal.problem,
                repairContext,
                ...(inheritedWebMemory.length > 0
                  ? { webMemoryEvidence: inheritedWebMemory }
                  : {}),
              },
              {
                userId: input.ownerId,
                safetyHmacSecret: dependencies.hmacSecret,
                apiKey,
                signal: providerSignal,
                idempotencyKey: providerIdempotencyKey(
                  dependencies.hmacSecret,
                  input.ownerId,
                  'division',
                  input.idempotencyKey,
                ),
              },
            )
            const stored = DivisionResultPayloadSchema.parse({
              format: 'webchess-division-result/1',
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
            let winning = stored
            if (!settled.ok) {
              const recovered = await recoverCommittedResult(
                dependencies,
                input.ownerId,
                child.id,
                'division',
              )
              if (!recovered.found || recovered.status !== 'succeeded') {
                throw new ApiError('INTERNAL_ERROR', 500, 'The regenerated field could not be committed safely.')
              }
              winning = divisionPayload(recovered.resultPayload)
            }
            child = await finishDivisionForOwner(
              dependencies.repository,
              input.ownerId,
              child,
              winning,
            )
          }
        }
        if (
          decision.mode === 'replay_game'
          && inheritedObservationIds.length > 0
        ) {
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
        const lifecycle = await repository.getForGame(
          input.ownerId,
          input.gameId,
        )
        if (!lifecycle) {
          throw new ApiError(
            'LIFECYCLE_NOT_FOUND',
            404,
            'Lifecycle provenance not found.',
          )
        }
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
        const lifecycle = await repository.getForGame(input.ownerId, input.gameId)
        const currentAction = lifecycle?.wilburActions.find(
          (action) => action.id === input.actionId,
        )
        if (!currentAction) {
          throw new ApiError('LIFECYCLE_NOT_FOUND', 404, 'Wilbur action not found.')
        }
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
        const lifecycle = await repository.getForGame(input.ownerId, input.gameId)
        if (!lifecycle?.wilburActions.some((action) => action.id === input.actionId)) {
          throw new ApiError('LIFECYCLE_NOT_FOUND', 404, 'Wilbur action not found.')
        }
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

    getAccountUsage(input) {
      return apiOperation(async () => {
        const summary = await dependencies.usage.getUsageSummary(input.ownerId)
        if ('ok' in summary) throw usageError(summary)
        return summary
      })
    },

    exportAccount(input) {
      return apiOperation(async () => {
        const allowed = await dependencies.usage.consumeAccountExportRate({
          userId: input.ownerId,
          ipAddress: input.ipAddress,
        })
        if (!allowed.ok) throw usageError(allowed)

        const results = await dependencies.database.transaction(
          accountExportStatements(
            input.ownerId,
            dependencies.accountExportMaxBytes,
            hashUserRateKey(dependencies.hmacSecret, input.ownerId),
          ),
          {
            isolationLevel: 'RepeatableRead',
            readOnly: true,
          },
        )
        const estimatedBytes = accountExportEstimatedBytes(results)
        if (estimatedBytes > BigInt(dependencies.accountExportMaxBytes)) {
          throw new ApiError(
            'PAYLOAD_TOO_LARGE',
            413,
            'This WebChess account export is too large to download.',
          )
        }

        const exported = {
          format: ACCOUNT_EXPORT_FORMAT,
          exportedAt: new Date().toISOString(),
          controls: rowsAt(results, 1)[0] ?? null,
          games: rowsAt(results, 2),
          events: rowsAt(results, 3),
          modelRequests: rowsAt(results, 4),
          usageBuckets: rowsAt(results, 5),
          gameStartRequests: rowsAt(results, 6),
          lifecycleRuns: rowsAt(results, 7),
          researchRequests: rowsAt(results, 8),
          researchSources: rowsAt(results, 9),
          portiaReviews: rowsAt(results, 10),
          gateDecisions: rowsAt(results, 11),
          charlotteResults: rowsAt(results, 12),
          wilburActions: rowsAt(results, 13),
          webMemoryLinks: rowsAt(results, 14),
          wilburObservations: rowsAt(results, 15),
          wilburMutationRequests: rowsAt(results, 16),
          lifecycleActivities: rowsAt(results, 17),
          userRateBuckets: rowsAt(results, 18),
        }
        if (
          new TextEncoder().encode(`${JSON.stringify(exported, null, 2)}\n`)
            .byteLength > dependencies.accountExportMaxBytes
        ) {
          throw new ApiError(
            'PAYLOAD_TOO_LARGE',
            413,
            'This WebChess account export is too large to download.',
          )
        }
        return exported
      })
    },

    deleteAccountData(input) {
      return apiOperation(async () => {
        const result = await dependencies.usage.deleteAccountData(
          input.ownerId,
        )
        if (!result.ok) {
          throw new ApiError(
            'CONFLICT',
            409,
            'Wait for the active model request to finish before deleting WebChess data.',
            { retryAfterSeconds: result.retryAfterSeconds },
          )
        }
      })
    },

    handleClerkUserDeleted(input) {
      return apiOperation(async () => {
        const result = await dependencies.usage.deleteAccountData(
          input.clerkUserId,
          { force: true },
        )
        if (!result.ok) {
          throw new ApiError(
            'INTERNAL_ERROR',
            500,
            'WebChess could not complete the verified account deletion.',
          )
        }
      })
    },
  }
  return services
}

/**
 * Lazily composes request-safe services. Importing this module and running
 * `next build` never reads a database or requires runtime secrets. Only the
 * explicit loopback launcher may migrate its dedicated database on first use;
 * Neon still requires the guarded owner command.
 */
export async function createApiServices(): Promise<WebChessApiServices> {
  const database = getDatabase()
  if (shouldUseLocalPostgresWireProtocol(process.env.DATABASE_URL)) {
    if (
      !isLocalHostedPostgresMigrationAuthorized(
        process.env.DATABASE_URL,
        process.env,
      )
    ) {
      throw serviceUnavailable(
        'Loopback PostgreSQL startup is disabled. Start WebChess through npm run local:dev so the launcher can authorize its dedicated database.',
      )
    }
    await ensureLocalHostedSchema(database)
  }
  return createApiServicesWithDependencies(productionDependencies(database))
}
