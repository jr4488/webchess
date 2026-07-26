import { describe, expect, it } from 'vitest'

import type { Piece } from '../../types'
import { VALUES, evaluateBoard, staticExchange } from './evaluate'
import { MAX_MOVES, generateMoves } from './movegen'
import {
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  moveTo,
  positionFromPieces,
  squareOf,
} from './position'

function board(pieces: Piece[]): Int8Array {
  return positionFromPieces(pieces, 'white').board
}

function at(
  id: string,
  side: Piece['side'],
  kind: Piece['kind'],
  ring: number,
  sector: number,
): Piece {
  return { id, side, kind, position: { ring, sector }, moved: true }
}

function captureOf(pieces: Piece[], side: Piece['side'], target: number): number {
  const position = positionFromPieces(pieces, side)
  const moves = new Int32Array(MAX_MOVES)
  const count = generateMoves(position, side === 'white' ? 0 : 1, moves)

  for (let index = 0; index < count; index += 1) {
    if (moveTo(moves[index]!) === target) return moves[index]!
  }
  throw new Error('No capture reaches that square.')
}

describe('static exchange evaluation', () => {
  it('wins the full piece when the square is undefended', () => {
    const pieces = [
      at('wr', 'white', 'rook', 4, 0),
      at('bn', 'black', 'knight', 4, 3),
      at('bk', 'black', 'king', 0, 0),
      at('wk', 'white', 'king', 7, 0),
    ]

    const move = captureOf(pieces, 'white', squareOf(4, 3))
    expect(staticExchange(board(pieces), move)).toBe(VALUES[KNIGHT])
  })

  it('reports the loss when a cheaper piece defends the square', () => {
    const pieces = [
      at('wr', 'white', 'rook', 4, 0),
      at('bn', 'black', 'knight', 4, 3),
      at('bp', 'black', 'pawn', 3, 2),
      at('bk', 'black', 'king', 0, 0),
      at('wk', 'white', 'king', 7, 0),
    ]

    const move = captureOf(pieces, 'white', squareOf(4, 3))
    expect(staticExchange(board(pieces), move)).toBe(VALUES[KNIGHT]! - VALUES[ROOK]!)
  })

  it('stops the sequence where a side would rather not recapture', () => {
    const pieces = [
      at('wb', 'white', 'bishop', 5, 2),
      at('wr', 'white', 'rook', 4, 0),
      at('bn', 'black', 'knight', 4, 3),
      at('br', 'black', 'rook', 4, 7),
      at('bk', 'black', 'king', 0, 0),
      at('wk', 'white', 'king', 7, 0),
    ]

    // Bishop takes knight. Black could take back with the rook, but the white
    // rook would answer, so Black declines and simply stays a knight down.
    const move = captureOf(pieces, 'white', squareOf(4, 3))
    expect(staticExchange(board(pieces), move)).toBe(VALUES[KNIGHT])
  })

  it('sees the second attacker lined up behind the first', () => {
    const pieces = [
      at('wr', 'white', 'rook', 6, 3),
      at('wq', 'white', 'queen', 7, 3),
      at('bp', 'black', 'pawn', 4, 3),
      at('bn', 'black', 'knight', 5, 1),
      at('bk', 'black', 'king', 0, 0),
      at('wk', 'white', 'king', 7, 0),
    ]

    // Rook takes pawn, knight takes rook, and the queen behind the rook takes
    // the knight. Losing a rook for a pawn and a knight is a bad trade.
    const move = captureOf(pieces, 'white', squareOf(4, 3))
    expect(staticExchange(board(pieces), move)).toBe(
      VALUES[PAWN]! - VALUES[ROOK]! + VALUES[KNIGHT]!,
    )
  })
})

describe('evaluation', () => {
  it('is symmetric: mirroring the sides flips the sign', () => {
    const white = [
      at('wk', 'white', 'king', 7, 0),
      at('wr', 'white', 'rook', 5, 2),
      at('wp', 'white', 'pawn', 4, 3),
      at('wn', 'white', 'knight', 6, 5),
      at('bk', 'black', 'king', 0, 0),
      at('br', 'black', 'rook', 2, 2),
      at('bp', 'black', 'pawn', 3, 3),
    ]
    const mirrored = white.map((piece) => ({
      ...piece,
      side: piece.side === 'white' ? ('black' as const) : ('white' as const),
      position: { ring: 7 - piece.position.ring, sector: piece.position.sector },
    }))

    expect(evaluateBoard(board(white)) + evaluateBoard(board(mirrored))).toBe(0)
    expect(Math.abs(evaluateBoard(board(white)))).toBeGreaterThan(0)
  })

  it('prefers the side holding more material', () => {
    const even = [
      at('wk', 'white', 'king', 7, 0),
      at('wq', 'white', 'queen', 5, 2),
      at('bk', 'black', 'king', 0, 0),
      at('bq', 'black', 'queen', 2, 2),
    ]
    const ahead = even.filter((piece) => piece.id !== 'bq')

    expect(evaluateBoard(board(even))).toBeCloseTo(0, -1)
    expect(evaluateBoard(board(ahead))).toBeGreaterThan(VALUES[QUEEN]!)
  })

  it('rewards driving a bare king toward a ring edge once well ahead', () => {
    const centre = [
      at('wk', 'white', 'king', 5, 0),
      at('wr', 'white', 'rook', 4, 4),
      at('bk', 'black', 'king', 3, 0),
    ]
    const cornered = [
      at('wk', 'white', 'king', 5, 0),
      at('wr', 'white', 'rook', 4, 4),
      at('bk', 'black', 'king', 0, 0),
    ]

    expect(evaluateBoard(board(cornered))).toBeGreaterThan(evaluateBoard(board(centre)))
  })

  it('leaves the hunting bonus off while material is level', () => {
    const level = [
      at('wk', 'white', 'king', 5, 0),
      at('wr', 'white', 'rook', 4, 4),
      at('bk', 'black', 'king', 3, 0),
      at('br', 'black', 'rook', 2, 4),
    ]
    const kingMovedToEdge = level.map((piece) =>
      piece.id === 'bk' ? { ...piece, position: { ring: 0, sector: 0 } } : piece,
    )

    expect(evaluateBoard(board(level))).toBe(evaluateBoard(board(kingMovedToEdge)))
  })
})
