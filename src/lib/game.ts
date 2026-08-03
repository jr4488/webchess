import type {
  AutoMove,
  CaptureRecord,
  CellCoord,
  GameOutcome,
  MoveResult,
  Piece,
  PieceKind,
  ProblemPart,
  Side,
} from '../types'
import { MAX_GAME_PLIES, MAX_QUIET_PLIES } from '../constants'
import { BOARD_RING_COUNT, BOARD_SECTOR_COUNT, problemPartAt } from './problem'
import { captureNarration } from './reading'
import { findBestMove } from './engine'
import type { EngineOptions } from './engine'
import { MAX_MOVES, generateMoves } from './engine/movegen'
import {
  BLACK,
  WHITE,
  moveFrom,
  moveTo,
  positionFromPieces,
  ringOf,
  sectorOf,
  squareOf,
} from './engine/position'

export { PIECE_METAPHORS } from './reading'

export const BOARD_RINGS = BOARD_RING_COUNT
export const BOARD_SECTORS = BOARD_SECTOR_COUNT

export const PIECE_VALUES: Readonly<Record<PieceKind, number>> = {
  king: 10,
  queen: 9,
  rook: 5,
  bishop: 3,
  knight: 3,
  pawn: 1,
}

const BACK_RANK: readonly PieceKind[] = [
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
  'bishop',
  'knight',
  'rook',
]

export type { AutoMove }

export interface GameProgress {
  quietPlies: number
  ply: number
}

export function normalizeSector(sector: number): number {
  return ((sector % BOARD_SECTORS) + BOARD_SECTORS) % BOARD_SECTORS
}

export function isValidCoord(coord: CellCoord): boolean {
  return (
    Number.isInteger(coord.ring) &&
    Number.isInteger(coord.sector) &&
    coord.ring >= 0 &&
    coord.ring < BOARD_RINGS &&
    coord.sector >= 0 &&
    coord.sector < BOARD_SECTORS
  )
}

export function coordKey(coord: CellCoord): string {
  return `${coord.ring}:${normalizeSector(coord.sector)}`
}

export function isSameCoord(left: CellCoord, right: CellCoord): boolean {
  return left.ring === right.ring && normalizeSector(left.sector) === normalizeSector(right.sector)
}

export function getPieceAt(pieces: readonly Piece[], coord: CellCoord): Piece | undefined {
  const key = coordKey(coord)
  return pieces.find((piece) => coordKey(piece.position) === key)
}

function createSide(side: Side, backRing: number, pawnRing: number): Piece[] {
  const kindCounts = new Map<PieceKind, number>()
  const backPieces = BACK_RANK.map((kind, sector) => {
    const count = (kindCounts.get(kind) ?? 0) + 1
    kindCounts.set(kind, count)

    return {
      id: `${side}-${kind}-${count}`,
      side,
      kind,
      position: { ring: backRing, sector },
      moved: false,
    } satisfies Piece
  })

  const pawns = Array.from({ length: BOARD_SECTORS }, (_, sector) => ({
    id: `${side}-pawn-${sector + 1}`,
    side,
    kind: 'pawn' as const,
    position: { ring: pawnRing, sector },
    moved: false,
  }))

  return [...backPieces, ...pawns]
}

/** Black begins at the center and advances out; White begins outside and advances in. */
export function createInitialPieces(): Piece[] {
  return [...createSide('black', 0, 1), ...createSide('white', 7, 6)]
}

function engineSide(side: Side): number {
  return side === 'white' ? WHITE : BLACK
}

/**
 * Returns pseudo-legal chess moves on the polar grid. Sectors wrap at 0/7;
 * rings stop at the inner and outer edges. Check, castling, and en passant are
 * intentionally absent because captures are reflective prompts, not checkmate.
 */
export function getLegalMoves(piece: Piece, pieces: readonly Piece[]): CellCoord[] {
  if (!isValidCoord(piece.position)) {
    return []
  }

  // Put the requested piece on the packed board last. This preserves the
  // public helper's long-standing ability to inspect a piece supplied as a
  // structural copy (or before it has been inserted into the caller's list).
  const position = positionFromPieces([...pieces, piece], piece.side)
  const moves = new Int32Array(MAX_MOVES)
  const count = generateMoves(position, engineSide(piece.side), moves, 'all')
  const origin = squareOf(piece.position.ring, piece.position.sector)
  const results: CellCoord[] = []

  for (let index = 0; index < count; index += 1) {
    const move = moves[index]!
    if (moveFrom(move) !== origin) continue

    const destination = moveTo(move)
    results.push({
      ring: ringOf(destination),
      sector: sectorOf(destination),
    })
  }

  return results
}

/** Whether a side has any legal move available on the current board. */
export function hasLegalMove(pieces: readonly Piece[], side: Side): boolean {
  const position = positionFromPieces(pieces, side)
  const moves = new Int32Array(MAX_MOVES)
  return generateMoves(position, engineSide(side), moves, 'all') > 0
}

