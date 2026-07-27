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
import type { DurableGame } from '../../lib/webchess-api'
import {
  getDatabase,
  hashCanonicalJson,
  hmacSha256Hex,
} from '../db'
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
  DIVISION_PROMPT_VERSION,
  DivisionFacetSchema,
  generateAnswer,
  generateDivision,
  ModelConfigurationError,
  ModelContractError,
  ModelInputError,
  ModelResponseError,
  OPENAI_MODEL,
  OPENAI_PROVIDER,
  parseServerDerivedEvidence,
} from '../openai'
import type {
  ModelGeneration,
  ServerDerivedEvidence,
} from '../openai'
import {
  createUsageController,
  loadUsageConfig,
} from '../usage'
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
import { ApiError, isApiError, serviceUnavailable } from './errors'
import type { WebChessApiServices } from './ports'

const FALLBACK_SOFTWARE_VERSION = 'webchess@0.1.0'
const ACCOUNT_EXPORT_FORMAT = 'webchess-account-export/1'
const DEFAULT_ACCOUNT_EXPORT_MAX_BYTES = 3_000_000
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
  prompt: z.string().trim().min(1).max(200_000),
})

const AnswerResultPayloadSchema = z.strictObject({
  format: z.literal('webchess-answer-result/1'),
  answer: StoredAnswerSchema,
})

type DivisionResultPayload = z.infer<typeof DivisionResultPayloadSchema>
type AnswerResultPayload = z.infer<typeof AnswerResultPayloadSchema>

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
  readonly hmacSecret: string
  readonly openAiApiKey?: string
  readonly repository: GameRepositoryPort
  readonly softwareVersion: string
  readonly usage: UsageController
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

function modelResultPayload<T extends ModelResultPayload>(value: T): T {
  return value
}

function normalizeSoftwareVersion(value: string | undefined): string {
  const version = value?.trim() || FALLBACK_SOFTWARE_VERSION
  if (version.length > 120) {
    throw serviceUnavailable('The WebChess software version is invalid.')
  }
  return version
}

function normalizeAccountExportMaxBytes(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_ACCOUNT_EXPORT_MAX_BYTES
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw serviceUnavailable(
      'The WebChess account export size limit is invalid.',
    )
  }
  return parsed
}

