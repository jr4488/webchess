'use client'

import { composeProblemParts } from './division'
import {
  acceptMoveCommand,
  createReplayState,
  replayGameEvents,
  toGameView,
} from './game-replay'
import { normalizeProblemInput } from './problem'
import {
  createIdempotencyKey,
  parseDurableGame,
  WebChessApiError,
} from './webchess-api'
import type {
  AnswerGameResult,
  DurableGame,
  GameDivision,
  MoveGameCommand,
  MutationOptions,
  RequestOptions,
  RevisionCommand,
} from './webchess-api'
import type { GeneratedAnswer, ProblemFacet, ProblemPart } from '../types'

export const OPENCLAW_GAME_STORAGE_KEY = 'webchess.openclaw.game.v1'

interface DivisionResponse {
  division: {
    seed: string | number
    facets: readonly ProblemFacet[]
    model: string
    parts: readonly ProblemPart[]
    prompt: string
  }
}

type AnswerResponse = GeneratedAnswer

interface StatusResponse {
  available: boolean
  version?: string
  model?: string
  transport?: 'local' | 'gateway'
}

function localStorageForWebChess(): Storage {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new WebChessApiError(
      'The local WebChess save is available only in a browser on this machine.',
      { kind: 'transport' },
    )
  }
  return window.localStorage
}

function invalidLocalData(message: string, cause?: unknown): WebChessApiError {
  return new WebChessApiError(message, {
    kind: 'invalid-response',
    cause,
  })
}

function assertCurrentGame(
  gameId: string,
  expectedRevision: number,
): DurableGame {
  const game = readStoredGame()
  if (!game || game.id !== gameId) {
    throw new WebChessApiError('The requested local game was not found.', {
      kind: 'not-found',
      status: 404,
    })
  }
  if (game.revision !== expectedRevision) {
    throw new WebChessApiError(
      'The local game changed in another tab. Restore it and try again.',
      {
        kind: 'conflict',
        status: 409,
      },
    )
  }
  return game
}

function canonicalDivision(game: DurableGame): GameDivision {
  if (!game.division) {
    throw invalidLocalData('The local game does not contain a completed division.')
  }

  let parts: ProblemPart[]
  try {
    parts = composeProblemParts(game.division.facets, game.division.seed)
  } catch (error) {
    throw invalidLocalData('The saved 64-part cast is invalid.', error)
  }
  if (JSON.stringify(parts) !== JSON.stringify(game.division.parts)) {
    throw invalidLocalData(
      'The saved cast no longer matches its facets and seed.',
    )
  }
  return {
    ...game.division,
    parts,
  }
}

function canonicalStoredGame(value: unknown): DurableGame {
  const game = parseDurableGame(value)
  const normalizedProblem = normalizeProblemInput(game.problem)
  if (
    normalizedProblem !== game.problem ||
    normalizedProblem.length < 12 ||
    normalizedProblem.length > 240
  ) {
    throw invalidLocalData('The saved question is outside the supported 12–240 character range.')
  }
  if (!game.division || !game.state) {
    throw invalidLocalData('The saved local game is incomplete.')
  }

  const division = canonicalDivision(game)
  let replay
  try {
    replay = replayGameEvents(game.state.events, division.parts)
  } catch (error) {
    throw invalidLocalData(
      'The saved move history could not be verified against the current rules.',
      error,
    )
  }

  const terminalStatus = (
    game.status === 'completed' ||
    game.status === 'answer_failed' ||
    game.status === 'answered'
  )
  if (terminalStatus !== Boolean(replay.outcome)) {
    throw invalidLocalData('The saved game status does not match its verified ending.')
  }
  if (game.status === 'answered' && !game.answer) {
    throw invalidLocalData('The saved game is marked answered but has no validated answer.')
  }
  if (game.answer && game.status !== 'answered') {
    throw invalidLocalData('The saved answer has an inconsistent game status.')
  }
  if (
    game.status !== 'mapped' &&
    game.status !== 'playing' &&
    !terminalStatus
  ) {
    throw invalidLocalData(`Unsupported local game status: ${game.status}.`)
  }

  return {
    ...game,
    division,
    state: toGameView(replay),
  }
}

function readStoredGame(): DurableGame | null {
  const raw = localStorageForWebChess().getItem(OPENCLAW_GAME_STORAGE_KEY)
  if (!raw) return null
  try {
    return canonicalStoredGame(JSON.parse(raw) as unknown)
  } catch (error) {
    if (error instanceof WebChessApiError) throw error
    throw invalidLocalData('The local WebChess save is not valid JSON.', error)
  }
}

function writeStoredGame(game: DurableGame): DurableGame {
  const canonical = canonicalStoredGame(game)
  try {
    localStorageForWebChess().setItem(
      OPENCLAW_GAME_STORAGE_KEY,
      JSON.stringify(canonical),
    )
  } catch (error) {
    throw new WebChessApiError(
      'The browser could not save this local game. Check private browsing or storage settings.',
      {
        kind: 'transport',
        cause: error,
      },
    )
  }
  return canonical
}

