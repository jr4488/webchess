import type { GameView } from './game-contract'
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