function productionDependencies(): ApiServiceAdapterDependencies {
  const database = getDatabase()
  const usageConfig = loadUsageConfig()

  return {
    accountExportMaxBytes: normalizeAccountExportMaxBytes(
      process.env.WEBCHESS_ACCOUNT_EXPORT_MAX_BYTES,
    ),
    answerGenerator: generateAnswer,
    database,
    divisionGenerator: generateDivision,
    hmacSecret: usageConfig.hmacSecret,
    openAiApiKey: process.env.OPENAI_API_KEY,
    repository: new DurableGameRepository(database),
    softwareVersion: normalizeSoftwareVersion(
      process.env.WEBCHESS_SOFTWARE_VERSION ||
        process.env.VERCEL_GIT_COMMIT_SHA,
    ),
    usage: createUsageController({
      db: database,
      config: usageConfig,
    }),
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

function requireModelApiKey(value: string | undefined): string {
  const apiKey = value?.trim()
  if (!apiKey) {
    throw serviceUnavailable('The WebChess model service is not configured.')
  }
  return apiKey
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
    operation === 'division'
      ? 'The division reservation expired before the model call began.'
      : 'The answer reservation expired before the model call began.',
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

function pendingConflict(operation: ModelOperation): ApiError {
  return new ApiError(
    'CONFLICT',
    409,
    operation === 'division'
      ? 'This division is still being processed.'
      : 'This answer is still being processed.',
    { retryAfterSeconds: 2 },
  )
}

function terminalModelFailure(operation: ModelOperation): ApiError {
  return new ApiError(
    'UPSTREAM_FAILURE',
    502,
    operation === 'division'
      ? 'The model could not complete a valid WebChess division.'
      : 'The model could not complete a valid WebChess answer.',
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
    return operation === 'division'
      ? finishDivisionForOwner(
          dependencies.repository,
          ownerId,
          snapshot,
          divisionPayload(result.resultPayload),
        )
      : storeAnswerForOwner(
          dependencies.repository,
          ownerId,
          snapshot,
          answerPayload(result.resultPayload),
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
): Promise<GetModelRequestResultResult> {
  return dependencies.usage.getSucceededModelResultForGame({
    userId: ownerId,
    gameId,
    operation,
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
              pg_column_size(starts)::bigint,
              octet_length(to_jsonb(starts)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(starts)))::bigint
            ) + 128
          FROM game_start_requests AS starts
          WHERE starts.clerk_user_id = $1::text
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
      values: [ownerId, maxBytes],
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
  ]
}

export function createApiServicesWithDependencies(
  dependencies: ApiServiceAdapterDependencies,
): WebChessApiServices {
  const divisionRequestHash = (problem: string) =>
    canonicalHash({
      operation: 'division/v1',
      problem,
      model: OPENAI_MODEL,
      promptVersion: DIVISION_PROMPT_VERSION,
      softwareVersion: dependencies.softwareVersion,
    })

  return {
    divide(input) {
      return apiOperation(async () => {
        const problem = normalizeProblem(input.problem)
        const apiKey = requireModelApiKey(dependencies.openAiApiKey)
        const reservation = await dependencies.usage.reserveModelRequest({
          requestId: input.requestId,
          gameId: null,
          userId: input.ownerId,
          operation: 'division',
          idempotencyKey: input.idempotencyKey,
          requestSha256: divisionRequestHash(problem),
          provider: OPENAI_PROVIDER,
          model: OPENAI_MODEL,
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

          let generated: Awaited<ReturnType<typeof generateDivision>>
          try {
            generated = await dependencies.divisionGenerator(problem, {
              userId: input.ownerId,
              safetyHmacSecret: dependencies.hmacSecret,
              apiKey,
              signal: input.signal,
              idempotencyKey: providerIdempotencyKey(
                dependencies.hmacSecret,
                input.ownerId,
                'division',
                input.idempotencyKey,
              ),
            })
          } catch (error) {
            const settled = await settleDefinitiveFailure(dependencies, {
              ownerId: input.ownerId,
              reservation,
              leaseToken,
              error,
              signal: input.signal,
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
            providerResponseId: generated.providerId,
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
      return apiOperation(async () =>
        publicGame(
          await dependencies.repository.startGame({
            ownerId: input.ownerId,
            gameId: input.gameId,
            expectedRevision: input.expectedRevision,
            idempotencyKey: input.idempotencyKey,
          }),
        ),
      )
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
        return publicGame(moved.game)
      })
    },

    answer(input) {
      return apiOperation(async () => {
        const apiKey = requireModelApiKey(dependencies.openAiApiKey)
        let terminal = await dependencies.repository.getTerminalReplay(
          input.ownerId,
          input.gameId,
        )
        if (terminal.status === 'answered' && terminal.answer) {
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
        const requestSha256 = canonicalHash({
          operation: 'answer/v1',
          gameId: input.gameId,
          expectedRevision: input.expectedRevision,
          evidence,
          model: OPENAI_MODEL,
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
          provider: OPENAI_PROVIDER,
          model: OPENAI_MODEL,
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
          )
          if (
            existing.found &&
            existing.status === 'succeeded' &&
            existing.resultPayload
          ) {
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
              answerPayload(existing.resultPayload),
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

          let generated: Awaited<ReturnType<typeof generateAnswer>>
          try {
            generated = await dependencies.answerGenerator(evidence, {
              userId: input.ownerId,
              safetyHmacSecret: dependencies.hmacSecret,
              apiKey,
              signal: input.signal,
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
              signal: input.signal,
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

          const stored = AnswerResultPayloadSchema.parse({
            format: 'webchess-answer-result/1',
            answer: {
              answer: generated.result.answer,
              model: generated.model,
              prompt: generated.prompt,
            },
          })
          const payload = modelResultPayload(stored)
          const settled = await dependencies.usage.settleModelRequest({
            userId: input.ownerId,
            requestId: reservation.requestId,
            leaseToken,
            outcome: 'succeeded',
            usage: providerUsage(generated),
            providerResponseId: generated.providerId,
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
}

/**
 * Lazily composes request-safe services. Importing this module and running
 * `next build` never reads a database or requires runtime secrets.
 */
export async function createApiServices(): Promise<WebChessApiServices> {
  return createApiServicesWithDependencies(productionDependencies())
}
