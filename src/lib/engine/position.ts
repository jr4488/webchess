import type { Piece, PieceKind, Side } from '../../types'

export const RINGS = 8
export const SECTORS = 8
export const SQUARE_COUNT = RINGS * SECTORS

export const WHITE = 0
export const BLACK = 1

export const PAWN = 0
export const KNIGHT = 1
export const BISHOP = 2
export const ROOK = 3
export const QUEEN = 4
export const KING = 5

export const EMPTY = 0

/** Piece codes are 1-based so that 0 can mean "empty" in the packed board. */
export function encodePiece(side: number, kind: number): number {
  return 1 + side * 6 + kind
}

export function codeSide(code: number): number {
  return (code - 1) >= 6 ? BLACK : WHITE
}

export function codeKind(code: number): number {
  return (code - 1) % 6
}

const KIND_ORDER: readonly PieceKind[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']

const KIND_INDEX: Readonly<Record<PieceKind, number>> = {
  pawn: PAWN,
  knight: KNIGHT,
  bishop: BISHOP,
  rook: ROOK,
  queen: QUEEN,
  king: KING,
}

export function kindOf(code: number): PieceKind {
  return KIND_ORDER[codeKind(code)]!
}

export function sideOf(code: number): Side {
  return codeSide(code) === WHITE ? 'white' : 'black'
}

export function squareOf(ring: number, sector: number): number {
  return ring * SECTORS + sector
}

export function ringOf(square: number): number {
  return (square / SECTORS) | 0
}

export function sectorOf(square: number): number {
  return square % SECTORS
}

/**
 * Moves pack into one integer so the search can hold them in a preallocated
 * Int32Array instead of allocating an object per candidate.
 *
 *   bits 0-5    origin square
 *   bits 6-11   destination square
 *   bits 12-15  captured piece code (0 when the move is quiet)
 *   bit  16     promotion flag
 */
export function encodeMove(from: number, to: number, captured: number, promotion: boolean): number {
  return from | (to << 6) | (captured << 12) | (promotion ? 1 << 16 : 0)
}

export function moveFrom(move: number): number {
  return move & 0x3f
}

export function moveTo(move: number): number {
  return (move >> 6) & 0x3f
}

export function moveCaptured(move: number): number {
  return (move >> 12) & 0xf
}

export function moveIsPromotion(move: number): boolean {
  return (move & (1 << 16)) !== 0
}

interface UndoRecord {
  move: number
  movedFlagWasSet: boolean
  capturedMovedFlagWasSet: boolean
}

/**
 * A mutable board built for search. Piece identity is deliberately absent:
 * the caller maps the chosen origin square back to a `Piece` id at the root.
 */
export class Position {
  readonly board: Int8Array
  readonly moved: Uint8Array
  sideToMove: number

  private readonly undoStack: UndoRecord[] = []

  constructor() {
    this.board = new Int8Array(SQUARE_COUNT)
    this.moved = new Uint8Array(SQUARE_COUNT)
    this.sideToMove = WHITE
  }

  make(move: number): void {
    const from = moveFrom(move)
    const to = moveTo(move)
    const code = this.board[from]!

    this.undoStack.push({
      move,
      movedFlagWasSet: this.moved[from] === 1,
      capturedMovedFlagWasSet: this.moved[to] === 1,
    })

    this.board[from] = EMPTY
    this.moved[from] = 0
    this.board[to] = moveIsPromotion(move) ? encodePiece(codeSide(code), QUEEN) : code
    this.moved[to] = 1
    this.sideToMove = this.sideToMove === WHITE ? BLACK : WHITE
  }

  unmake(): void {
    const record = this.undoStack.pop()
    if (!record) throw new Error('Nothing to unmake.')

    const { move } = record
    const from = moveFrom(move)
    const to = moveTo(move)
    const code = this.board[to]!
    const captured = moveCaptured(move)

    this.board[from] = moveIsPromotion(move) ? encodePiece(codeSide(code), PAWN) : code
    this.moved[from] = record.movedFlagWasSet ? 1 : 0
    this.board[to] = captured
    this.moved[to] = record.capturedMovedFlagWasSet ? 1 : 0
    this.sideToMove = this.sideToMove === WHITE ? BLACK : WHITE
  }

  /** A pass keeps the board untouched; only the mover changes. */
  makePass(): void {
    this.sideToMove = this.sideToMove === WHITE ? BLACK : WHITE
  }

  unmakePass(): void {
    this.sideToMove = this.sideToMove === WHITE ? BLACK : WHITE
  }
}

/**
 * Builds a search position from the game's piece list. Pieces sharing a square
 * cannot occur in real play; the last one written wins, matching how
 * `occupancyFor` collapses duplicates in the game module.
 */
export function positionFromPieces(pieces: readonly Piece[], sideToMove: Side): Position {
  const position = new Position()
  position.sideToMove = sideToMove === 'white' ? WHITE : BLACK

  for (const piece of pieces) {
    const ring = piece.position.ring
    const sector = ((piece.position.sector % SECTORS) + SECTORS) % SECTORS
    if (!Number.isInteger(ring) || ring < 0 || ring >= RINGS) continue
    if (!Number.isInteger(piece.position.sector)) continue

    const square = squareOf(ring, sector)
    position.board[square] = encodePiece(
      piece.side === 'white' ? WHITE : BLACK,
      KIND_INDEX[piece.kind],
    )
    position.moved[square] = piece.moved ? 1 : 0
  }

  return position
}
