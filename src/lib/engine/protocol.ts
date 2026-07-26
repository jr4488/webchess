import type { AutoMove, Piece, Side } from '../../types'
import type { EngineOptions } from './index'

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
  error?: string
}
