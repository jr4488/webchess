import { describe, expect, it } from 'vitest'

import type { Piece, Side } from '../../types'
import { chooseGreedyMove } from '../../test/greedy-baseline'
import { playMatch } from '../../test/play-match'
import { findBestMove } from './index'

const SEARCH_DEPTH = 3

function engineChooser(depth = SEARCH_DEPTH) {
  return (pieces: readonly Piece[], side: Side, seed: string | number, ply: number, quiet: number) =>
    findBestMove(pieces, side, seed, { depth, ply, quietPlies: quiet })
}

const greedyChooser = (
  pieces: readonly Piece[],
  side: Side,
  seed: string | number,
) => chooseGreedyMove(pieces, side, seed)

/** Full games take tens of seconds; the default per-test budget is far short. */
const MATCH_TIMEOUT = 240_000

describe('engine strength against the previous one-ply scorer', () => {
  it('wins or draws every game from both colours', () => {
    const seeds = ['clarity', 'tempo', 'risk']
    const results: string[] = []
    let enginePoints = 0

    for (const seed of seeds) {
      const asWhite = playMatch({
        white: engineChooser(),
        black: greedyChooser,
        seed: `${seed}/white`,
      })
      const asBlack = playMatch({
        white: greedyChooser,
        black: engineChooser(),
        seed: `${seed}/black`,
      })

      enginePoints += asWhite.outcome.winner === 'white' ? 1 : asWhite.outcome.winner ? 0 : 0.5
      enginePoints += asBlack.outcome.winner === 'black' ? 1 : asBlack.outcome.winner ? 0 : 0.5

      results.push(
        `${seed}: engine as White -> ${describe_(asWhite.outcome.winner)} in ${asWhite.plies} plies ` +
          `(material ${asWhite.material.white} vs ${asWhite.material.black}); ` +
          `engine as Black -> ${describe_(asBlack.outcome.winner)} in ${asBlack.plies} plies ` +
          `(material ${asBlack.material.black} vs ${asBlack.material.white})`,
      )
    }

    console.log(results.join('\n'))
    expect(enginePoints).toBeGreaterThanOrEqual(seeds.length * 2 * 0.75)
  }, MATCH_TIMEOUT)

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

function describe_(winner: Side | null): string {
  return winner === null ? 'draw' : `${winner} wins`
}
