import { describe, expect, it } from 'vitest'

import type { Piece, Side } from '../../types'
import {
  formatArenaResult,
  generateLegalOpening,
  runPairedArena,
} from '../../test/engine-arena'
import {
  GREEDY_BASELINE_ID,
  chooseGreedyMove,
} from '../../test/greedy-baseline'
import { playMatch } from '../../test/play-match'
import { findBestMove } from './index'

const SEARCH_DEPTH = 3

function engineChooser(depth = SEARCH_DEPTH) {
  return (pieces: readonly Piece[], side: Side, seed: string | number, ply: number, quiet: number) =>
    findBestMove(pieces, side, seed, {
      depth,
      completedPlies: Math.max(0, ply - 1),
      quietPlies: quiet,
    })
}

const greedyChooser = (
  pieces: readonly Piece[],
  side: Side,
  seed: string | number,
) => chooseGreedyMove(pieces, side, seed)

/** Full games take tens of seconds; the default per-test budget is far short. */
const MATCH_TIMEOUT = 240_000

describe('engine strength against the previous one-ply scorer', () => {
  it('scores at least 75% in paired colors from varied legal openings', () => {
    const openings = ['clarity', 'tempo', 'risk'].map((seed) =>
      generateLegalOpening(seed, 6),
    )
    const result = runPairedArena({
      candidateId: 'webchess-engine-v2-depth-3',
      candidate: engineChooser(),
      baselineId: GREEDY_BASELINE_ID,
      baseline: greedyChooser,
      openings,
    })

    console.log(formatArenaResult(result))
    expect(result.baselineId).toBe('legacy-greedy-v1')
    expect(result.legs).toHaveLength(openings.length * 2)
    expect(result.points).toBeGreaterThanOrEqual(result.legs.length * 0.75)
  }, MATCH_TIMEOUT)

  it('pins the legacy baseline on the arena opening corpus', () => {
    const choices = ['clarity', 'tempo', 'risk'].map((seed) => {
      const opening = generateLegalOpening(seed, 6)
      const move = chooseGreedyMove(opening.pieces, opening.sideToMove, 'baseline-pin')
      return `${move?.pieceId}>${move?.to.ring}:${move?.to.sector}`
    })

    expect(GREEDY_BASELINE_ID).toBe('legacy-greedy-v1')
    expect(choices).toEqual([
      'white-bishop-2>1:3',
      'white-queen-1>4:1',
      'white-bishop-2>1:3',
    ])
  })

  it('ends with more material than the one-ply scorer on average', () => {
    let engineMaterial = 0
    let greedyMaterial = 0

    for (const seed of ['weighing', 'sequence']) {
      const game = playMatch({ white: engineChooser(), black: greedyChooser, seed })
      engineMaterial += game.material.white
      greedyMaterial += game.material.black
    }

    expect(engineMaterial).toBeGreaterThan(greedyMaterial)
  }, MATCH_TIMEOUT)
})

describe('depth is worth something', () => {
  it('lets the deeper side beat the shallower one from either colour', () => {
    for (const deepSide of ['white', 'black'] as const) {
      const game = playMatch({
        white: deepSide === 'white' ? engineChooser(3) : engineChooser(1),
        black: deepSide === 'black' ? engineChooser(3) : engineChooser(1),
        seed: `depth/${deepSide}`,
        maxPlies: 160,
      })

      const deepMaterial = game.material[deepSide]
      const shallowMaterial = game.material[deepSide === 'white' ? 'black' : 'white']
      expect(deepMaterial, `${deepSide} at depth 3 vs depth 1`).toBeGreaterThan(shallowMaterial)
    }
  }, MATCH_TIMEOUT)
})

describe('king safety', () => {
  it('declines a queen that costs it the king, which the one-ply scorer took', () => {
    // The rook shields the king from the bishop. Taking the queen wins material
    // for exactly one ply and loses the game on the next.
    const pieces: Piece[] = [
      { id: 'wk', side: 'white', kind: 'king', position: { ring: 7, sector: 0 }, moved: true },
      { id: 'wr', side: 'white', kind: 'rook', position: { ring: 5, sector: 2 }, moved: true },
      { id: 'wp', side: 'white', kind: 'pawn', position: { ring: 6, sector: 0 }, moved: true },
      { id: 'bb', side: 'black', kind: 'bishop', position: { ring: 4, sector: 3 }, moved: true },
      { id: 'bq', side: 'black', kind: 'queen', position: { ring: 5, sector: 6 }, moved: true },
      { id: 'bk', side: 'black', kind: 'king', position: { ring: 0, sector: 0 }, moved: true },
    ]

    expect(chooseGreedyMove(pieces, 'white', 'exposed')?.captured?.kind).toBe('queen')
    expect(findBestMove(pieces, 'white', 'exposed', { depth: 2 })?.captured?.kind).not.toBe('queen')
  })
})
