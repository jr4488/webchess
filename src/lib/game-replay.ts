import type {
  CaptureRecord,
  CellCoord,
  GameOutcome,
  Piece,
  ProblemPart,
  Side,
} from '../types'
import {
  CURRENT_GAME_VERSIONS,
  GAME_EVENT_VERSION,
} from './game-contract'
import type {
  ForcedPassGameEvent,
  GameEvent,
  GameRuleErrorCode,
  GameVersions,
  GameView,
  MoveAcceptance,
  MoveCommand,
  MoveGameEvent,
  ReplayState,
  ReplayValidationResult,
} from './game-contract'
import {
  BOARD_RINGS,
  BOARD_SECTORS,
  applyMove,
  createInitialPieces,
  getGameOutcome,
  getLegalMoves,
  hasLegalMove,
  isSameCoord,
  isValidCoord,
} from './game'

export class GameRuleError extends Error {
  readonly code: GameRuleErrorCode

  constructor(code: GameRuleErrorCode, message: string) {
    super(message)
    this.name = 'GameRuleError'
    this.code = code
  }
}

export class ReplayValidationError extends GameRuleError {
  readonly eventIndex: number | null

  constructor(message: string, eventIndex: number | null, cause?: unknown) {
    super('invalid-replay', message)
    this.name = 'ReplayValidationError'
    this.eventIndex = eventIndex
    if (cause !== undefined) {
      this.cause = cause
    }
  }
}

function otherSide(side: Side): Side {
  return side === 'white' ? 'black' : 'white'
}

function validateProblemParts(parts: readonly ProblemPart[]): void {
  const expected = BOARD_RINGS * BOARD_SECTORS
  if (parts.length !== expected) {
    throw new Error(`A WebChess replay requires exactly ${expected} problem parts; received ${parts.length}.`)
  }
}

function withTerminalCapture(
  outcome: GameOutcome | null,
  capture: CaptureRecord | undefined,
): GameOutcome | null {
  if (!outcome || capture?.captured.kind !== 'king') return outcome
  return { ...outcome, terminalCapture: capture }
}

function currentOutcome(state: ReplayState): GameOutcome | null {
  return state.outcome ?? getGameOutcome(state.pieces, {
    quietPlies: state.quietPlies,
    ply: state.completedPlies,
  })
}

/** Creates the only supported replay origin: the canonical 32-piece setup. */
export function createReplayState(): ReplayState {
  const pieces = createInitialPieces()
  return {
    versions: CURRENT_GAME_VERSIONS,
    pieces,
    turn: 'white',
    completedPlies: 0,
    quietPlies: 0,
    events: [],
    captures: [],
    lastMove: null,
    outcome: getGameOutcome(pieces, { quietPlies: 0, ply: 0 }),
  }
}

function validateExpectedPly(expectedPly: number, state: ReplayState): void {
  if (!Number.isInteger(expectedPly) || expectedPly < 1) {
    throw new GameRuleError('stale-ply', 'The move must identify a positive integer ply.')
  }

  const nextPly = state.completedPlies + 1
  if (expectedPly !== nextPly) {
    throw new GameRuleError(
      'stale-ply',
      `The game is at ply ${state.completedPlies}; the next move is ply ${nextPly}.`,
    )
  }
}

function validateDestination(destination: CellCoord): void {
  if (!destination || !isValidCoord(destination)) {
    const ring = destination?.ring
    const sector = destination?.sector
    throw new GameRuleError(
      'invalid-coordinate',
      `Invalid destination (${String(ring)}, ${String(sector)}).`,
    )
  }
}

interface AppliedMove {
  state: ReplayState
  event: MoveGameEvent
}

/**
 * Applies exactly one move. Passing is deliberately handled separately so a
 * replay cannot disguise a required pass as a client move.
 */
