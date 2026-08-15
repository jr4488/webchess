import type { GameView } from './game-contract'
import { LIFECYCLE_STATES } from './lifecycle/contracts'
import type {
  AssumptionResult,
  LifecycleActivity,
  LifecycleAggregate,
  WilburAction,
  WilburActionStatus,
  WilburObservation,
} from './lifecycle/contracts'
import {
  RESEARCH_STAGES,
  RESEARCH_STATUSES,
} from './research/contracts'
import type { ResearchRecord } from './research/contracts'
import type {
  CellCoord,
  GeneratedAnswer,
  ProblemFacet,
  ProblemPart,
} from '../types'

export type DurableGameStatus =
  | 'dividing'
  | 'division_failed'
  | 'mapped'
  | 'playing'
  | 'completed'
  | 'answering'
  | 'answer_failed'
  | 'answered'
  | 'abandoned'
  | 'integrity_error'

export interface GameDivision {
  seed: string | number
  facets: readonly ProblemFacet[]
  parts: readonly ProblemPart[]
  model: string
  prompt?: string
}

/**
 * The complete player-visible game resource. Provider response identifiers,
 * usage ledgers, quota internals, provenance hashes, and Clerk identifiers are
 * intentionally absent.
 */
export interface DurableGame {
  id: string
  sourceGameId: string | null
  revision: number
  status: DurableGameStatus
  problem: string
  division: GameDivision | null
  state: GameView | null
  answer: GeneratedAnswer | null
}

export interface MoveGameCommand {
  expectedRevision: number
  pieceId: string
  to: CellCoord
}

export interface RevisionCommand {
  expectedRevision: number
}

export interface AnswerGameResult {
  game: DurableGame
  answer: GeneratedAnswer
}

export interface RetryLifecycleResult {
  game: DurableGame | null
  lifecycle: LifecycleAggregate
}

export interface CreateWilburActionCommand {
  charlotteActionIndex: number
  actor: string
  action: string
  testedAssumption: string
  expectedObservation: string
  decisionThreshold: string
  reviewHorizon: string
}

export interface UpdateWilburActionCommand {
  expectedRevision: number
  status: WilburActionStatus
}

export interface AppendWilburObservationCommand {
  observedAt: string
  observation: string
  evidenceClassification: string
  expectedEffect: string
  unexpectedEffect: string
  stakeholderResponse: string
  assumptionResult: AssumptionResult
  nextDecision: string
}

export type WebChessApiErrorKind =
  | 'authentication-required'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'rate-limited'
  | 'http-error'
  | 'invalid-response'
  | 'transport'

export class WebChessApiError extends Error {
  readonly kind: WebChessApiErrorKind
  readonly status: number | null
  readonly serverCode: string | null
  readonly retryAfterSeconds: number | null

  constructor(
    message: string,
    options: {
      kind: WebChessApiErrorKind
      status?: number | null
      serverCode?: string | null
      retryAfterSeconds?: number | null
      cause?: unknown
    },
  ) {
    super(message)
    this.name = 'WebChessApiError'
    this.kind = options.kind
    this.status = options.status ?? null
    this.serverCode = options.serverCode ?? null
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
    if (options.cause !== undefined) this.cause = options.cause
  }
}

export function isWebChessApiError(error: unknown): error is WebChessApiError {
  return error instanceof WebChessApiError
}

export interface RequestOptions {
  signal?: AbortSignal
}

export interface MutationOptions extends RequestOptions {
  /**
   * Reuse this value only when retrying the same intent after an ambiguous
   * transport failure. Ordinary callers should let the client create it.
   */
  idempotencyKey?: string
}

const GAME_STATUSES: ReadonlySet<string> = new Set<DurableGameStatus>([
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResponse(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidResponse(`${label} must be a non-empty string.`)
  }
  return value
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw invalidResponse(`${label} must be a non-negative integer.`)
  }
  return Number(value)
}

function invalidResponse(message: string, cause?: unknown): WebChessApiError {
  return new WebChessApiError(message, {
    kind: 'invalid-response',
    cause,
  })
}

