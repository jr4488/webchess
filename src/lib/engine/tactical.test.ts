import { describe, expect, it } from 'vitest'

import type { Piece } from '../../types'
import { applyMove } from '../game'
import { chooseGreedyMove } from '../../test/greedy-baseline'
import { pieceAt } from '../../test/engine-fixtures'
import { makeProblemParts } from '../../test/fixtures'
import { findBestMove } from './index'
import {
  BLACK,
  EMPTY,
  encodeMove,
  positionFromPieces,
  squareOf,
} from './position'
import { Search } from './search'

export const TACTICAL_SUITE_VERSION = 'webchess-tactics-v1'

describe(`tactical corpus ${TACTICAL_SUITE_VERSION}`, () => {
  it('takes a hanging queen through the sector 0/7 seam', () => {
    const pieces: Piece[] = [
      pieceAt('white-rook', 'white', 'rook', 4, 0),
      pieceAt('white-king', 'white', 'king', 7, 4),
      pieceAt('black-queen', 'black', 'queen', 4, 7),
      pieceAt('black-king', 'black', 'king', 0, 4),
    ]

    const move = findBestMove(pieces, 'white', 'seam-queen', { depth: 2 })

    expect(move).toMatchObject({
      pieceId: 'white-rook',
      to: { ring: 4, sector: 7 },
      captured: { id: 'black-queen', kind: 'queen' },
    })
  })

  it('recognizes a capture-promotion across the seam', () => {
    const pieces: Piece[] = [
      pieceAt('white-pawn', 'white', 'pawn', 1, 0),
      pieceAt('white-king', 'white', 'king', 7, 0),
      pieceAt('black-rook', 'black', 'rook', 0, 7),
      pieceAt('black-king', 'black', 'king', 6, 3),
    ]

    const move = findBestMove(pieces, 'white', 'capture-promotion', { depth: 2 })
    expect(move).toMatchObject({
      pieceId: 'white-pawn',
      to: { ring: 0, sector: 7 },
      captured: { id: 'black-rook', kind: 'rook' },
    })

    const result = applyMove(
      pieces,
      move!.pieceId,
      move!.to,
      makeProblemParts('capture-promotion'),
    )
    expect(result.promoted).toMatchObject({ id: 'white-pawn', kind: 'queen' })
  })

  it('declines a poisoned queen when moving the shield loses its king', () => {
    // The rook on 5:2 shields White's king from the bishop. Capturing the
    // queen looks profitable for one ply but exposes a direct king capture.
    const pieces: Piece[] = [
      pieceAt('white-king', 'white', 'king', 7, 0),
      pieceAt('white-rook', 'white', 'rook', 5, 2),
      pieceAt('white-pawn', 'white', 'pawn', 6, 0),
      pieceAt('black-bishop', 'black', 'bishop', 4, 3),
      pieceAt('black-queen', 'black', 'queen', 5, 6),
      pieceAt('black-king', 'black', 'king', 0, 0),
    ]

    expect(chooseGreedyMove(pieces, 'white', 'poisoned')?.captured?.kind).toBe('queen')
    expect(findBestMove(pieces, 'white', 'poisoned', { depth: 2 })?.captured?.kind).not.toBe(
      'queen',
    )
  })

  it('allows a remote draw while its king is attacked because check is not a rule', () => {
    // Black's knight attacks the fully caged White king. After Black's quiet
    // root move takes the progress counter to 99, White may legally move the
    // remote rook and claim the 100-quiet-ply draw. Requiring an orthodox
    // check evasion here fabricates a win that WebChess does not award.
    const pieces: Piece[] = [
      pieceAt('white-king', 'white', 'king', 0, 0),
      pieceAt('white-pawn-0-7', 'white', 'pawn', 0, 7),
      pieceAt('white-pawn-0-1', 'white', 'pawn', 0, 1),
      pieceAt('white-pawn-1-7', 'white', 'pawn', 1, 7),
      pieceAt('white-pawn-1-0', 'white', 'pawn', 1, 0),
      pieceAt('white-pawn-1-1', 'white', 'pawn', 1, 1),
      pieceAt('white-rook', 'white', 'rook', 4, 4),
      pieceAt('black-knight', 'black', 'knight', 2, 1),
      pieceAt('black-king', 'black', 'king', 7, 6),
    ]
    const position = positionFromPieces(pieces, 'black')
    const quietKingMove = encodeMove(squareOf(7, 6), squareOf(7, 5), EMPTY, false)
    const search = new Search(position, {
      depth: 1,
      completedPlies: 0,
      startQuietPlies: 98,
    })

    expect(
      search.searchRoot(Int32Array.of(quietKingMove), 1, 1, -1_000_000, 1_000_000).score,
    ).toBe(0)
    expect(position.sideToMove).toBe(BLACK)
  })
})
