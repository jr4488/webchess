import type { AutoMove, GameOutcome, Piece, Side } from '../types'
import { applyMove, createInitialPieces, getGameOutcome, hasLegalMove } from '../lib/game'
import { makeProblemParts } from './fixtures'

export type MoveChooser = (
  pieces: readonly Piece[],
  side: Side,
  seed: string | number,
  ply: number,
  quietPlies: number,
) => AutoMove | null

export interface MatchResult {
  outcome: GameOutcome
  plies: number
  captures: number
  /** Material left on the board for each side, in classic piece points. */
  material: Record<Side, number>
}

const POINTS: Record<Piece['kind'], number> = {
  king: 0,
  queen: 9,
  rook: 5,
  bishop: 3,
  knight: 3,
  pawn: 1,
}

function materialOf(pieces: readonly Piece[], side: Side): number {
  return pieces
    .filter((piece) => piece.side === side)
    .reduce((total, piece) => total + POINTS[piece.kind], 0)
}

/**
 * Plays one full game between two move choosers, following the same turn,
 * passing, and ending rules the app uses so the result reflects real play.
 */
export function playMatch(options: {
  white: MoveChooser
  black: MoveChooser
  seed: string
  maxPlies?: number
  startingPieces?: readonly Piece[]
}): MatchResult {
  const parts = makeProblemParts(options.seed)
  let pieces: readonly Piece[] = options.startingPieces ?? createInitialPieces()
  let turn: Side = 'white'
  let ply = 1
  let quietPlies = 0
  let captures = 0
  const maxPlies = options.maxPlies ?? 220

  for (; ply <= maxPlies; ply += 1) {
    const chooser = turn === 'white' ? options.white : options.black
    const move = chooser(pieces, turn, `${options.seed}/${ply}`, ply, quietPlies)

    if (!move) {
      const opponent: Side = turn === 'white' ? 'black' : 'white'
      if (!hasLegalMove(pieces, opponent)) {
        return finish(pieces, { winner: null, reason: 'no-moves', completedTurn: ply }, ply, captures)
      }
      quietPlies += 1
      turn = opponent
      continue
    }

    const result = applyMove(pieces, move.pieceId, move.to, parts, ply)
    pieces = result.pieces
    quietPlies = result.capture ? 0 : quietPlies + 1
    if (result.capture) captures += 1

    const outcome = getGameOutcome(pieces, { quietPlies, ply })
    if (outcome) return finish(pieces, outcome, ply, captures)

    turn = turn === 'white' ? 'black' : 'white'
  }

  return finish(pieces, { winner: null, reason: 'move-limit', completedTurn: ply }, ply, captures)
}

function finish(
  pieces: readonly Piece[],
  outcome: GameOutcome,
  plies: number,
  captures: number,
): MatchResult {
  return {
    outcome,
    plies,
    captures,
    material: { white: materialOf(pieces, 'white'), black: materialOf(pieces, 'black') },
  }
}