function parseDivision(value: unknown): GameDivision | null {
  if (value === null) return null
  const division = recordOf(value, 'Game division')
  const seed = division.seed
  if (
    !(
      (typeof seed === 'string' && seed.length > 0) ||
      (typeof seed === 'number' && Number.isFinite(seed))
    )
  ) {
    throw invalidResponse('Game division seed is invalid.')
  }
  if (!Array.isArray(division.facets) || !Array.isArray(division.parts)) {
    throw invalidResponse('Game division is missing its facets or board parts.')
  }
  const prompt = division.prompt
  if (prompt !== undefined && typeof prompt !== 'string') {
    throw invalidResponse('Game division prompt is invalid.')
  }

  return {
    seed,
    facets: division.facets as ProblemFacet[],
    parts: division.parts as ProblemPart[],
    model: nonEmptyString(division.model, 'Game division model'),
    ...(prompt === undefined ? {} : { prompt }),
  }
}

function parseGameState(value: unknown): GameView | null {
  if (value === null) return null
  const state = recordOf(value, 'Game state')
  if (
    !state.versions ||
    typeof state.versions !== 'object' ||
    !Array.isArray(state.pieces) ||
    !Array.isArray(state.events) ||
    !Array.isArray(state.captures) ||
    (state.turn !== 'white' && state.turn !== 'black') ||
    !Number.isInteger(state.completedPlies) ||
    !Number.isInteger(state.quietPlies)
  ) {
    throw invalidResponse('Game state is incomplete.')
  }
  if (state.lastMove !== null && typeof state.lastMove !== 'object') {
    throw invalidResponse('Game last move is invalid.')
  }
  if (state.outcome !== null && typeof state.outcome !== 'object') {
    throw invalidResponse('Game outcome is invalid.')
  }
  return value as GameView
}

function parseAnswer(value: unknown): GeneratedAnswer | null {
  if (value === null) return null
  const answer = recordOf(value, 'Game answer')
  return {
    answer: nonEmptyString(answer.answer, 'Game answer text'),
    model: nonEmptyString(answer.model, 'Game answer model'),
    prompt: nonEmptyString(answer.prompt, 'Game answer prompt'),
  }
}

export function parseDurableGame(value: unknown): DurableGame {
  const game = recordOf(value, 'Game')
  const status = nonEmptyString(game.status, 'Game status')
  if (!GAME_STATUSES.has(status)) {
    throw invalidResponse(`Unsupported game status: ${status}.`)
  }
  if (
    game.sourceGameId !== null &&
    (typeof game.sourceGameId !== 'string' || game.sourceGameId.length === 0)
  ) {
    throw invalidResponse('Game source id is invalid.')
  }

  return {
    id: nonEmptyString(game.id, 'Game id'),
    sourceGameId: game.sourceGameId,
    revision: nonnegativeInteger(game.revision, 'Game revision'),
    status: status as DurableGameStatus,
    problem: nonEmptyString(game.problem, 'Game problem'),
    division: parseDivision(game.division),
    state: parseGameState(game.state),
    answer: parseAnswer(game.answer),
  }
}

function parseGameEnvelope(value: unknown): DurableGame {
  return parseDurableGame(recordOf(value, 'Response').game)
}

function parseCurrentGameEnvelope(value: unknown): DurableGame | null {
  const game = recordOf(value, 'Response').game
  return game === null ? null : parseDurableGame(game)
}

function parseAnswerEnvelope(value: unknown): AnswerGameResult {
  const response = recordOf(value, 'Response')
  const answer = parseAnswer(response.answer)
  if (!answer) throw invalidResponse('The answer response is incomplete.')
  return {
    game: parseDurableGame(response.game),
    answer,
  }
}

const LIFECYCLE_STATE_SET = new Set<string>(LIFECYCLE_STATES)
const RESEARCH_STAGE_SET = new Set<string>(RESEARCH_STAGES)
const RESEARCH_STATUS_SET = new Set<string>(RESEARCH_STATUSES)

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : nonEmptyString(value, label)
}

function timestampString(value: unknown, label: string): string {
  const timestamp = nonEmptyString(value, label)
  if (Number.isNaN(Date.parse(timestamp))) {
    throw invalidResponse(`${label} is invalid.`)
  }
  return timestamp
}