/**
 * Resolves the complete-game boundary. A captured King is decisive in this
 * reflective variant; standstill and progress limits ensure every game ends.
 *
 * A side with no legal move does not end the game on its own: the turn passes
 * to the other side. Only a board where neither side can move is an ending.
 */
export function getGameOutcome(
  pieces: readonly Piece[],
  progress: GameProgress,
): GameOutcome | null {
  const whiteKing = pieces.some((piece) => piece.side === 'white' && piece.kind === 'king')
  const blackKing = pieces.some((piece) => piece.side === 'black' && piece.kind === 'king')

  if (!whiteKing || !blackKing) {
    return {
      winner: whiteKing === blackKing ? null : whiteKing ? 'white' : 'black',
      reason: 'king-captured',
      completedTurn: progress.ply,
    }
  }

  if (!hasLegalMove(pieces, 'white') && !hasLegalMove(pieces, 'black')) {
    return {
      winner: null,
      reason: 'no-moves',
      completedTurn: progress.ply,
    }
  }

  if (progress.quietPlies >= MAX_QUIET_PLIES) {
    return {
      winner: null,
      reason: 'no-progress',
      completedTurn: progress.ply,
    }
  }

  if (progress.ply >= MAX_GAME_PLIES) {
    return {
      winner: null,
      reason: 'move-limit',
      completedTurn: progress.ply,
    }
  }

  return null
}

/** Applies one validated move without mutating the supplied position. */
export function applyMove(
  pieces: readonly Piece[],
  pieceId: string,
  destination: CellCoord,
  parts: readonly ProblemPart[],
  turn = 1,
): MoveResult {
  const movingPiece = pieces.find((piece) => piece.id === pieceId)
  if (!movingPiece) {
    throw new Error(`Unknown piece: ${pieceId}`)
  }

  const normalizedDestination = {
    ring: destination.ring,
    sector: normalizeSector(destination.sector),
  }
  if (!isValidCoord(normalizedDestination)) {
    throw new Error(`Invalid destination (${destination.ring}, ${destination.sector}).`)
  }

  const legal = getLegalMoves(movingPiece, pieces).some((coord) =>
    isSameCoord(coord, normalizedDestination),
  )
  if (!legal) {
    throw new Error(
      `Illegal move for ${pieceId}: ${coordKey(movingPiece.position)} → ${coordKey(normalizedDestination)}.`,
    )
  }

  const capturedPiece = getPieceAt(pieces, normalizedDestination)
  const movedPiece: Piece = {
    ...movingPiece,
    position: normalizedDestination,
    moved: true,
  }
  const reachesFarEdge =
    movedPiece.kind === 'pawn' &&
    ((movedPiece.side === 'black' && movedPiece.position.ring === BOARD_RINGS - 1) ||
      (movedPiece.side === 'white' && movedPiece.position.ring === 0))
  const resultingPiece: Piece = reachesFarEdge ? { ...movedPiece, kind: 'queen' } : movedPiece

  const nextPieces = pieces
    .filter((piece) => piece.id !== capturedPiece?.id)
    .map((piece) => (piece.id === pieceId ? resultingPiece : piece))

  let capture: CaptureRecord | undefined
  if (capturedPiece) {
    const part = problemPartAt(parts, normalizedDestination)
    capture = {
      id: `capture-${turn}-${movingPiece.id}-${capturedPiece.id}`,
      turn,
      attacker: movedPiece,
      captured: capturedPiece,
      cell: normalizedDestination,
      part,
      resonance: captureAttentionWeight(movingPiece, capturedPiece, normalizedDestination),
      narration: captureNarration(movingPiece, capturedPiece, part),
    }
  }

  return {
    pieces: nextPieces,
    ...(capture ? { capture } : {}),
    ...(reachesFarEdge ? { promoted: resultingPiece } : {}),
  }
}

/**
 * An explainable attention weight: important captured roles matter more, active
 * pieces add force, and conflicts near the middle rings represent the strongest
 * meeting of outside-in evidence with inside-out intent.
 */
export function captureAttentionWeight(
  attacker: Piece,
  captured: Piece,
  cell: CellCoord,
): number {
  const challengedRole = PIECE_VALUES[captured.kind] * 2.5
  const activeForce = PIECE_VALUES[attacker.kind]
  const meetingPoint = Math.max(0, 3.5 - Math.abs(3.5 - cell.ring)) * 2
  return Math.round(52 + challengedRole + activeForce + meetingPoint)
}

/**
 * Selects a move with the search engine. Ties are broken from the seed so one
 * saved game replays deterministically, while equally strong moves can vary
 * across bounded trajectories that use different durable seeds.
 */
export function chooseAutoMove(
  pieces: readonly Piece[],
  side: Side,
  seed: string | number = 0,
  options: EngineOptions = {},
): AutoMove | null {
  return findBestMove(pieces, side, seed, options)
}
