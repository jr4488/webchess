import { describe, expect, it } from 'vitest'

import type { Piece } from '../../types'
import { createInitialPieces } from '../game'
import { MATE_SCORE } from './evaluate'
import { findBestMove, searchBestMove } from './index'
import { Search } from './search'
import {
  EMPTY,
  encodeMove,
  positionFromPieces,
  squareOf,
} from './position'

function at(
  id: string,
  side: Piece['side'],
  kind: Piece['kind'],
  ring: number,
  sector: number,
): Piece {
  return { id, side, kind, position: { ring, sector }, moved: true }
}

describe('search results', () => {
  it('takes a free king immediately and reports a decisive score', () => {
    const pieces = [
      at('wr', 'white', 'rook', 4, 0),
      at('wk', 'white', 'king', 7, 4),
      at('bk', 'black', 'king', 4, 3),
    ]

    const move = findBestMove(pieces, 'white', 'decisive', { depth: 3 })

    expect(move?.captured?.kind).toBe('king')
    expect(move?.score).toBeGreaterThanOrEqual(MATE_SCORE - 8)
  })

  it('returns null only when the side genuinely cannot move', () => {
    expect(findBestMove([], 'white', 'empty', { depth: 2 })).toBeNull()

    const boxedIn = [at('wp', 'white', 'pawn', 0, 0), at('bk', 'black', 'king', 4, 4)]
    expect(findBestMove(boxedIn, 'white', 'stuck', { depth: 2 })).toBeNull()
  })

  it('gives the same answer for the same seed and a different one for another', () => {
    const pieces = createInitialPieces()

    const first = findBestMove(pieces, 'white', 'problem-a', { depth: 2 })
    const again = findBestMove(pieces, 'white', 'problem-a', { depth: 2 })
    expect(again).toEqual(first)

    // Equally strong opening moves exist, so the seed should be able to pick a
    // different one; otherwise every game would open identically.
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const chosen = new Set(
      seeds.map((seed) => {
        const move = findBestMove(pieces, 'white', seed, { depth: 2 })
        return `${move?.pieceId}>${move?.to.ring}:${move?.to.sector}`
      }),
    )
    expect(chosen.size).toBeGreaterThan(1)
  })

  it('reports the origin square the moving piece actually stands on', () => {
    const pieces = createInitialPieces()
    const move = findBestMove(pieces, 'black', 'origin', { depth: 2 })
    const mover = pieces.find((piece) => piece.id === move?.pieceId)

    expect(move?.from).toEqual(mover?.position)
    expect(mover?.side).toBe('black')
  })

  it('searches more nodes as the depth rises', () => {
    const pieces = createInitialPieces()
    const shallow = searchBestMove(pieces, 'white', 'nodes', { depth: 1 })
    const deeper = searchBestMove(pieces, 'white', 'nodes', { depth: 3 })

    expect(deeper.nodes).toBeGreaterThan(shallow.nodes)
  })

})

describe('node budget', () => {
  // Coverage instrumentation makes these searches far slower than in a browser.
  const BUDGET_TIMEOUT = 120_000
  const pieces = createInitialPieces()

  it('stays within the budget it is given', () => {
    for (const nodeBudget of [3_000, 20_000, 90_000]) {
      const outcome = searchBestMove(pieces, 'white', 'budget', { nodeBudget })

      expect(outcome.move, `budget ${nodeBudget}`).not.toBeNull()
      // One abandoned iteration may run up to the remaining budget before it
      // gives up, so the ceiling is the budget plus that final attempt.
      expect(outcome.nodes, `budget ${nodeBudget}`).toBeLessThanOrEqual(nodeBudget * 2)
    }
  }, BUDGET_TIMEOUT)

  it('reaches a deeper result when allowed more work', () => {
    const small = searchBestMove(pieces, 'white', 'budget', { nodeBudget: 3_000 })
    const large = searchBestMove(pieces, 'white', 'budget', { nodeBudget: 150_000 })

    expect(large.depth).toBeGreaterThan(small.depth)
    expect(large.nodes).toBeGreaterThan(small.nodes)
  }, BUDGET_TIMEOUT)

  it('still returns a move on a budget too small to deepen at all', () => {
    const outcome = searchBestMove(pieces, 'white', 'tiny', { nodeBudget: 1 })

    expect(outcome.move).not.toBeNull()
    expect(outcome.depth).toBe(2)
  })

  it('picks the same depth every time, so a replay repeats the game', () => {
    const first = searchBestMove(pieces, 'white', 'stable', { nodeBudget: 40_000 })
    const second = searchBestMove(pieces, 'white', 'stable', { nodeBudget: 40_000 })

    expect(second).toEqual(first)
  }, BUDGET_TIMEOUT)
})

describe('draw awareness', () => {
  const winningPosition = [
    at('wk', 'white', 'king', 7, 0),
    at('wq', 'white', 'queen', 5, 2),
    at('bk', 'black', 'king', 0, 0),
  ]

  it('draws on exactly the 100th quiet ply, not one ply early', () => {
    const stillLive = findBestMove(
      winningPosition,
      'white',
      'progress',
      { depth: 1, quietPlies: 98 },
    )
    const exhausted = findBestMove(
      winningPosition,
      'white',
      'progress',
      { depth: 1, quietPlies: 99 },
    )

    expect(stillLive?.score).toBeGreaterThan(0)
    expect(Math.abs(exhausted!.score)).toBe(0)
  })

  it('draws on exactly the 256th completed ply, not one ply early', () => {
    const stillLive = findBestMove(
      winningPosition,
      'white',
      'move-limit',
      { depth: 1, ply: 254 },
    )
    const exhausted = findBestMove(
      winningPosition,
      'white',
      'move-limit',
      { depth: 1, ply: 255 },
    )

    expect(stillLive?.score).toBeGreaterThan(0)
    expect(Math.abs(exhausted!.score)).toBe(0)
  })

  it('stops a quiescence capture exactly at the 256-ply horizon', () => {
    const pieces = [
      at('wk', 'white', 'king', 7, 7),
      at('wq', 'white', 'queen', 4, 1),
      at('bk', 'black', 'king', 0, 7),
      at('bp', 'black', 'pawn', 3, 0),
    ]
    const rootMove = encodeMove(squareOf(7, 7), squareOf(6, 7), EMPTY, false)
    const scoreAt = (completedPlies: number) => new Search(
      positionFromPieces(pieces, 'white'),
      {
        depth: 1,
        startPly: completedPlies,
        startQuietPlies: 0,
      },
    ).scoreRootMove(rootMove)

    expect(scoreAt(253)).toBeLessThan(0)
    expect(scoreAt(254)).toBe(0)
  })
})