function parseResearchRecord(value: unknown): ResearchRecord {
  const research = recordOf(value, 'Lifecycle research')
  const stage = nonEmptyString(research.stage, 'Research stage')
  const status = nonEmptyString(research.status, 'Research status')
  if (!RESEARCH_STAGE_SET.has(stage) || !RESEARCH_STATUS_SET.has(status)) {
    throw invalidResponse('Lifecycle research stage or status is invalid.')
  }
  for (const [label, identifier] of [
    ['Research id', research.id],
    ['Research lifecycle run id', research.lifecycleRunId],
    ['Research game id', research.gameId],
  ] as const) {
    if (typeof identifier !== 'string' || !UUID_PATTERN.test(identifier)) {
      throw invalidResponse(`${label} is invalid.`)
    }
  }
  if (
    research.requestedBy !== 'research-policy' ||
    research.provider !== 'codex' ||
    research.transport !== 'local' ||
    research.directPageTextFetched !== false
  ) {
    throw invalidResponse('Lifecycle research attribution is invalid.')
  }
  const materiality = research.materiality
  if (
    materiality !== null &&
    materiality !== 'helpful' &&
    materiality !== 'required'
  ) {
    throw invalidResponse('Lifecycle research materiality is invalid.')
  }
  nonEmptyString(research.policyVersion, 'Research policy version')
  nonEmptyString(research.reason, 'Research reason')
  const query = nullableString(research.query, 'Research query')
  const model = nullableString(research.model, 'Research model')
  const bounds = recordOf(research.bounds, 'Research bounds')
  if (
    bounds.invocationLimit !== 1 ||
    nonnegativeInteger(bounds.resultLimit, 'Research result limit') < 1 ||
    nonnegativeInteger(bounds.sourceLimit, 'Research source limit') < 1 ||
    nonnegativeInteger(bounds.timeoutMs, 'Research timeout') < 1_000 ||
    nonnegativeInteger(
      bounds.synthesisCharacterLimit,
      'Research synthesis limit',
    ) < 500
  ) {
    throw invalidResponse('Lifecycle research bounds are invalid.')
  }
  const attemptCount = nonnegativeInteger(
    research.attemptCount,
    'Research attempt count',
  )
  if (attemptCount > 1) {
    throw invalidResponse('Lifecycle research attempt count is invalid.')
  }
  for (const [label, array] of [
    ['executed queries', research.executedQueries],
    ['retrieved facts', research.retrievedFacts],
    ['sources', research.sources],
    ['injection signals', research.injectionSignalsDetected],
  ] as const) {
    if (!Array.isArray(array)) {
      throw invalidResponse(`Lifecycle research ${label} must be an array.`)
    }
  }
  const executedQueryValues = research.executedQueries as unknown[]
  const retrievedFactValues = research.retrievedFacts as unknown[]
  const injectionSignalValues = research.injectionSignalsDetected as unknown[]
  if (
    retrievedFactValues.length !== 0 ||
    executedQueryValues.some(
      (item: unknown) => typeof item !== 'string' || item.trim().length === 0,
    ) ||
    injectionSignalValues.some(
      (item: unknown) => typeof item !== 'string' || item.trim().length === 0,
    )
  ) {
    throw invalidResponse('Lifecycle research evidence labels are invalid.')
  }
  const sourceIds = new Set<string>()
  for (const sourceValue of research.sources as unknown[]) {
    const source = recordOf(sourceValue, 'Research source')
    if (
      typeof source.id !== 'string' ||
      !UUID_PATTERN.test(source.id) ||
      typeof source.citationId !== 'string' ||
      source.citationId.length < 2 ||
      !Number.isSafeInteger(source.ordinal) ||
      (source.ordinal as number) < 1 ||
      typeof source.title !== 'string' ||
      source.title.trim().length === 0 ||
      typeof source.hostname !== 'string' ||
      source.hostname.trim().length === 0 ||
      !['government_or_education', 'general_web'].includes(
        source.trust as string,
      ) ||
      !['search_activity', 'synthesis_link'].includes(
        source.discoveredFrom as string,
      )
    ) {
      throw invalidResponse('Lifecycle research source is invalid.')
    }
    let url: URL
    try {
      url = new URL(nonEmptyString(source.url, 'Research source URL'))
    } catch {
      throw invalidResponse('Lifecycle research source URL is invalid.')
    }
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.hostname.toLowerCase() !== String(source.hostname).toLowerCase() ||
      url.hostname.toLowerCase() === 'localhost' ||
      url.hostname.toLowerCase().endsWith('.localhost') ||
      url.hostname.toLowerCase().endsWith('.local') ||
      url.hostname.toLowerCase().endsWith('.internal') ||
      /^(?:0|10|127|169\.254|172\.(?:1[6-9]|2\d|3[01])|192\.168)\./u.test(
        url.hostname,
      ) ||
      sourceIds.has(source.id)
    ) {
      throw invalidResponse('Lifecycle research source is unsafe or repeated.')
    }
    sourceIds.add(source.id)
    timestampString(source.createdAt, 'Research source creation time')
  }
  const searchSynthesis = nullableString(
    research.searchSynthesis,
    'Research search synthesis',
  )
  const contentDigest = nullableString(
    research.contentDigest,
    'Research content digest',
  )
  if (contentDigest !== null && !/^[0-9a-f]{64}$/u.test(contentDigest)) {
    throw invalidResponse('Lifecycle research content digest is invalid.')
  }
  nullableString(research.failureCode, 'Research failure code')
  const startedAt = research.startedAt === null
    ? null
    : timestampString(research.startedAt, 'Research start time')
  const completedAt = research.completedAt === null
    ? null
    : timestampString(research.completedAt, 'Research completion time')
  timestampString(research.createdAt, 'Research creation time')
  timestampString(research.updatedAt, 'Research update time')
  nonnegativeInteger(research.omittedSourceCount, 'Research omitted source count')
  if (
    status === 'not_needed'
      ? query !== null || materiality !== null || attemptCount !== 0
      : query === null || materiality === null || attemptCount !== 1
  ) {
    throw invalidResponse('Lifecycle research decision shape is invalid.')
  }
  if (
    status === 'searching'
      ? startedAt === null || completedAt !== null
      : completedAt === null
  ) {
    throw invalidResponse('Lifecycle research timing is invalid.')
  }
  if (
    status === 'completed' &&
    (model === null || searchSynthesis === null || contentDigest === null)
  ) {
    throw invalidResponse('Completed lifecycle research is incomplete.')
  }
  return research as unknown as ResearchRecord
}

