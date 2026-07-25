import type { PieceKind } from './types'

export const READING_DEPTH_SIGNALS = 7

export const MAX_QUIET_PLIES = 100

export const MAX_GAME_PLIES = 256

export const PIECE_ORDER: readonly PieceKind[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']

export const PIECE_GLYPHS: Readonly<Record<PieceKind, string>> = {
  king: '♔',
  queen: '♕',
  rook: '♖',
  bishop: '♗',
  knight: '♘',
  pawn: '♙',
}
