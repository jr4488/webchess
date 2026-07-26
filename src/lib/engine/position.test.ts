import { describe, expect, it } from 'vitest'

import type { Piece } from '../../types'
import { MAX_MOVES, generateMoves } from './movegen'
import {
  BLACK,
  EMPTY,
  PAWN,
  Position,
  ROOK,
  WHITE,
  encodeMove,
  encodePiece,
  positionFromPieces,
  squareOf,
} from './position'

function snapshot(position: Position) {
  return {
    board: [...position.board],
    moved: [...position.moved],
    sideToMove: position.sideToMove,
  }
}

describe('search position undo', () => {
  it("restores a captured piece's original moved flag", () => {
    const from = squareOf(4, 0)
    const to = squareOf(4, 2)
    const position = new Position()
    position.board[from] = encodePiece(WHITE, ROOK)
    position.moved[from] = 1
    position.board[to] = encodePiece(BLACK, PAWN)
    position.moved[to] = 0
    const before = snapshot(position)

    position.make(encodeMove(from, to, position.board[to]!, false))
    position.unmake()

    expect(snapshot(position)).toEqual(before)
    expect(position.moved[to]).toBe(0)
  })

  it('round-trips the complete position across every root move and a reply', () => {
    const pieces: Piece[] = [
      { id: 'wk', side: 'white', kind: 'king', position: { ring: 7, sector: 7 }, moved: false },
      { id: 'wr', side: 'white', kind: 'rook', position: { ring: 4, sector: 0 }, moved: true },
      { id: 'wp', side: 'white', kind: 'pawn', position: { ring: 6, sector: 3 }, moved: false },
      { id: 'bk', side: 'black', kind: 'king', position: { ring: 0, sector: 7 }, moved: true },
      { id: 'bp', side: 'black', kind: 'pawn', position: { ring: 4, sector: 2 }, moved: false },
      { id: 'bn', side: 'black', kind: 'knight', position: { ring: 2, sector: 4 }, moved: true },
    ]
    const position = positionFromPieces(pieces, 'white')
    const root = snapshot(position)
    const rootMoves = new Int32Array(MAX_MOVES)
    const rootCount = generateMoves(position, WHITE, rootMoves)

    for (let rootIndex = 0; rootIndex < rootCount; rootIndex += 1) {
      position.make(rootMoves[rootIndex]!)
      const afterRoot = snapshot(position)
      const replies = new Int32Array(MAX_MOVES)
      const replyCount = generateMoves(position, BLACK, replies)

      for (let replyIndex = 0; replyIndex < replyCount; replyIndex += 1) {
        position.make(replies[replyIndex]!)
        position.unmake()
        expect(snapshot(position)).toEqual(afterRoot)
      }

      position.unmake()
      expect(snapshot(position)).toEqual(root)
    }
  })

  it('clears an empty destination again after undo', () => {
    const from = squareOf(6, 0)
    const to = squareOf(5, 0)
    const position = new Position()
    position.board[from] = encodePiece(WHITE, PAWN)

    position.make(encodeMove(from, to, EMPTY, false))
    position.unmake()

    expect(position.board[to]).toBe(EMPTY)
    expect(position.moved[to]).toBe(0)
  })
})