function parseLifecycle(value: unknown): LifecycleAggregate {
  const lifecycle = recordOf(value, 'Lifecycle')
  const state = nonEmptyString(lifecycle.state, 'Lifecycle state')
  if (!LIFECYCLE_STATE_SET.has(state)) {
    throw invalidResponse(`Unsupported lifecycle state: ${state}.`)
  }
  for (const [field, item] of [
    ['survivors', lifecycle.survivors],
    ['wilburActions', lifecycle.wilburActions],
    ['wilburObservations', lifecycle.wilburObservations],
    ['activities', lifecycle.activities],
    ['research', lifecycle.research],
  ] as const) {
    if (!Array.isArray(item)) {
      throw invalidResponse(`Lifecycle ${field} must be an array.`)
    }
  }
  for (const field of ['versions'] as const) {
    recordOf(lifecycle[field], `Lifecycle ${field}`)
  }
  if (
    lifecycle.answerPromptDigest !== null &&
    (
      typeof lifecycle.answerPromptDigest !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(lifecycle.answerPromptDigest)
    )
  ) {
    throw invalidResponse('Lifecycle answer prompt digest is invalid.')
  }
  if (
    lifecycle.answerUserPrompt !== null &&
    (
      typeof lifecycle.answerUserPrompt !== 'string' ||
      lifecycle.answerUserPrompt.length < 1 ||
      lifecycle.answerUserPrompt.length > 200_000
    )
  ) {
    throw invalidResponse('Lifecycle player-visible answer prompt is invalid.')
  }
  if (
    lifecycle.answerUserPromptSha256 !== null &&
    (
      typeof lifecycle.answerUserPromptSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(lifecycle.answerUserPromptSha256)
    )
  ) {
    throw invalidResponse('Lifecycle player-visible answer prompt digest is invalid.')
  }
  if (
    (lifecycle.answerUserPrompt === null) !==
    (lifecycle.answerUserPromptSha256 === null)
  ) {
    throw invalidResponse(
      'Lifecycle player-visible answer prompt provenance is incomplete.',
    )
  }
  const portiaProgress = recordOf(
    lifecycle.portiaProgress,
    'Lifecycle Portia progress',
  )
  if (
    portiaProgress.currentCandidateId !== null &&
    (
      typeof portiaProgress.currentCandidateId !== 'string' ||
      portiaProgress.currentCandidateId.length < 3 ||
      portiaProgress.currentCandidateId.length > 220
    )
  ) {
    throw invalidResponse('Lifecycle current Portia candidate is invalid.')
  }
  if (
    !Array.isArray(portiaProgress.completedCandidateIds) ||
    portiaProgress.completedCandidateIds.some(
      (candidateId) =>
        typeof candidateId !== 'string' ||
        candidateId.length < 3 ||
        candidateId.length > 220,
    ) ||
    new Set(portiaProgress.completedCandidateIds).size !==
      portiaProgress.completedCandidateIds.length
  ) {
    throw invalidResponse('Lifecycle completed Portia candidates are invalid.')
  }
  const completedCandidateIds = portiaProgress.completedCandidateIds as unknown[]
  if (
    !Array.isArray(portiaProgress.completedAssessments) ||
    portiaProgress.completedAssessments.length >
      portiaProgress.completedCandidateIds.length ||
    portiaProgress.completedAssessments.some((assessment, index) => {
      if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) {
        return true
      }
      return (assessment as Record<string, unknown>).candidateId !==
        completedCandidateIds[index]
    })
  ) {
    throw invalidResponse('Lifecycle completed Portia assessments are invalid.')
  }
  for (const field of ['portia', 'gate', 'charlotte'] as const) {
    if (lifecycle[field] !== null) {
      recordOf(lifecycle[field], `Lifecycle ${field}`)
    }
  }
  if (
    lifecycle.answerUserPrompt !== null &&
    (
      lifecycle.gate === null ||
      recordOf(lifecycle.gate, 'Lifecycle gate').passed !== true
    )
  ) {
    throw invalidResponse(
      'Lifecycle player-visible answer prompt was not authorized by the Gate.',
    )
  }
  nonEmptyString(lifecycle.id, 'Lifecycle id')
  nonEmptyString(lifecycle.rootRunId, 'Lifecycle root id')
  nonEmptyString(lifecycle.gameId, 'Lifecycle game id')
  nonnegativeInteger(lifecycle.revision, 'Lifecycle revision')
  if (
    lifecycle.portiaActiveModelRequestId !== null &&
    (
      typeof lifecycle.portiaActiveModelRequestId !== 'string' ||
      !UUID_PATTERN.test(lifecycle.portiaActiveModelRequestId)
    )
  ) {
    throw invalidResponse('Lifecycle active Portia request id is invalid.')
  }
  nonnegativeInteger(
    lifecycle.portiaFailedAttemptCount,
    'Portia failed attempt count',
  )
  nonnegativeInteger(lifecycle.portiaFailureLimit, 'Portia failure limit')
  if (
    (lifecycle.portiaFailureLimit as number) < 1 ||
    (lifecycle.portiaFailureLimit as number) > 10 ||
    (lifecycle.portiaFailedAttemptCount as number) >
      (lifecycle.portiaFailureLimit as number)
  ) {
    throw invalidResponse('Portia failure budget is invalid.')
  }
  if (
    lifecycle.charlotteActiveModelRequestId !== null &&
    (
      typeof lifecycle.charlotteActiveModelRequestId !== 'string' ||
      !UUID_PATTERN.test(lifecycle.charlotteActiveModelRequestId)
    )
  ) {
    throw invalidResponse('Lifecycle active Charlotte request id is invalid.')
  }
  nonnegativeInteger(
    lifecycle.charlotteFailedAttemptCount,
    'Charlotte failed attempt count',
  )
  nonnegativeInteger(lifecycle.charlotteFailureLimit, 'Charlotte failure limit')
  if (
    (lifecycle.charlotteFailureLimit as number) < 1 ||
    (lifecycle.charlotteFailureLimit as number) > 10 ||
    (lifecycle.charlotteFailedAttemptCount as number) >
      (lifecycle.charlotteFailureLimit as number)
  ) {
    throw invalidResponse('Charlotte failure budget is invalid.')
  }
  nonnegativeInteger(lifecycle.sameFieldRetryCount, 'Same-field retry count')
  nonnegativeInteger(lifecycle.fieldRegenerationCount, 'Field regeneration count')
  for (const research of lifecycle.research as unknown[]) {
    parseResearchRecord(research)
  }
  return lifecycle as unknown as LifecycleAggregate
}

