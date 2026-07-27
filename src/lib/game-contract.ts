import type {
  CaptureRecord,
  CellCoord,
  GameOutcome,
  LastMove,
  Piece,
  Side,
} from '../types'

/**
 * Persisted games keep these identifiers so a future rules, casting, or
 * engine change cannot silently reinterpret an existing game.
 */
export const WEBCHESS_RULES_VERSION = 'circular-direct-king-v1' as const
export const WEBCHESS_CAST_VERSION = 'independent-three-shuffle-v1' as const
export const WEBCHESS_ENGINE_VERSION = 'engine-v2' as const
export const GAME_EVENT_VERSION = 1 as const

export interface GameVersions {
  event: typeof GAME_EVENT_VERSION
  rules: typeof WEBCHESS_RULES_VERSION
  cast: typeof WEBCHESS_CAST_VERSION
  engine: typeof WEBCHESS_ENGINE_VERSION
}

export const CURRENT_GAME_VERSIONS: Readonly<GameVersions> = Object.freeze({
  event: GAME_EVENT_VERSION,
  rules: WEBCHESS_RULES_VERSION,
  cast: WEBCHESS_CAST_VERSION,
  engine: WEBCHESS_ENGINE_VERSION,
})

export interface MoveCommand {
  /** The next ply the client believes it is submitting. */
  expectedPly: number
  pieceId: string
  to: CellCoord
}

export interface MoveGameEvent {
  version: typeof GAME_EVENT_VERSION
  type: 'move'
  ply: number
  side: Side
  pieceId: string
  from: CellCoord
  to: CellCoord
  capturedPieceId?: string
  promotedTo?: 'queen'
}

export interface ForcedPassGameEvent {
  version: typeof GAME_EVENT_VERSION
  type: 'forced-pass'
  ply: number
  side: Side
  reason: 'no-legal-move'
}

export type GameEvent = MoveGameEvent | ForcedPassGameEvent

/**
 * The authoritative result of replaying a game's append-only event log.
 * Callers should reconstruct this state instead of trusting a client snapshot.
 */
export interface ReplayState {
  versions: Readonly<GameVersions>
  pieces: readonly Piece[]
  turn: Side
  completedPlies: number
  quietPlies: number
  events: readonly GameEvent[]
  captures: readonly CaptureRecord[]
  lastMove: LastMove | null
  outcome: GameOutcome | null
}

/**
 * Serializable state returned to a signed-in player. It contains no
 * server-only provenance, quota, or provider data.
 */
export interface GameView {
  versions: Readonly<GameVersions>
  pieces: readonly Piece[]
  turn: Side
  completedPlies: number
  quietPlies: number
  events: readonly GameEvent[]
  captures: readonly CaptureRecord[]
  lastMove: LastMove | null
  outcome: GameOutcome | null
}

export interface MoveAcceptance {
  state: ReplayState
  /** Canonical events appended while accepting this command, including passes. */
  appendedEvents: readonly GameEvent[]
}

export type GameRuleErrorCode =
  | 'game-complete'
  | 'stale-ply'
  | 'invalid-piece'
  | 'invalid-coordinate'
  | 'wrong-side'
  | 'illegal-move'
  | 'invalid-replay'

export interface ReplayValidationSuccess {
  valid: true
  state: ReplayState
}

export interface ReplayValidationFailure {
  valid: false
  error: string
  eventIndex: number | null
}

export type ReplayValidationResult =
  | ReplayValidationSuccess
  | ReplayValidationFailure
