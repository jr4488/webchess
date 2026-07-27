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
  movingCode: number
  capturedCode: number
  fromMovedFlagWasSet: boolean
  toMovedFlagWasSet: boolean
}

const PIECE_CODE_COUNT = 1 + 2 * 6

/*
 * These keys are generated once from a fixed seed. Keeping two independent
 * 32-bit words avoids JavaScript's lossy integer range while giving the search
 * a stable 64-bit position identity.
 */
let zobristState = 0x6d2b79f5

function nextZobristWord(): number {
  zobristState = (zobristState + 0x9e3779b9) >>> 0
  let value = zobristState
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad)
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97)
  return (value ^ (value >>> 15)) >>> 0
}

const PIECE_HASH_LOW = new Uint32Array(PIECE_CODE_COUNT * SQUARE_COUNT)
const PIECE_HASH_HIGH = new Uint32Array(PIECE_CODE_COUNT * SQUARE_COUNT)
const MOVED_HASH_LOW = new Uint32Array(SQUARE_COUNT)
const MOVED_HASH_HIGH = new Uint32Array(SQUARE_COUNT)

for (let index = 0; index < PIECE_HASH_LOW.length; index += 1) {
  PIECE_HASH_LOW[index] = nextZobristWord()
  PIECE_HASH_HIGH[index] = nextZobristWord()
}

for (let square = 0; square < SQUARE_COUNT; square += 1) {
  MOVED_HASH_LOW[square] = nextZobristWord()
  MOVED_HASH_HIGH[square] = nextZobristWord()
}

const SIDE_HASH_LOW = nextZobristWord()
const SIDE_HASH_HIGH = nextZobristWord()

/**
 * A mutable board built for search. Piece identity is deliberately absent:
 * the caller maps the chosen origin square back to a `Piece` id at the root.
 */
export class Position {
  readonly board: Int8Array
  readonly moved: Uint8Array

  private _sideToMove = WHITE
  private _hashLow = 0
  private _hashHigh = 0

  private readonly undoStack: UndoRecord[] = []

  constructor() {
    this.board = new Int8Array(SQUARE_COUNT)
    this.moved = new Uint8Array(SQUARE_COUNT)
  }

  get sideToMove(): number {
    return this._sideToMove
  }

  set sideToMove(side: number) {
    if (side !== WHITE && side !== BLACK) {
      throw new RangeError(`Invalid side to move: ${side}.`)
    }
    if (side === this._sideToMove) return

    this._hashLow = (this._hashLow ^ SIDE_HASH_LOW) >>> 0
    this._hashHigh = (this._hashHigh ^ SIDE_HASH_HIGH) >>> 0
    this._sideToMove = side
  }

  /** Low and high words of the deterministic incremental position hash. */
  get hashLow(): number {
    return this._hashLow
  }

  get hashHigh(): number {
    return this._hashHigh
  }

  /**
   * Rebuilds the hash after setup code writes directly into `board` or
   * `moved`. Search moves update it incrementally and do not call this method.
   */
  recomputeHash(): void {
    let low = 0
    let high = 0

    for (let square = 0; square < SQUARE_COUNT; square += 1) {
      const code = this.board[square]!
      if (code !== EMPTY) {
        const index = code * SQUARE_COUNT + square
        low ^= PIECE_HASH_LOW[index]!
        high ^= PIECE_HASH_HIGH[index]!
      }
      if (this.moved[square] === 1) {
        low ^= MOVED_HASH_LOW[square]!
        high ^= MOVED_HASH_HIGH[square]!
      }
    }

    if (this._sideToMove === BLACK) {
      low ^= SIDE_HASH_LOW
      high ^= SIDE_HASH_HIGH
    }

    this._hashLow = low >>> 0
    this._hashHigh = high >>> 0
  }

  make(move: number): void {
    const from = moveFrom(move)
    const to = moveTo(move)
    const code = this.board[from]!
    const captured = this.board[to]!
    const fromMovedFlagWasSet = this.moved[from] === 1
    const toMovedFlagWasSet = this.moved[to] === 1

    this.undoStack.push({
      move,
      movingCode: code,
      capturedCode: captured,
      fromMovedFlagWasSet,
      toMovedFlagWasSet,
    })

    this.xorPiece(from, code)
    if (fromMovedFlagWasSet) this.xorMoved(from)
    this.xorPiece(to, captured)
    if (toMovedFlagWasSet) this.xorMoved(to)

    this.board[from] = EMPTY
    this.moved[from] = 0
    const placedCode = moveIsPromotion(move) ? encodePiece(codeSide(code), QUEEN) : code
    this.board[to] = placedCode
    this.moved[to] = 1
    this.xorPiece(to, placedCode)
    this.xorMoved(to)
    this.sideToMove = this.sideToMove === WHITE ? BLACK : WHITE
  }

  unmake(): void {
    const record = this.undoStack.pop()
    if (!record) throw new Error('Nothing to unmake.')

    const { move, movingCode, capturedCode, fromMovedFlagWasSet, toMovedFlagWasSet } = record
    const from = moveFrom(move)
    const to = moveTo(move)

    this.xorPiece(to, this.board[to]!)
    if (this.moved[to] === 1) this.xorMoved(to)

    this.board[from] = movingCode
    this.moved[from] = fromMovedFlagWasSet ? 1 : 0
    this.board[to] = capturedCode
    this.moved[to] = toMovedFlagWasSet ? 1 : 0

    this.xorPiece(from, movingCode)
    if (fromMovedFlagWasSet) this.xorMoved(from)
    this.xorPiece(to, capturedCode)
    if (toMovedFlagWasSet) this.xorMoved(to)
    this.sideToMove = this.sideToMove === WHITE ? BLACK : WHITE
  }

  /** A pass keeps the board untouched; only the mover changes. */
  makePass(): void {
    this.sideToMove = this.sideToMove === WHITE ? BLACK : WHITE
  }

  unmakePass(): void {
    this.sideToMove = this.sideToMove === WHITE ? BLACK : WHITE
  }

  private xorPiece(square: number, code: number): void {
    if (code === EMPTY) return
    const index = code * SQUARE_COUNT + square
    this._hashLow = (this._hashLow ^ PIECE_HASH_LOW[index]!) >>> 0
    this._hashHigh = (this._hashHigh ^ PIECE_HASH_HIGH[index]!) >>> 0
  }

  private xorMoved(square: number): void {
    this._hashLow = (this._hashLow ^ MOVED_HASH_LOW[square]!) >>> 0
    this._hashHigh = (this._hashHigh ^ MOVED_HASH_HIGH[square]!) >>> 0
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

  position.recomputeHash()
  return position
}
