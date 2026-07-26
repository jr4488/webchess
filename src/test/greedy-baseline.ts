import type { AutoMove, CellCoord, Piece, Side } from '../types'
import {
  BOARD_RINGS,
  BOARD_SECTORS,
  PIECE_VALUES,
  coordKey,
  getLegalMoves,
  isSameCoord,
  normalizeSector,
} from '../lib/game'
import { hashString } from '../lib/problem'

/**
 * The one-ply scorer WebChess used before the search engine, kept as a fixed
 * opponent so changes to the engine can be measured against a stable baseline
 * rather than against an assertion about what a good move looks like.
 */
export const GREEDY_BASELINE_ID = 'legacy-greedy-v1'

function occupancyFor(pieces: readonly Piece[]): Map<string, Piece> {
  return new Map(pieces.map((piece) => [coordKey(piece.position), piece]))
}

function polarDistance(left: CellCoord, right: CellCoord): number {
  const sectorDistance = Math.abs(normalizeSector(left.sector) - normalizeSector(right.sector))
  return Math.abs(left.ring - right.ring) + Math.min(sectorDistance, BOARD_SECTORS - sectorDistance)
}

function nearestEnemyDistance(
  position: CellCoord,
  side: Side,
  pieces: readonly Piece[],
): number | null {
  const distances = pieces
    .filter((piece) => piece.side !== side)
    .map((piece) => polarDistance(position, piece.position))

  return distances.length > 0 ? Math.min(...distances) : null
}

function piecesAfterCandidate(
  pieces: readonly Piece[],
  movingPiece: Piece,
  destination: CellCoord,
  captured: Piece | undefined,
): { pieces: Piece[]; movedPiece: Piece } {
  const reachesFarEdge =
    movingPiece.kind === 'pawn' &&
    ((movingPiece.side === 'black' && destination.ring === BOARD_RINGS - 1) ||
      (movingPiece.side === 'white' && destination.ring === 0))
  const movedPiece: Piece = {
    ...movingPiece,
    kind: reachesFarEdge ? 'queen' : movingPiece.kind,
    position: destination,
    moved: true,
  }

  return {
    pieces: pieces
      .filter((piece) => piece.id !== captured?.id)
      .map((piece) => (piece.id === movingPiece.id ? movedPiece : piece)),
    movedPiece,
  }
}

function attackersOf(
  target: CellCoord,
  attackingSide: Side,
  pieces: readonly Piece[],
): Piece[] {
  return pieces.filter(
    (piece) =>
      piece.side === attackingSide &&
      getLegalMoves(piece, pieces).some((move) => isSameCoord(move, target)),
  )
}

function scoreMove(
  piece: Piece,
  destination: CellCoord,
  captured: Piece | undefined,
  pieces: readonly Piece[],
): number {
  const direction = piece.side === 'black' ? 1 : -1
  const progress = (destination.ring - piece.position.ring) * direction
  const capturedKing = captured?.kind === 'king'
  const captureScore = captured
    ? capturedKing
      ? 1_000_000
      : 12_000 + PIECE_VALUES[captured.kind] * 1_000
    : 0
  const progressScore = progress * 40
  const pawnMomentum = piece.kind === 'pawn' && progress > 0 ? 12 : 0
  const promotionScore =
    piece.kind === 'pawn' &&
    ((piece.side === 'black' && destination.ring === BOARD_RINGS - 1) ||
      (piece.side === 'white' && destination.ring === 0))
      ? 600
      : 0

  const candidate = piecesAfterCandidate(pieces, piece, destination, captured)
  const opposingSide = piece.side === 'white' ? 'black' : 'white'
  const movedPieceAttackers = attackersOf(destination, opposingSide, candidate.pieces)
  const hangingPiecePenalty =
    movedPieceAttackers.length > 0
      ? 2_500 + PIECE_VALUES[candidate.movedPiece.kind] * 600
      : 0

  const ownKing = candidate.pieces.find(
    (candidatePiece) => candidatePiece.side === piece.side && candidatePiece.kind === 'king',
  )
  const ownKingThreatened =
    ownKing !== undefined && attackersOf(ownKing.position, opposingSide, candidate.pieces).length > 0
  const kingSafetyScore = ownKingThreatened && !capturedKing
    ? candidate.movedPiece.kind === 'king'
      ? -4_000
      : -12_000
    : 0

  const enemyKing = candidate.pieces.find(
    (candidatePiece) => candidatePiece.side === opposingSide && candidatePiece.kind === 'king',
  )
  const enemyKingPressure = enemyKing
    ? attackersOf(enemyKing.position, piece.side, candidate.pieces).length * 4_000
    : 0

  const distanceBefore = nearestEnemyDistance(piece.position, piece.side, pieces)
  const distanceAfter = nearestEnemyDistance(destination, piece.side, candidate.pieces)
  const completedRings =
    piece.side === 'black' ? piece.position.ring : BOARD_RINGS - 1 - piece.position.ring
  const convergenceWeight = 12 + completedRings * 8
  const convergenceScore =
    !captured && distanceBefore !== null && distanceAfter !== null
      ? (distanceBefore - distanceAfter) * convergenceWeight
      : 0

  return (
    captureScore +
    progressScore +
    pawnMomentum +
    promotionScore +
    convergenceScore +
    enemyKingPressure +
    kingSafetyScore -
    hangingPiecePenalty
  )
}

export function chooseGreedyMove(
  pieces: readonly Piece[],
  side: Side,
  seed: string | number = 0,
): AutoMove | null {
  const occupancy = occupancyFor(pieces)
  const candidates = pieces
    .filter((piece) => piece.side === side)
    .flatMap((piece) =>
      getLegalMoves(piece, pieces).map((to) => {
        const captured = occupancy.get(coordKey(to))
        const score = scoreMove(piece, to, captured, pieces)
        const tie = hashString(`${String(seed)}/${side}/${piece.id}/${coordKey(to)}`)
        return { pieceId: piece.id, from: { ...piece.position }, to, score, captured, tie }
      }),
    )

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.tie - left.tie ||
      left.pieceId.localeCompare(right.pieceId) ||
      coordKey(left.to).localeCompare(coordKey(right.to)),
  )

  const selected = candidates[0]
  if (!selected) return null

  return {
    pieceId: selected.pieceId,
    from: selected.from,
    to: selected.to,
    score: selected.score,
    ...(selected.captured ? { captured: selected.captured } : {}),
  }
}
