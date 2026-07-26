import { describe, expect, it, vi } from 'vitest'

import type { Piece } from '../../types'
import { forcedPassPieces } from '../../test/engine-fixtures'
import { createInitialPieces, getLegalMoves } from '../game'
import { MATE_SCORE } from './evaluate'
import { findBestMove, searchBestMove } from './index'
import type { SearchOutcome } from './index'
import { encodeMove, positionFromPieces, squareOf } from './position'
import { Search } from './search'

function at(
  id: string,
  side: Piece['side'],
  kind: Piece['kind'],
  ring: number,
  sector: number,
): Piece {
  return { id, side, kind, position: { ring, sector }, moved: true }
}

function deterministicFields(outcome: SearchOutcome): Omit<SearchOutcome, 'elapsedMs' | 'nps'> {
  return {
    move: outcome.move,
    nodes: outcome.nodes,
    depth: outcome.depth,
    score: outcome.score,
    ttHits: outcome.ttHits,
    principalVariation: outcome.principalVariation,
    stopReason: outcome.stopReason,
  }
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
    const first = searchBestMove(pieces, 'white', 'tiny', { nodeBudget: 1 })
    const second = searchBestMove(pieces, 'white', 'tiny', { nodeBudget: 1 })
    const mover = pieces.find((piece) => piece.id === first.move?.pieceId)

    expect(first).toMatchObject({
      depth: 0,
      nodes: 1,
      stopReason: 'nodes',
    })
    expect(first.move).not.toBeNull()
    expect(mover).toBeDefined()
    expect(getLegalMoves(mover!, pieces)).toContainEqual(first.move!.to)
    expect(first.principalVariation[0]).toEqual({
      from: first.move!.from,
      to: first.move!.to,
    })
    expect(deterministicFields(second)).toEqual(deterministicFields(first))
  })

  it('picks the same depth every time, so a replay repeats the game', () => {
    const first = searchBestMove(pieces, 'white', 'stable', { nodeBudget: 40_000 })
    const second = searchBestMove(pieces, 'white', 'stable', { nodeBudget: 40_000 })

    expect(deterministicFields(second)).toEqual(deterministicFields(first))
  }, BUDGET_TIMEOUT)

  it('reports a wall-clock stop separately from a node stop', () => {
    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now++)

    try {
      const outcome = searchBestMove(pieces, 'white', 'timed', {
        depth: 3,
        timeLimitMs: 1,
      })

      expect(outcome).toMatchObject({
        depth: 0,
        nodes: 1,
        stopReason: 'time',
      })
      expect(outcome.move).not.toBeNull()
    } finally {
      clock.mockRestore()
    }
  })
})