function parseLifecycleEnvelope(value: unknown): LifecycleAggregate {
  return parseLifecycle(recordOf(value, 'Response').lifecycle)
}

function parseRetryLifecycleEnvelope(value: unknown): RetryLifecycleResult {
  const response = recordOf(value, 'Response')
  return {
    game: response.game === null ? null : parseDurableGame(response.game),
    lifecycle: parseLifecycle(response.lifecycle),
  }
}

function parseProvenanceEnvelope(value: unknown): readonly LifecycleActivity[] {
  const activities = recordOf(value, 'Response').activities
  if (!Array.isArray(activities)) {
    throw invalidResponse('Lifecycle activities must be an array.')
  }
  return activities as unknown as readonly LifecycleActivity[]
}

function parseWilburActionEnvelope(value: unknown): WilburAction {
  return recordOf(
    recordOf(value, 'Response').action,
    'Wilbur action',
  ) as unknown as WilburAction
}

function parseWilburObservationEnvelope(value: unknown): WilburObservation {
  return recordOf(
    recordOf(value, 'Response').observation,
    'Wilbur observation',
  ) as unknown as WilburObservation
}

function apiErrorKind(status: number): WebChessApiErrorKind {
  switch (status) {
    case 401:
      return 'authentication-required'
    case 403:
      return 'forbidden'
    case 404:
      return 'not-found'
    case 409:
      return 'conflict'
    case 429:
      return 'rate-limited'
    default:
      return 'http-error'
  }
}

function defaultErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return 'Sign in to continue.'
    case 403:
      return 'You do not have permission to do that.'
    case 404:
      return 'The requested game was not found.'
    case 409:
      return 'The game changed before this request was accepted. Reload it and try again.'
    case 429:
      return 'Too many requests. Please wait before trying again.'
    default:
      return 'WebChess could not complete this request.'
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)

  const retryAt = Date.parse(value)
  if (!Number.isFinite(retryAt)) return null
  return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
}

function errorDetails(value: unknown): {
  message?: string
  code?: string
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const payload = value as Record<string, unknown>
  const nested =
    payload.error && typeof payload.error === 'object' && !Array.isArray(payload.error)
      ? (payload.error as Record<string, unknown>)
      : null
  const message =
    (typeof payload.error === 'string' && payload.error) ||
    (typeof payload.message === 'string' && payload.message) ||
    (typeof nested?.message === 'string' && nested.message) ||
    undefined
  const code =
    (typeof payload.code === 'string' && payload.code) ||
    (typeof nested?.code === 'string' && nested.code) ||
    undefined
  return { message, code }
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(
    signal?.aborted ||
      (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'),
  )
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return null
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    if (!response.ok) return null
    throw invalidResponse('WebChess returned malformed JSON.', error)
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: runtimeHeaders(init.headers),
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch (error) {
    if (isAbortError(error, init.signal ?? undefined)) throw error
    throw new WebChessApiError('WebChess could not reach the server.', {
      kind: 'transport',
      cause: error,
    })
  }

  const payload = await readJson(response)
  if (!response.ok) {
    const details = errorDetails(payload)
    throw new WebChessApiError(details.message ?? defaultErrorMessage(response.status), {
      kind: apiErrorKind(response.status),
      status: response.status,
      serverCode: details.code ?? null,
      retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
    })
  }

  return parse(payload)
}

function runtimeHeaders(headers: HeadersInit | undefined): Headers {
  const resolved = new Headers(headers)
  if (
    typeof window !== 'undefined' &&
    (window.location.pathname === '/openclaw' ||
      window.location.pathname.startsWith('/openclaw/'))
  ) {
    resolved.set('X-WebChess-OpenClaw-Runtime', 'webchess-2')
  }
  return resolved
}

function createMutationHeaders(idempotencyKey?: string): HeadersInit {
  const key = idempotencyKey ?? createIdempotencyKey()
  if (!UUID_PATTERN.test(key)) {
    throw new TypeError('The idempotency key must be a canonical UUID.')
  }
  return {
    Accept: 'application/json',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
  }
}

function getHeaders(): HeadersInit {
  return {
    Accept: 'application/json',
    'Cache-Control': 'no-store',
  }
}

function gamePath(gameId: string, action?: string): string {
  if (typeof gameId !== 'string' || gameId.trim().length === 0) {
    throw new TypeError('A game id is required.')
  }
  const base = `/api/games/${encodeURIComponent(gameId)}`
  return action ? `${base}/${action}` : base
}

function divisionIntentPath(idempotencyKey: string): string {
  if (
    typeof idempotencyKey !== 'string' ||
    !UUID_PATTERN.test(idempotencyKey)
  ) {
    throw new TypeError('A canonical division idempotency key is required.')
  }
  return `/api/division-intents/${encodeURIComponent(idempotencyKey.toLowerCase())}`
}

function validateRevision(expectedRevision: number): number {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new TypeError('Expected revision must be a non-negative integer.')
  }
  return expectedRevision
}

