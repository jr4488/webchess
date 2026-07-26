import type { AutoMove, Piece, Side } from '../../types'
import type { EngineLineMove, EngineOptions } from './index'

export type EngineStopReason =
  | 'complete'
  | 'depth'
  | 'nodes'
  | 'time'
  | 'no-move'
  | 'game-over'

/**
 * Structured-clone-safe search details shared by the worker and its facade.
 * The optional fields let the engine grow without making the UI depend on
 * diagnostics that older search implementations do not report.
 */
export interface EngineAnalysis {
  nodes: number
  depth: number
  elapsedMs?: number
  score?: number
  nps?: number
  ttHits?: number
  principalVariation?: readonly EngineLineMove[]
  stopReason?: EngineStopReason
}

export interface EngineRequest {
  id: number
  pieces: readonly Piece[]
  side: Side
  seed: string | number
  options?: EngineOptions
}

export interface EngineResponse {
  id: number
  move: AutoMove | null
  analysis?: EngineAnalysis
  error?: string
}