function applyCanonicalMove(
  state: ReplayState,
  command: MoveCommand,
  parts: readonly ProblemPart[],
): AppliedMove {
  const outcome = currentOutcome(state)
  if (outcome) {
    throw new GameRuleError('game-complete', 'This game is already complete.')
  }

  validateExpectedPly(command.expectedPly, state)
  if (typeof command.pieceId !== 'string' || command.pieceId.trim().length === 0) {
    throw new GameRuleError('invalid-piece', 'A move must identify a piece.')
  }
  validateDestination(command.to)

  const movingPiece = state.pieces.find((piece) => piece.id === command.pieceId)
  if (!movingPiece) {
    throw new GameRuleError('invalid-piece', `Unknown piece: ${command.pieceId}`)
  }
  if (movingPiece.side !== state.turn) {
    throw new GameRuleError(
      'wrong-side',
      `${movingPiece.id} belongs to ${movingPiece.side}; ${state.turn} moves at ply ${command.expectedPly}.`,
    )
  }

  const legal = getLegalMoves(movingPiece, state.pieces).some((destination) =>
    isSameCoord(destination, command.to),
  )
  if (!legal) {
    throw new GameRuleError(
      'illegal-move',
      `Illegal move for ${movingPiece.id} to (${command.to.ring}, ${command.to.sector}).`,
    )
  }

  const result = applyMove(
    state.pieces,
    movingPiece.id,
    command.to,
    parts,
    command.expectedPly,
  )
  const event: MoveGameEvent = {
    version: GAME_EVENT_VERSION,
    type: 'move',
    ply: command.expectedPly,
    side: state.turn,
    pieceId: movingPiece.id,
    from: { ...movingPiece.position },
    to: { ring: command.to.ring, sector: command.to.sector },
    ...(result.capture ? { capturedPieceId: result.capture.captured.id } : {}),
    ...(result.promoted ? { promotedTo: 'queen' as const } : {}),
  }
  const quietPlies = result.capture ? 0 : state.quietPlies + 1
  const resolvedOutcome = withTerminalCapture(
    getGameOutcome(result.pieces, {
      quietPlies,
      ply: command.expectedPly,
    }),
    result.capture,
  )

  return {
    event,
    state: {
      ...state,
      pieces: result.pieces,
      turn: resolvedOutcome ? state.turn : otherSide(state.turn),
      completedPlies: command.expectedPly,
      quietPlies,
      events: [...state.events, event],
      captures: result.capture ? [...state.captures, result.capture] : state.captures,
      lastMove: {
        from: { ...movingPiece.position },
        to: { ring: command.to.ring, sector: command.to.sector },
      },
      outcome: resolvedOutcome,
    },
  }
}

interface SettledPasses {
  state: ReplayState
  appendedEvents: readonly ForcedPassGameEvent[]
}

/**
 * Appends every pass forced by the authoritative board. Clients never submit
 * pass events. In the current two-sided rules this loop can add at most one
 * pass before the other side can move or the game ends.
 */
export function settleForcedPasses(state: ReplayState): SettledPasses {
  let nextState = state
  const appendedEvents: ForcedPassGameEvent[] = []

  while (!currentOutcome(nextState) && !hasLegalMove(nextState.pieces, nextState.turn)) {
    const ply = nextState.completedPlies + 1
    const event: ForcedPassGameEvent = {
      version: GAME_EVENT_VERSION,
      type: 'forced-pass',
      ply,
      side: nextState.turn,
      reason: 'no-legal-move',
    }
    const quietPlies = nextState.quietPlies + 1
    const outcome = getGameOutcome(nextState.pieces, { quietPlies, ply })

    nextState = {
      ...nextState,
      turn: outcome ? nextState.turn : otherSide(nextState.turn),
      completedPlies: ply,
      quietPlies,
      events: [...nextState.events, event],
      outcome,
    }
    appendedEvents.push(event)
  }

  const outcome = currentOutcome(nextState)
  if (outcome && nextState.outcome !== outcome) {
    nextState = { ...nextState, outcome }
  }

  return { state: nextState, appendedEvents }
}

/**
 * Accepts a client move command and returns only server-derived events. A
 * stale command, a wrong-side piece, a non-canonical coordinate, or an illegal
 * path is rejected before any state is returned.
 */
