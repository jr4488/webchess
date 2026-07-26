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

function occupancyFor(pieces: readonly Piece[]): Map<string, Piece> {
  return new Map(pieces.map((piece) => [coordKey(piece.position), piece]))
}

function addStep(
  results: Map<string, CellCoord>,
  occupancy: ReadonlyMap<string, Piece>,
  movingPiece: Piece,
  ring: number,
  sector: number,
): void {
  const coord = { ring, sector: normalizeSector(sector) }

  if (!isValidCoord(coord)) {
    return
  }

  const occupant = occupancy.get(coordKey(coord))
  if (!occupant || occupant.side !== movingPiece.side) {
    results.set(coordKey(coord), coord)
  }
}

function traceRay(
  results: Map<string, CellCoord>,
  occupancy: ReadonlyMap<string, Piece>,
  movingPiece: Piece,
  ringStep: number,
  sectorStep: number,
  maximumSteps: number,
): void {
  for (let distance = 1; distance <= maximumSteps; distance += 1) {
    const coord = {
      ring: movingPiece.position.ring + ringStep * distance,
      sector: normalizeSector(movingPiece.position.sector + sectorStep * distance),
    }

    if (!isValidCoord(coord) || isSameCoord(coord, movingPiece.position)) {
      break
    }

    const occupant = occupancy.get(coordKey(coord))
    if (!occupant) {
      results.set(coordKey(coord), coord)
      continue
    }

    if (occupant.side !== movingPiece.side) {
      results.set(coordKey(coord), coord)
    }
    break
  }
}

function addRookMoves(
  results: Map<string, CellCoord>,
  occupancy: ReadonlyMap<string, Piece>,
  piece: Piece,
): void {
  traceRay(results, occupancy, piece, 1, 0, BOARD_RINGS - 1)
  traceRay(results, occupancy, piece, -1, 0, BOARD_RINGS - 1)
  traceRay(results, occupancy, piece, 0, 1, BOARD_SECTORS - 1)
  traceRay(results, occupancy, piece, 0, -1, BOARD_SECTORS - 1)
}

function addBishopMoves(
  results: Map<string, CellCoord>,
  occupancy: ReadonlyMap<string, Piece>,
  piece: Piece,
): void {
  traceRay(results, occupancy, piece, 1, 1, BOARD_RINGS - 1)
  traceRay(results, occupancy, piece, 1, -1, BOARD_RINGS - 1)
  traceRay(results, occupancy, piece, -1, 1, BOARD_RINGS - 1)
  traceRay(results, occupancy, piece, -1, -1, BOARD_RINGS - 1)
}

function addPawnMoves(
  results: Map<string, CellCoord>,
  occupancy: ReadonlyMap<string, Piece>,
  piece: Piece,
): void {
  const direction = piece.side === 'black' ? 1 : -1
  const startRing = piece.side === 'black' ? 1 : 6
  const forward = {
    ring: piece.position.ring + direction,
    sector: normalizeSector(piece.position.sector),
  }

  if (isValidCoord(forward) && !occupancy.has(coordKey(forward))) {
    results.set(coordKey(forward), forward)

    const doubleForward = {
      ring: piece.position.ring + direction * 2,
      sector: normalizeSector(piece.position.sector),
    }
    if (
      !piece.moved &&
      piece.position.ring === startRing &&
      isValidCoord(doubleForward) &&
      !occupancy.has(coordKey(doubleForward))
    ) {
      results.set(coordKey(doubleForward), doubleForward)
    }
  }

  for (const sectorStep of [-1, 1]) {
    const captureCoord = {
      ring: piece.position.ring + direction,
      sector: normalizeSector(piece.position.sector + sectorStep),
    }
    if (!isValidCoord(captureCoord)) {
      continue
    }
    const occupant = occupancy.get(coordKey(captureCoord))
    if (occupant && occupant.side !== piece.side) {
      results.set(coordKey(captureCoord), captureCoord)
    }
  }
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

  const occupancy = occupancyFor(pieces)
  const results = new Map<string, CellCoord>()

  switch (piece.kind) {
    case 'rook':
      addRookMoves(results, occupancy, piece)
      break
    case 'bishop':
      addBishopMoves(results, occupancy, piece)
      break
    case 'queen':
      addRookMoves(results, occupancy, piece)
      addBishopMoves(results, occupancy, piece)
      break
    case 'king':
      for (let ringStep = -1; ringStep <= 1; ringStep += 1) {
        for (let sectorStep = -1; sectorStep <= 1; sectorStep += 1) {
          if (ringStep !== 0 || sectorStep !== 0) {
            addStep(
              results,
              occupancy,
              piece,
              piece.position.ring + ringStep,
              piece.position.sector + sectorStep,
            )
          }
        }
      }
      break
    case 'knight': {
      const offsets: ReadonlyArray<readonly [number, number]> = [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ]
      for (const [ringStep, sectorStep] of offsets) {
        addStep(
          results,
          occupancy,
          piece,
          piece.position.ring + ringStep,
          piece.position.sector + sectorStep,
        )
      }
      break
    }
    case 'pawn':
      addPawnMoves(results, occupancy, piece)
      break
  }

  return [...results.values()]
}

/** Whether a side has any legal move available on the current board. */
export function hasLegalMove(pieces: readonly Piece[], side: Side): boolean {
  return pieces.some(
    (piece) => piece.side === side && getLegalMoves(piece, pieces).length > 0,
  )
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
 * Selects a move with the search engine. Ties are broken from the seed so the
 * same problem always replays the same game, while equally strong moves still
 * vary between different problems.
 */
export function chooseAutoMove(
  pieces: readonly Piece[],
  side: Side,
  seed: string | number = 0,
  options: EngineOptions = {},
): AutoMove | null {
  return findBestMove(pieces, side, seed, options)
}