export function createIdempotencyKey(): string {
  if (
    typeof globalThis.crypto === 'undefined' ||
    typeof globalThis.crypto.randomUUID !== 'function'
  ) {
    throw new Error('This browser cannot create secure idempotency keys.')
  }
  return globalThis.crypto.randomUUID()
}

export function divideProblem(
  problem: string,
  options: MutationOptions = {},
): Promise<DurableGame> {
  if (typeof problem !== 'string') throw new TypeError('A problem is required.')
  return requestJson(
    '/api/divide',
    {
      method: 'POST',
      headers: createMutationHeaders(options.idempotencyKey),
      body: JSON.stringify({ problem }),
      signal: options.signal,
    },
    parseGameEnvelope,
  )
}

export function getCurrentGame(
  options: RequestOptions = {},
): Promise<DurableGame | null> {
  return requestJson(
    '/api/games/current',
    {
      method: 'GET',
      headers: getHeaders(),
      signal: options.signal,
    },
    parseCurrentGameEnvelope,
  )
}

export function getOwnedGame(
  gameId: string,
  options: RequestOptions = {},
): Promise<DurableGame> {
  return requestJson(
    gamePath(gameId),
    {
      method: 'GET',
      headers: getHeaders(),
      signal: options.signal,
    },
    parseGameEnvelope,
  )
}

export function recoverDivisionIntent(
  idempotencyKey: string,
  options: RequestOptions = {},
): Promise<DurableGame> {
  return requestJson(
    divisionIntentPath(idempotencyKey),
    {
      method: 'GET',
      headers: getHeaders(),
      signal: options.signal,
    },
    parseGameEnvelope,
  )
}