function apiErrorKind(status: number): WebChessApiError['kind'] {
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate-limited'
  return 'http-error'
}

function errorDetails(value: unknown): {
  code: string | null
  message: string | null
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { code: null, message: null }
  }
  const error = (value as Record<string, unknown>).error
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return { code: null, message: null }
  }
  const record = error as Record<string, unknown>
  return {
    code: typeof record.code === 'string' ? record.code : null,
    message: typeof record.message === 'string' ? record.message : null,
  }
}

async function requestLocalJson(
  path: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch (error) {
    if (init.signal?.aborted) throw error
    throw new WebChessApiError(
      'The local WebChess process could not be reached. Relaunch it through OpenClaw.',
      {
        kind: 'transport',
        cause: error,
      },
    )
  }

  let value: unknown
  try {
    const text = await response.text()
    value = text ? JSON.parse(text) as unknown : null
  } catch (error) {
    throw invalidLocalData('The local WebChess process returned malformed JSON.', error)
  }

  if (!response.ok) {
    const details = errorDetails(value)
    throw new WebChessApiError(
      details.message ?? 'The local OpenClaw request could not be completed.',
      {
        kind: apiErrorKind(response.status),
        status: response.status,
        serverCode: details.code,
      },
    )
  }
  return value
}

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidLocalData(`${label} is missing or invalid.`)
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidLocalData(`${label} is missing or invalid.`)
  }
  return value.trim()
}

function parseStatusResponse(value: unknown): StatusResponse {
  const response = recordOf(value, 'OpenClaw status')
  if (typeof response.available !== 'boolean') {
    throw invalidLocalData('OpenClaw status did not report availability.')
  }
  if (!response.available) {
    throw new WebChessApiError(
      'OpenClaw is not ready for model requests. Configure a default model and authentication, then try again.',
      { kind: 'http-error' },
    )
  }
  return {
    available: true,
    ...(typeof response.version === 'string' ? { version: response.version } : {}),
    ...(typeof response.model === 'string' ? { model: response.model } : {}),
    ...(response.transport === 'local' || response.transport === 'gateway'
      ? { transport: response.transport }
      : {}),
  }
}

function parseDivisionResponse(value: unknown): DivisionResponse {
  const response = recordOf(value, 'Division response')
  const division = recordOf(response.division, 'Division')
  const seed = division.seed
  if (
    !(
      (typeof seed === 'string' && seed.length > 0) ||
      (typeof seed === 'number' && Number.isFinite(seed))
    )
  ) {
    throw invalidLocalData('The local division seed is invalid.')
  }
  if (!Array.isArray(division.facets) || !Array.isArray(division.parts)) {
    throw invalidLocalData('The local division is missing its facets or board parts.')
  }

  const facets = division.facets as ProblemFacet[]
  let canonicalParts: ProblemPart[]
  try {
    canonicalParts = composeProblemParts(facets, seed)
  } catch (error) {
    throw invalidLocalData('OpenClaw did not return a valid 64-facet division.', error)
  }
  if (JSON.stringify(canonicalParts) !== JSON.stringify(division.parts)) {
    throw invalidLocalData('The returned board cast does not match its validated facets.')
  }

  return {
    division: {
      seed,
      facets,
      model: nonEmptyString(division.model, 'Division model'),
      parts: canonicalParts,
      prompt: nonEmptyString(division.prompt, 'Division prompt'),
    },
  }
}

function parseAnswerResponse(value: unknown): AnswerResponse {
  const response = recordOf(value, 'Answer response')
  const answer = recordOf(response.answer, 'Answer')
  return {
    answer: nonEmptyString(answer.answer, 'Answer text'),
    model: nonEmptyString(answer.model, 'Answer model'),
    prompt: nonEmptyString(answer.prompt, 'Answer prompt'),
  }
}

function validateRevision(command: RevisionCommand): number {
  if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 0) {
    throw new TypeError('Expected revision must be a non-negative integer.')
  }
  return command.expectedRevision
}

export async function getCurrentGame(
  options: RequestOptions = {},
): Promise<DurableGame | null> {
  const saved = readStoredGame()
  if (saved) return saved
  parseStatusResponse(await requestLocalJson('/api/openclaw/status', {
    method: 'GET',
    signal: options.signal,
  }))
  return null
}

export async function getOwnedGame(
  gameId: string,
  _options: RequestOptions = {},
): Promise<DurableGame> {
  void _options
  const game = readStoredGame()
  if (!game || game.id !== gameId) {
    throw new WebChessApiError('The requested local game was not found.', {
      kind: 'not-found',
      status: 404,
    })
  }
  return game
}

