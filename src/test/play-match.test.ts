import { describe, expect, it } from 'vitest'

import type { Piece } from '../types'
import { forcedPassPieces, pieceAt } from './engine-fixtures'
import { playMatch } from './play-match'

const shouldNotMove = (): never => {
  throw new Error('The opponent must not receive another turn.')
}

describe('match rule boundaries', () => {
  it('ends on a pass that consumes action 256', () => {
    const result = playMatch({
      white: () => null,
      black: shouldNotMove,
      seed: 'final-pass',
      maxPlies: 256,
      startingPieces: forcedPassPieces(),
      startingSide: 'white',
      startingCompletedPlies: 255,
    })

    expect(result.outcome).toMatchObject({
      winner: null,
      reason: 'move-limit',
      completedTurn: 256,
    })
    expect(result.plies).toBe(256)
  })

  it('ends on a pass that reaches the progress limit', () => {
    const result = playMatch({
      white: () => null,
      black: shouldNotMove,
      seed: 'quiet-pass',
      startingPieces: forcedPassPieces(),
      startingSide: 'white',
      startingQuietPlies: 99,
    })

    expect(result.outcome).toMatchObject({
      winner: null,
      reason: 'no-progress',
      completedTurn: 1,
    })
  })

  it('does not invent a pass when neither side can move', () => {
    const result = playMatch({
      white: shouldNotMove,
      black: shouldNotMove,
      seed: 'standstill',
      startingPieces: doubleStandstill(),
      startingSide: 'white',
      startingCompletedPlies: 17,
    })

    expect(result.outcome).toMatchObject({
      winner: null,
      reason: 'no-moves',
      completedTurn: 17,
    })
    expect(result.plies).toBe(17)
  })

  it('rejects a chooser that silently passes with legal moves available', () => {
    expect(() =>
      playMatch({
        white: () => null,
        black: () => null,
        seed: 'illegal-pass',
        maxPlies: 1,
      }),
    ).toThrow(/returned no move/)
  })
})

function doubleStandstill(): Piece[] {
  return [
    pieceAt('white-king', 'white', 'king', 0, 0),
    pieceAt('white-pawn-0-7', 'white', 'pawn', 0, 7),
    pieceAt('white-pawn-0-1', 'white', 'pawn', 0, 1),
    pieceAt('white-pawn-1-7', 'white', 'pawn', 1, 7),
    pieceAt('white-pawn-1-0', 'white', 'pawn', 1, 0),
    pieceAt('white-pawn-1-1', 'white', 'pawn', 1, 1),
    pieceAt('black-king', 'black', 'king', 7, 4),
    pieceAt('black-pawn-7-3', 'black', 'pawn', 7, 3),
    pieceAt('black-pawn-7-5', 'black', 'pawn', 7, 5),
    pieceAt('black-pawn-6-3', 'black', 'pawn', 6, 3),
    pieceAt('black-pawn-6-4', 'black', 'pawn', 6, 4),
    pieceAt('black-pawn-6-5', 'black', 'pawn', 6, 5),
  ]
}
