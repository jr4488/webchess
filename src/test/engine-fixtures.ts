import type { Piece, Side } from '../types'
import { createInitialPieces } from '../lib/game'

export interface PerftFixture {
  name: string
  pieces: readonly Piece[]
  sideToMove: Side
  expected: Readonly<Record<number, number>>
}

export function pieceAt(
  id: string,
  side: Side,
  kind: Piece['kind'],
  ring: number,
  sector: number,
  moved = true,
): Piece {
  return { id, side, kind, position: { ring, sector }, moved }
}

/**
 * A trapped White king and five blocked White pawns. Adding one mobile White
 * piece to this shell makes that piece's move count the position's move count.
 * The Black king is deliberately far from every shell square.
 */
function withOnlyWhitePieceMobile(piece: Piece): Piece[] {
  return [
    piece,
    pieceAt('white-king', 'white', 'king', 0, 0),
    pieceAt('white-pawn-0-7', 'white', 'pawn', 0, 7),
    pieceAt('white-pawn-0-1', 'white', 'pawn', 0, 1),
    pieceAt('white-pawn-1-7', 'white', 'pawn', 1, 7),
    pieceAt('white-pawn-1-0', 'white', 'pawn', 1, 0),
    pieceAt('white-pawn-1-1', 'white', 'pawn', 1, 1),
    pieceAt('black-king', 'black', 'king', 7, 4),
  ]
}

export const PERFT_FIXTURES: readonly PerftFixture[] = [
  {
    name: 'initial position',
    pieces: createInitialPieces(),
    sideToMove: 'white',
    expected: { 1: 20, 2: 400 },
  },
  {
    // The two diagonal directions meet four sectors away. That square must be
    // emitted once, while sectors 7, 6, and 5 remain reachable across the seam.
    name: 'bishop crossing the sector seam',
    pieces: withOnlyWhitePieceMobile(pieceAt('white-bishop', 'white', 'bishop', 4, 0)),
    sideToMove: 'white',
    expected: { 1: 13, 2: 65 },
  },
  {
    // The pawn shell blocks the inward file after two steps. The seven squares
    // around ring four are still one continuous cylindrical ray.
    name: 'rook circling the sector seam',
    pieces: withOnlyWhitePieceMobile(pieceAt('white-rook', 'white', 'rook', 4, 0)),
    sideToMove: 'white',
    expected: { 1: 12, 2: 60 },
  },
]

/** White has no move, but Black has eight king steps, so White must pass. */
export function forcedPassPieces(): Piece[] {
  return [
    pieceAt('white-king', 'white', 'king', 0, 0),
    pieceAt('white-pawn-0-7', 'white', 'pawn', 0, 7),
    pieceAt('white-pawn-0-1', 'white', 'pawn', 0, 1),
    pieceAt('white-pawn-1-7', 'white', 'pawn', 1, 7),
    pieceAt('white-pawn-1-0', 'white', 'pawn', 1, 0),
    pieceAt('white-pawn-1-1', 'white', 'pawn', 1, 1),
    pieceAt('black-king', 'black', 'king', 4, 4),
  ]
}

/** Five moves per side and no contact within two plies. */
export function moveLimitPieces(): Piece[] {
  return [
    pieceAt('white-king', 'white', 'king', 7, 0),
    pieceAt('black-king', 'black', 'king', 0, 4),
  ]
}
