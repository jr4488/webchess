import { describe, expect, it } from 'vitest'

import type { Piece, PieceKind, Side } from '../../types'
import { coordKey, createInitialPieces, getLegalMoves } from '../game'
import { hashString } from '../problem'
import { MAX_MOVES, generateMoves, isAttacked } from './movegen'
import {
  RINGS,
  SECTORS,
  SQUARE_COUNT,
  moveFrom,
  moveTo,
  positionFromPieces,
  ringOf,
  sectorOf,
  squareOf,
} from './position'

const KINDS: readonly PieceKind[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']

/**
 * A deterministic generator keeps a failing case reproducible from its index
 * alone, which matters because these positions are otherwise arbitrary.
 */
function randomPosition(index: number): Piece[] {
  const pieces: Piece[] = []
  const used = new Set<number>()
  const pieceCount = 4 + (hashString(`count/${index}`) % 20)

  for (let slot = 0; slot < pieceCount; slot += 1) {
    const square = hashString(`square/${index}/${slot}`) % SQUARE_COUNT
    if (used.has(square)) continue
    used.add(square)

    const kind = KINDS[hashString(`kind/${index}/${slot}`) % KINDS.length]!
    const side: Side = hashString(`side/${index}/${slot}`) % 2 === 0 ? 'white' : 'black'
    pieces.push({
      id: `p${slot}`,
      side,
      kind,
      position: { ring: ringOf(square), sector: sectorOf(square) },
      moved: hashString(`moved/${index}/${slot}`) % 2 === 0,
    })
  }

  return pieces
}

function referenceMoveKeys(pieces: readonly Piece[], side: Side): string[] {
  return pieces
    .filter((piece) => piece.side === side)
    .flatMap((piece) =>
      getLegalMoves(piece, pieces).map(
        (destination) => `${coordKey(piece.position)}>${coordKey(destination)}`,
      ),
    )
    .sort()
}

function engineMoveKeys(pieces: readonly Piece[], side: Side): string[] {
  const position = positionFromPieces(pieces, side)
  const buffer = new Int32Array(MAX_MOVES)
  const count = generateMoves(position, side === 'white' ? 0 : 1, buffer)

  const keys: string[] = []
  for (let index = 0; index < count; index += 1) {
    const move = buffer[index]!
    const from = moveFrom(move)
    const to = moveTo(move)
    keys.push(`${ringOf(from)}:${sectorOf(from)}>${ringOf(to)}:${sectorOf(to)}`)
  }
  return keys.sort()
}

describe('engine move generation', () => {
  it('matches the game rules on the opening position for both sides', () => {
    const pieces = createInitialPieces()

    for (const side of ['white', 'black'] as const) {
      expect(engineMoveKeys(pieces, side)).toEqual(referenceMoveKeys(pieces, side))
    }
  })

  it('matches the game rules across 400 randomly generated positions', () => {
    for (let index = 0; index < 400; index += 1) {
      const pieces = randomPosition(index)

      for (const side of ['white', 'black'] as const) {
        const reference = referenceMoveKeys(pieces, side)
        const engine = engineMoveKeys(pieces, side)
        expect(engine, `position ${index} for ${side}`).toEqual(reference)
      }
    }
  })

  it('never emits the same move twice, even across the seam and the diagonals', () => {
    for (let index = 0; index < 200; index += 1) {
      const pieces = randomPosition(index)

      for (const side of ['white', 'black'] as const) {
        const engine = engineMoveKeys(pieces, side)
        expect(new Set(engine).size, `position ${index} for ${side}`).toBe(engine.length)
      }
    }
  })

  it('generates exactly the capture subset when asked for captures only', () => {
    const buffer = new Int32Array(MAX_MOVES)
    const captureBuffer = new Int32Array(MAX_MOVES)

    for (let index = 0; index < 200; index += 1) {
      const pieces = randomPosition(index)

      for (const side of ['white', 'black'] as const) {
        const position = positionFromPieces(pieces, side)
        const sideCode = side === 'white' ? 0 : 1
        const all = generateMoves(position, sideCode, buffer)
        const captureCount = generateMoves(position, sideCode, captureBuffer, true)

        const expected = new Set<number>()
        for (let slot = 0; slot < all; slot += 1) {
          const move = buffer[slot]!
          if (position.board[moveTo(move)] !== 0) expected.add(move)
        }

        const actual = new Set<number>()
        for (let slot = 0; slot < captureCount; slot += 1) actual.add(captureBuffer[slot]!)

        expect(actual, `position ${index} for ${side}`).toEqual(expected)
      }
    }
  })
})

describe('attack detection', () => {
  /**
   * "Attacked" means a piece could capture there, which the game rules only
   * express when something capturable is standing on the square. Substituting a
   * lone enemy marker onto each square recovers that from `getLegalMoves`, and
   * it is the only phrasing that covers pawn diagonals and defended squares.
   */
  function referenceAttacks(pieces: readonly Piece[], side: Side, square: number): boolean {
    const marker: Piece = {
      id: 'marker',
      side: side === 'white' ? 'black' : 'white',
      kind: 'pawn',
      position: { ring: ringOf(square), sector: sectorOf(square) },
      moved: true,
    }
    const withMarker = [
      ...pieces.filter((piece) => coordKey(piece.position) !== coordKey(marker.position)),
      marker,
    ]

    return withMarker.some(
      (piece) =>
        piece.side === side &&
        getLegalMoves(piece, withMarker).some(
          (destination) => coordKey(destination) === coordKey(marker.position),
        ),
    )
  }

  it('agrees with the game rules on every square, occupied or empty', () => {
    for (let index = 0; index < 60; index += 1) {
      const pieces = randomPosition(index)

      for (const side of ['white', 'black'] as const) {
        const sideCode = side === 'white' ? 0 : 1
        const position = positionFromPieces(pieces, side)

        for (let square = 0; square < SQUARE_COUNT; square += 1) {
          expect(
            isAttacked(position.board, square, sideCode),
            `position ${index} for ${side} square ${square}`,
          ).toBe(referenceAttacks(pieces, side, square))
        }
      }
    }
  })

  it('sees a defender of its own occupied square', () => {
    const pieces: Piece[] = [
      { id: 'wr', side: 'white', kind: 'rook', position: { ring: 4, sector: 0 }, moved: true },
      { id: 'wn', side: 'white', kind: 'knight', position: { ring: 4, sector: 3 }, moved: true },
    ]
    const position = positionFromPieces(pieces, 'white')

    expect(isAttacked(position.board, squareOf(4, 3), 0)).toBe(true)
  })
})

describe('board indexing', () => {
  it('round-trips every square through ring and sector', () => {
    for (let ring = 0; ring < RINGS; ring += 1) {
      for (let sector = 0; sector < SECTORS; sector += 1) {
        const square = squareOf(ring, sector)
        expect(ringOf(square)).toBe(ring)
        expect(sectorOf(square)).toBe(sector)
      }
    }
  })
})
