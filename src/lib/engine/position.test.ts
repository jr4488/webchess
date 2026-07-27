import { describe, expect, it } from 'vitest'

import type { Piece } from '../../types'
import { MAX_MOVES, generateMoves } from './movegen'
import {
  BLACK,
  EMPTY,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  encodeMove,
  encodePiece,
  moveFrom,
  moveTo,
  positionFromPieces,
  squareOf,
} from './position'

function hashOf(position: ReturnType<typeof positionFromPieces>): readonly [number, number] {
  return [position.hashLow, position.hashHigh]
}

describe('engine position state', () => {
  it('restores the complete captured-square state and hash after unmake', () => {
    const pieces: Piece[] = [
      {
        id: 'white-rook',
        side: 'white',
        kind: 'rook',
        position: { ring: 1, sector: 0 },
        moved: true,
      },
      {
        id: 'black-pawn',
        side: 'black',
        kind: 'pawn',
        position: { ring: 1, sector: 2 },
        moved: false,
      },
    ]
    const position = positionFromPieces(pieces, 'white')
    const initialBoard = Array.from(position.board)
    const initialMoved = Array.from(position.moved)
    const initialHash = hashOf(position)
    const from = squareOf(1, 0)
    const to = squareOf(1, 2)
    const move = encodeMove(from, to, encodePiece(BLACK, PAWN), false)

    position.make(move)

    const expectedAfterMove = positionFromPieces(
      [
        {
          id: 'white-rook',
          side: 'white',
          kind: 'rook',
          position: { ring: 1, sector: 2 },
          moved: true,
        },
      ],
      'black',
    )
    expect(position.board).toEqual(expectedAfterMove.board)
    expect(position.moved).toEqual(expectedAfterMove.moved)
    expect(hashOf(position)).toEqual(hashOf(expectedAfterMove))

    position.unmake()

    expect(Array.from(position.board)).toEqual(initialBoard)
    expect(Array.from(position.moved)).toEqual(initialMoved)
    expect(position.sideToMove).toBe(WHITE)
    expect(hashOf(position)).toEqual(initialHash)

    const replies = new Int32Array(MAX_MOVES)
    const replyCount = generateMoves(position, BLACK, replies)
    expect(
      Array.from(replies.slice(0, replyCount)).some(
        (reply) => moveFrom(reply) === to && moveTo(reply) === squareOf(3, 2),
      ),
    ).toBe(true)
  })

  it('round-trips a promotion and its incremental hash', () => {
    const pieces: Piece[] = [
      {
        id: 'black-pawn',
        side: 'black',
        kind: 'pawn',
        position: { ring: 6, sector: 4 },
        moved: true,
      },
    ]
    const position = positionFromPieces(pieces, 'black')
    const initialHash = hashOf(position)
    const from = squareOf(6, 4)
    const to = squareOf(7, 4)

    position.make(encodeMove(from, to, EMPTY, true))

    expect(position.board[to]).toBe(encodePiece(BLACK, QUEEN))
    expect(hashOf(position)).toEqual(
      hashOf(
        positionFromPieces(
          [
            {
              id: 'black-queen',
              side: 'black',
              kind: 'queen',
              position: { ring: 7, sector: 4 },
              moved: true,
            },
          ],
          'white',
        ),
      ),
    )

    position.unmake()

    expect(position.board[from]).toBe(encodePiece(BLACK, PAWN))
    expect(position.moved[from]).toBe(1)
    expect(position.board[to]).toBe(EMPTY)
    expect(position.moved[to]).toBe(0)
    expect(position.sideToMove).toBe(BLACK)
    expect(hashOf(position)).toEqual(initialHash)
  })

  it('hashes piece, moved-square, and side state deterministically', () => {
    const unmoved: Piece[] = [
      {
        id: 'rook',
        side: 'white',
        kind: 'rook',
        position: { ring: 4, sector: 3 },
        moved: false,
      },
    ]
    const moved = [{ ...unmoved[0]!, moved: true }]

    const first = positionFromPieces(unmoved, 'white')
    const same = positionFromPieces(unmoved, 'white')
    const movedPosition = positionFromPieces(moved, 'white')
    const blackToMove = positionFromPieces(unmoved, 'black')

    expect(hashOf(first)).toEqual(hashOf(same))
    expect(hashOf(first)).not.toEqual(hashOf(movedPosition))
    expect(hashOf(first)).not.toEqual(hashOf(blackToMove))
    expect(first.board[squareOf(4, 3)]).toBe(encodePiece(WHITE, ROOK))
  })

  it('updates and restores the hash when a turn passes', () => {
    const position = positionFromPieces([], 'white')
    const initialHash = hashOf(position)
    const expectedPassedHash = hashOf(positionFromPieces([], 'black'))

    position.makePass()

    expect(position.sideToMove).toBe(BLACK)
    expect(hashOf(position)).toEqual(expectedPassedHash)
    expect(hashOf(position)).not.toEqual(initialHash)

    position.unmakePass()

    expect(position.sideToMove).toBe(WHITE)
    expect(hashOf(position)).toEqual(initialHash)
  })
})