export function acceptMoveCommand(
  state: ReplayState,
  command: MoveCommand,
  parts: readonly ProblemPart[],
): MoveAcceptance {
  validateProblemParts(parts)
  const beforeMove = settleForcedPasses(state)
  const applied = applyCanonicalMove(beforeMove.state, command, parts)
  const afterMove = settleForcedPasses(applied.state)

  return {
    state: afterMove.state,
    appendedEvents: [
      ...beforeMove.appendedEvents,
      applied.event,
      ...afterMove.appendedEvents,
    ],
  }
}

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function eventInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`${label} must be a positive integer.`)
  }
  return Number(value)
}

function eventSide(value: unknown): Side {
  if (value !== 'white' && value !== 'black') {
    throw new Error('Event side must be white or black.')
  }
  return value
}

function eventCoord(value: unknown, label: string): CellCoord {
  const record = recordOf(value, label)
  const coord = { ring: record.ring as number, sector: record.sector as number }
  if (!isValidCoord(coord)) {
    throw new Error(`${label} is not a canonical board coordinate.`)
  }
  return coord
}

function parseEvent(value: unknown): GameEvent {
  const record = recordOf(value, 'Game event')
  if (record.version !== GAME_EVENT_VERSION) {
    throw new Error(`Unsupported game event version: ${String(record.version)}.`)
  }

  const ply = eventInteger(record.ply, 'Event ply')
  const side = eventSide(record.side)
  if (record.type === 'forced-pass') {
    if (record.reason !== 'no-legal-move') {
      throw new Error('A forced pass must use the no-legal-move reason.')
    }
    return {
      version: GAME_EVENT_VERSION,
      type: 'forced-pass',
      ply,
      side,
      reason: 'no-legal-move',
    }
  }

  if (record.type !== 'move') {
    throw new Error(`Unsupported game event type: ${String(record.type)}.`)
  }
  if (typeof record.pieceId !== 'string' || record.pieceId.trim().length === 0) {
    throw new Error('A move event must identify a piece.')
  }
  if (
    record.capturedPieceId !== undefined &&
    (typeof record.capturedPieceId !== 'string' || record.capturedPieceId.length === 0)
  ) {
    throw new Error('A captured piece id must be a non-empty string.')
  }
  if (record.promotedTo !== undefined && record.promotedTo !== 'queen') {
    throw new Error('WebChess pawns can only promote to queen.')
  }

  return {
    version: GAME_EVENT_VERSION,
    type: 'move',
    ply,
    side,
    pieceId: record.pieceId,
    from: eventCoord(record.from, 'Move origin'),
    to: eventCoord(record.to, 'Move destination'),
    ...(record.capturedPieceId === undefined
      ? {}
      : { capturedPieceId: record.capturedPieceId }),
    ...(record.promotedTo === undefined ? {} : { promotedTo: 'queen' as const }),
  }
}

function applyReplayPass(state: ReplayState, event: ForcedPassGameEvent): ReplayState {
  const outcome = currentOutcome(state)
  if (outcome) {
    throw new Error('A completed game cannot contain another event.')
  }
  if (event.ply !== state.completedPlies + 1) {
    throw new Error(`Expected ply ${state.completedPlies + 1}; received ${event.ply}.`)
  }
  if (event.side !== state.turn) {
    throw new Error(`Expected ${state.turn} at ply ${event.ply}; received ${event.side}.`)
  }
  if (hasLegalMove(state.pieces, state.turn)) {
    throw new Error(`${state.turn} has a legal move and cannot pass.`)
  }

  const quietPlies = state.quietPlies + 1
  const resolvedOutcome = getGameOutcome(state.pieces, {
    quietPlies,
    ply: event.ply,
  })
  return {
    ...state,
    turn: resolvedOutcome ? state.turn : otherSide(state.turn),
    completedPlies: event.ply,
    quietPlies,
    events: [...state.events, event],
    outcome: resolvedOutcome,
  }
}

