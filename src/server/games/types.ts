import type {
  GameEvent,
  GameView,
} from '../../lib/game-contract'
import type {
  DivisionAnalysis,
  GeneratedAnswer,
  ProblemFacet,
  ProblemPart,
} from '../../types'
import type { ResearchConsent } from '../../lib/research'
import type { GameStatus } from '../db'

export type DurableGameStatus = GameStatus

export interface DurableDivision {
  readonly seed: string
  readonly facets: readonly ProblemFacet[]
  readonly parts: readonly ProblemPart[]
  readonly model: string
  readonly promptVersion: string
  readonly promptSha256: string
  readonly digest: string
}

/**
 * Owner-safe representation of a persisted game. The Clerk user id is never
 * included; ownership remains an input to every repository operation.
 */
export interface DurableGameSnapshot {
  readonly id: string
  readonly sourceGameId: string | null
  readonly isCurrent: boolean
  readonly revision: number
  readonly status: DurableGameStatus
  readonly problem: string
  readonly researchConsent: ResearchConsent
  readonly division: DurableDivision | null
  readonly game: GameView | null
  readonly answer: GeneratedAnswer | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly completedAt: Date | null
  readonly answeredAt: Date | null
}

export interface TerminalGameSnapshot extends DurableGameSnapshot {
  readonly division: DurableDivision
  readonly game: GameView & {
    readonly outcome: NonNullable<GameView['outcome']>
  }
}

export interface CreateDivisionInput {
  readonly ownerId: string
  readonly problem: string
  readonly softwareVersion: string
  /** Required for a new root game; field retries inherit the source game. */
  readonly researchConsent?: Omit<ResearchConsent, 'recordedAt'>
  readonly gameId?: string
  /** Present only when Retry deliberately regenerates a parent run's field. */
  readonly sourceGameId?: string
}

export interface CreateDivisionResult {
  readonly game: DurableGameSnapshot
  readonly created: boolean
}

export interface FinishDivisionInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly analysis: DivisionAnalysis
  readonly parts: readonly ProblemPart[]
  readonly promptVersion: string
}

export interface StartGameInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}

export interface AppendMoveInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
  /**
   * The repository derives the next ply from authoritative replay. Keeping it
   * out of the HTTP command also makes a retry hash stable after success.
   */
  readonly command: {
    readonly pieceId: string
    readonly to: {
      readonly ring: number
      readonly sector: number
    }
  }
}

export interface MoveMutationResult {
  readonly game: DurableGameSnapshot
  readonly appendedEvents: readonly GameEvent[]
  readonly idempotent: boolean
}

export interface StoreAnswerInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly answer: GeneratedAnswer
}

export interface ChangeAnswerStatusInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
}

export interface AbandonGameInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