export function startGame(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<DurableGame> {
  return mutateGame(gameId, 'start', command, options)
}

export function submitMove(
  gameId: string,
  command: MoveGameCommand,
  options: MutationOptions = {},
): Promise<DurableGame> {
  const expectedRevision = validateRevision(command.expectedRevision)
  if (typeof command.pieceId !== 'string' || command.pieceId.trim().length === 0) {
    throw new TypeError('A piece id is required.')
  }
  if (
    !command.to ||
    !Number.isInteger(command.to.ring) ||
    !Number.isInteger(command.to.sector)
  ) {
    throw new TypeError('A move destination must use integer coordinates.')
  }

  return requestJson(
    gamePath(gameId, 'moves'),
    {
      method: 'POST',
      headers: createMutationHeaders(options.idempotencyKey),
      body: JSON.stringify({
        pieceId: command.pieceId,
        to: {
          ring: command.to.ring,
          sector: command.to.sector,
        },
        expectedRevision,
      }),
      signal: options.signal,
    },
    parseGameEnvelope,
  )
}

export function requestGameAnswer(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<AnswerGameResult> {
  return requestJson(
    gamePath(gameId, 'answer'),
    mutationInit(command, options),
    parseAnswerEnvelope,
  )
}

export function getGameLifecycle(
  gameId: string,
  options: RequestOptions = {},
): Promise<LifecycleAggregate> {
  return requestJson(
    gamePath(gameId, 'lifecycle'),
    { method: 'GET', headers: getHeaders(), signal: options.signal },
    parseLifecycleEnvelope,
  )
}

export function runPortia(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<LifecycleAggregate> {
  return mutateLifecycle(gameId, 'portia', command, options)
}

export function runCharlotte(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<LifecycleAggregate> {
  return mutateLifecycle(gameId, 'charlotte', command, options)
}

export function retryLifecycle(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<RetryLifecycleResult> {
  return requestJson(
    gamePath(gameId, 'retry'),
    mutationInit(command, options),
    parseRetryLifecycleEnvelope,
  )
}

export function getGameProvenance(
  gameId: string,
  options: RequestOptions = {},
): Promise<readonly LifecycleActivity[]> {
  return requestJson(
    gamePath(gameId, 'provenance'),
    { method: 'GET', headers: getHeaders(), signal: options.signal },
    parseProvenanceEnvelope,
  )
}

export function createWilburAction(
  gameId: string,
  command: CreateWilburActionCommand,
  options: MutationOptions = {},
): Promise<WilburAction> {
  return requestJson(
    gamePath(gameId, 'wilbur/actions'),
    {
      method: 'POST',
      headers: createMutationHeaders(options.idempotencyKey),
      body: JSON.stringify(command),
      signal: options.signal,
    },
    parseWilburActionEnvelope,
  )
}

export function updateWilburAction(
  gameId: string,
  actionId: string,
  command: UpdateWilburActionCommand,
  options: MutationOptions = {},
): Promise<WilburAction> {
  validateRevision(command.expectedRevision)
  return requestJson(
    `${gamePath(gameId, 'wilbur/actions')}/${encodeURIComponent(actionId)}`,
    {
      method: 'PATCH',
      headers: createMutationHeaders(options.idempotencyKey),
      body: JSON.stringify(command),
      signal: options.signal,
    },
    parseWilburActionEnvelope,
  )
}

export function appendWilburObservation(
  gameId: string,
  actionId: string,
  command: AppendWilburObservationCommand,
  options: MutationOptions = {},
): Promise<WilburObservation> {
  return requestJson(
    `${gamePath(gameId, 'wilbur/actions')}/${encodeURIComponent(actionId)}/observations`,
    {
      method: 'POST',
      headers: createMutationHeaders(options.idempotencyKey),
      body: JSON.stringify(command),
      signal: options.signal,
    },
    parseWilburObservationEnvelope,
  )
}

export function replayGame(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<DurableGame> {
  return mutateGame(gameId, 'replay', command, options)
}

export function abandonGame(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<DurableGame> {
  return mutateGame(gameId, 'abandon', command, options)
}

function mutationInit(
  command: RevisionCommand,
  options: MutationOptions,
): RequestInit {
  const expectedRevision = validateRevision(command.expectedRevision)
  return {
    method: 'POST',
    headers: createMutationHeaders(options.idempotencyKey),
    body: JSON.stringify({ expectedRevision }),
    signal: options.signal,
  }
}

function mutateGame(
  gameId: string,
  action: 'start' | 'replay' | 'abandon',
  command: RevisionCommand,
  options: MutationOptions,
): Promise<DurableGame> {
  return requestJson(
    gamePath(gameId, action),
    mutationInit(command, options),
    parseGameEnvelope,
  )
}

function mutateLifecycle(
  gameId: string,
  action: 'portia' | 'charlotte',
  command: RevisionCommand,
  options: MutationOptions,
): Promise<LifecycleAggregate> {
  return requestJson(
    gamePath(gameId, action),
    mutationInit(command, options),
    parseLifecycleEnvelope,
  )
}