function applyReplayMove(
  state: ReplayState,
  event: MoveGameEvent,
  parts: readonly ProblemPart[],
): ReplayState {
  if (!hasLegalMove(state.pieces, state.turn)) {
    throw new Error(`A forced pass is required for ${state.turn} before another move.`)
  }

  let applied: AppliedMove
  try {
    applied = applyCanonicalMove(
      state,
      { expectedPly: event.ply, pieceId: event.pieceId, to: event.to },
      parts,
    )
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'The move is invalid.', {
      cause: error,
    })
  }

  const canonical = applied.event
  if (event.side !== canonical.side) {
    throw new Error(`Expected ${canonical.side} at ply ${event.ply}; received ${event.side}.`)
  }
  if (!isSameCoord(event.from, canonical.from)) {
    throw new Error(`Move origin for ${event.pieceId} does not match the replayed board.`)
  }
  if (event.capturedPieceId !== canonical.capturedPieceId) {
    throw new Error(`Capture metadata for ${event.pieceId} does not match the replayed board.`)
  }
  if (event.promotedTo !== canonical.promotedTo) {
    throw new Error(`Promotion metadata for ${event.pieceId} does not match the replayed board.`)
  }

  return applied.state
}

/**
 * Reconstructs a game only from the canonical initial position and validates
 * every persisted event against the shared rules implementation.
 */
export function replayGameEvents(
  events: readonly unknown[],
  parts: readonly ProblemPart[],
): ReplayState {
  validateProblemParts(parts)
  let state = createReplayState()

  for (let index = 0; index < events.length; index += 1) {
    try {
      const event = parseEvent(events[index])
      state = event.type === 'move'
        ? applyReplayMove(state, event, parts)
        : applyReplayPass(state, event)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid game event.'
      throw new ReplayValidationError(`Event ${index + 1}: ${message}`, index, error)
    }
  }

  if (!state.outcome && !hasLegalMove(state.pieces, state.turn)) {
    throw new ReplayValidationError(
      `Event ${events.length + 1}: a forced pass for ${state.turn} is missing.`,
      events.length,
    )
  }

  return state
}

/** Concise alias used by persistence and route layers. */
export const replayGame = replayGameEvents

export function validateReplay(
  events: readonly unknown[],
  parts: readonly ProblemPart[],
): ReplayValidationResult {
  try {
    return { valid: true, state: replayGameEvents(events, parts) }
  } catch (error) {
    if (error instanceof ReplayValidationError) {
      return {
        valid: false,
        error: error.message,
        eventIndex: error.eventIndex,
      }
    }
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid game replay.',
      eventIndex: null,
    }
  }
}

export function isCurrentGameVersions(value: unknown): value is GameVersions {
  if (!value || typeof value !== 'object') return false
  const versions = value as Partial<GameVersions>
  return (
    versions.event === CURRENT_GAME_VERSIONS.event &&
    versions.rules === CURRENT_GAME_VERSIONS.rules &&
    versions.cast === CURRENT_GAME_VERSIONS.cast &&
    versions.engine === CURRENT_GAME_VERSIONS.engine
  )
}

function clonePiece(piece: Piece): Piece {
  return { ...piece, position: { ...piece.position } }
}

function cloneCapture(capture: CaptureRecord): CaptureRecord {
  return {
    ...capture,
    attacker: clonePiece(capture.attacker),
    captured: clonePiece(capture.captured),
    cell: { ...capture.cell },
    part: { ...capture.part },
  }
}

function cloneEvent(event: GameEvent): GameEvent {
  if (event.type === 'forced-pass') return { ...event }
  return {
    ...event,
    from: { ...event.from },
    to: { ...event.to },
  }
}

/** Returns a detached, JSON-safe view so callers cannot mutate replay state. */
export function toGameView(state: ReplayState): GameView {
  const captures = state.captures.map(cloneCapture)
  const terminalCapture = state.outcome?.terminalCapture
    ? cloneCapture(state.outcome.terminalCapture)
    : undefined

  return {
    versions: { ...state.versions },
    pieces: state.pieces.map(clonePiece),
    turn: state.turn,
    completedPlies: state.completedPlies,
    quietPlies: state.quietPlies,
    events: state.events.map(cloneEvent),
    captures,
    lastMove: state.lastMove
      ? { from: { ...state.lastMove.from }, to: { ...state.lastMove.to } }
      : null,
    outcome: state.outcome
      ? {
          ...state.outcome,
          ...(terminalCapture ? { terminalCapture } : {}),
        }
      : null,
  }
}