export async function recoverDivisionIntent(
  idempotencyKey: string,
  options: RequestOptions = {},
): Promise<DurableGame> {
  return getOwnedGame(idempotencyKey, options)
}

export async function divideProblem(
  problem: string,
  options: MutationOptions = {},
): Promise<DurableGame> {
  const normalized = normalizeProblemInput(problem)
  if (normalized.length < 12 || normalized.length > 240) {
    throw new TypeError('A WebChess question must contain 12–240 characters.')
  }
  const value = await requestLocalJson('/api/openclaw/divide', {
    method: 'POST',
    body: JSON.stringify({ problem: normalized }),
    signal: options.signal,
  })
  const generated = parseDivisionResponse(value)
  const id = options.idempotencyKey ?? createIdempotencyKey()
  return writeStoredGame({
    id,
    sourceGameId: null,
    revision: 1,
    status: 'mapped',
    problem: normalized,
    division: {
      ...generated.division,
    },
    state: toGameView(createReplayState()),
    answer: null,
  })
}

export async function startGame(
  gameId: string,
  command: RevisionCommand,
  _options: MutationOptions = {},
): Promise<DurableGame> {
  void _options
  const game = assertCurrentGame(gameId, validateRevision(command))
  if (game.status !== 'mapped') {
    throw new WebChessApiError('Only a mapped local game can be started.', {
      kind: 'conflict',
      status: 409,
    })
  }
  return writeStoredGame({
    ...game,
    revision: game.revision + 1,
    status: 'playing',
    state: toGameView(createReplayState()),
  })
}

export async function submitMove(
  gameId: string,
  command: MoveGameCommand,
  _options: MutationOptions = {},
): Promise<DurableGame> {
  void _options
  const game = assertCurrentGame(gameId, command.expectedRevision)
  if (game.status !== 'playing' || !game.state) {
    throw new WebChessApiError('This local game is not accepting moves.', {
      kind: 'conflict',
      status: 409,
    })
  }
  const division = canonicalDivision(game)
  let replay
  try {
    replay = replayGameEvents(game.state.events, division.parts)
    replay = acceptMoveCommand(
      replay,
      {
        expectedPly: replay.completedPlies + 1,
        pieceId: command.pieceId,
        to: command.to,
      },
      division.parts,
    ).state
  } catch (error) {
    throw new WebChessApiError(
      error instanceof Error ? error.message : 'That move is not legal.',
      {
        kind: 'conflict',
        status: 409,
        cause: error,
      },
    )
  }

  return writeStoredGame({
    ...game,
    division,
    revision: game.revision + 1,
    status: replay.outcome ? 'completed' : 'playing',
    state: toGameView(replay),
    answer: null,
  })
}

export async function requestGameAnswer(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<AnswerGameResult> {
  const game = assertCurrentGame(gameId, validateRevision(command))
  if (
    (game.status !== 'completed' && game.status !== 'answer_failed') ||
    !game.state?.outcome
  ) {
    throw new WebChessApiError(
      'The local game must reach a verified ending before an answer is requested.',
      {
        kind: 'conflict',
        status: 409,
      },
    )
  }
  const division = canonicalDivision(game)

  let answer: GeneratedAnswer
  try {
    const value = await requestLocalJson('/api/openclaw/answer', {
      method: 'POST',
      body: JSON.stringify({
        problem: game.problem,
        division: {
          seed: division.seed,
          facets: division.facets,
        },
        events: game.state.events,
      }),
      signal: options.signal,
    })
    answer = parseAnswerResponse(value)
  } catch (error) {
    const current = assertCurrentGame(gameId, game.revision)
    writeStoredGame({
      ...current,
      division: canonicalDivision(current),
      status: 'answer_failed',
      answer: null,
    })
    throw error
  }

  const current = assertCurrentGame(gameId, game.revision)
  const answered = writeStoredGame({
    ...current,
    division: canonicalDivision(current),
    revision: current.revision + 1,
    status: 'answered',
    answer,
  })
  return { game: answered, answer }
}

export async function replayGame(
  gameId: string,
  command: RevisionCommand,
  options: MutationOptions = {},
): Promise<DurableGame> {
  const game = assertCurrentGame(gameId, validateRevision(command))
  const division = canonicalDivision(game)
  return writeStoredGame({
    id: options.idempotencyKey ?? createIdempotencyKey(),
    sourceGameId: game.id,
    revision: 1,
    status: 'mapped',
    problem: game.problem,
    division,
    state: toGameView(createReplayState()),
    answer: null,
  })
}

export async function abandonGame(
  gameId: string,
  command: RevisionCommand,
  _options: MutationOptions = {},
): Promise<DurableGame> {
  void _options
  const game = assertCurrentGame(gameId, validateRevision(command))
  localStorageForWebChess().removeItem(OPENCLAW_GAME_STORAGE_KEY)
  return {
    ...game,
    revision: game.revision + 1,
    status: 'abandoned',
  }
}

export { createIdempotencyKey }