describe('draw awareness', () => {
  it('knows a position at the progress limit is already drawn', () => {
    const pieces = [
      at('wk', 'white', 'king', 7, 0),
      at('wq', 'white', 'queen', 5, 2),
      at('bk', 'black', 'king', 0, 0),
    ]

    const winning = findBestMove(pieces, 'white', 'progress', { depth: 3, quietPlies: 0 })
    const exhausted = findBestMove(pieces, 'white', 'progress', { depth: 3, quietPlies: 99 })

    expect(winning?.score).toBeGreaterThan(0)
    expect(Math.abs(exhausted!.score)).toBe(0)
  })

  it('searches the opponent reply on action 256, then stops before action 257', () => {
    const pieces = [
      at('wk', 'white', 'king', 4, 0),
      at('wr', 'white', 'rook', 4, 1),
      at('wp', 'white', 'pawn', 4, 7),
      at('bk', 'black', 'king', 0, 4),
      at('br', 'black', 'rook', 4, 3),
    ]
    const unsafe = encodeMove(squareOf(4, 1), squareOf(3, 1), 0, false)
    const safe = encodeMove(squareOf(4, 0), squareOf(3, 0), 0, false)
    const candidates = Int32Array.of(unsafe, safe)

    const beforeAction255 = new Search(positionFromPieces(pieces, 'white'), {
      depth: 2,
      completedPlies: 254,
      startQuietPlies: 0,
    })
    const action255 = beforeAction255.searchRoot(
      candidates,
      candidates.length,
      2,
      -MATE_SCORE,
      MATE_SCORE,
      unsafe,
    )

    // Moving the rook exposes White's King to a Black rook capture on action
    // 256. A search that stops one ply too early incorrectly treats both
    // candidates as draws and keeps the preferred unsafe move.
    expect(action255).toMatchObject({ move: safe, score: 0 })

    const beforeAction256 = searchBestMove(pieces, 'white', 'last-action', {
      depth: 2,
      completedPlies: 255,
    })
    const afterAction256 = searchBestMove(pieces, 'white', 'last-action', {
      depth: 2,
      completedPlies: 256,
    })

    expect(beforeAction256.stopReason).toBe('depth')
    expect(Math.abs(beforeAction256.score)).toBe(0)
    expect(beforeAction256.move).not.toBeNull()
    expect(afterAction256).toMatchObject({
      move: null,
      nodes: 0,
      depth: 0,
      score: 0,
      stopReason: 'game-over',
    })
  })

  it('lets a King capture on action 256 override the move-limit draw', () => {
    const pieces = [
      at('wr', 'white', 'rook', 4, 0),
      at('wk', 'white', 'king', 7, 4),
      at('bk', 'black', 'king', 4, 3),
    ]

    const outcome = searchBestMove(pieces, 'white', 'last-capture', {
      depth: 2,
      completedPlies: 255,
    })

    expect(outcome.move?.captured?.kind).toBe('king')
    expect(outcome.score).toBe(MATE_SCORE)
  })

  it('keeps the principal variation intact across a forced pass', () => {
    const pieces = forcedPassPieces()
    const position = positionFromPieces(pieces, 'black')
    const boardBefore = position.board.slice()
    const movedBefore = position.moved.slice()
    const hashBefore = [position.hashLow, position.hashHigh]
    const outcome = searchBestMove(pieces, 'black', 'pass-pv', { depth: 3 })

    // White is caged throughout: Black moves, White passes, then Black moves
    // again. Pass is an internal PV action, so the public coordinate line has
    // two Black moves rather than being truncated at White's turn.
    expect(outcome.principalVariation).toHaveLength(2)

    const search = new Search(position, {
      depth: 3,
      completedPlies: 0,
      startQuietPlies: 0,
    })
    const rootMove = encodeMove(squareOf(4, 4), squareOf(4, 3), 0, false)
    search.searchRoot(Int32Array.of(rootMove), 1, 3, -MATE_SCORE, MATE_SCORE)
    search.principalVariation(3)

    expect(position.board).toEqual(boardBefore)
    expect(position.moved).toEqual(movedBefore)
    expect([position.hashLow, position.hashHigh]).toEqual(hashBefore)
  })
})

describe('quiescence', () => {
  it('extends a quiet promotion instead of evaluating the pawn one move early', () => {
    const scoreAfterForcedKingMove = (blackPawnRing: number): number => {
      const pieces = [
        at('wk', 'white', 'king', 4, 0),
        at('wr', 'white', 'rook', 3, 6),
        at('bk', 'black', 'king', 0, 4),
        at('bp', 'black', 'pawn', blackPawnRing, 3),
      ]
      const forcedMove = encodeMove(squareOf(4, 0), squareOf(4, 1), 0, false)
      const search = new Search(positionFromPieces(pieces, 'white'), {
        depth: 1,
        completedPlies: 0,
        startQuietPlies: 0,
      })

      return search.searchRoot(
        Int32Array.of(forcedMove),
        1,
        1,
        -MATE_SCORE,
        MATE_SCORE,
        forcedMove,
      ).score
    }

    expect(scoreAfterForcedKingMove(6)).toBeLessThan(0)
    expect(scoreAfterForcedKingMove(5)).toBeGreaterThan(0)
  })
})
