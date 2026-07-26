import { describe, expect, it } from 'vitest'

import type { Piece, Side } from '../types'
import { applyMove, coordKey, createInitialPieces, getLegalMoves } from '../lib/game'
import {
  chooseFirstLegalMove,
  formatArenaResult,
  generateLegalOpening,
  runPairedArena,
} from './engine-arena'
import { makeProblemParts } from './fixtures'

describe('legal opening generation', () => {
  it('returns a line that replays through the canonical rules', () => {
    const opening = generateLegalOpening('replayable', 8)
    const parts = makeProblemParts('opening-replay')
    let pieces: readonly Piece[] = createInitialPieces()
    let side: Side = 'white'

    expect(opening.actions).toHaveLength(8)
    for (const [index, action] of opening.actions.entries()) {
      expect(action.side).toBe(side)
      expect(action.pieceId, `unexpected pass at opening ply ${index + 1}`).not.toBeNull()

      const mover = pieces.find((piece) => piece.id === action.pieceId)
      expect(mover?.position).toEqual(action.from)
      expect(
        getLegalMoves(mover!, pieces).some((move) => coordKey(move) === coordKey(action.to!)),
      ).toBe(true)

      pieces = applyMove(pieces, action.pieceId!, action.to!, parts, index + 1).pieces
      side = side === 'white' ? 'black' : 'white'
    }

    expect(pieces).toEqual(opening.pieces)
    expect(side).toBe(opening.sideToMove)
    expect(opening.completedPlies).toBe(8)
  })

  it('produces varied positions from fixed, reproducible seeds', () => {
    const seeds = ['clarity', 'tempo', 'risk', 'space']
    const first = seeds.map((seed) => generateLegalOpening(seed, 6))
    const again = seeds.map((seed) => generateLegalOpening(seed, 6))

    expect(again.map((opening) => opening.signature)).toEqual(
      first.map((opening) => opening.signature),
    )
    expect(new Set(first.map((opening) => opening.signature)).size).toBe(seeds.length)
  })
})

describe('paired-color arena accounting', () => {
  it('plays every opening from both colors and reports candidate W-D-L', () => {
    const openings = [
      generateLegalOpening('paired-a', 4),
      generateLegalOpening('paired-b', 4),
    ]
    const result = runPairedArena({
      candidateId: 'same-policy-candidate',
      candidate: chooseFirstLegalMove,
      baselineId: 'same-policy-baseline',
      baseline: chooseFirstLegalMove,
      openings,
      maxPlies: 16,
    })

    expect(result.legs).toHaveLength(openings.length * 2)
    expect(result.legs.map((leg) => leg.candidateSide)).toEqual([
      'white',
      'black',
      'white',
      'black',
    ])
    for (let index = 0; index < result.legs.length; index += 2) {
      expect(result.legs[index]!.match).toEqual(result.legs[index + 1]!.match)
    }
    expect(result.wdl.wins).toBe(result.wdl.losses)
    expect(result.points).toBe(openings.length)
    expect(formatArenaResult(result)).toContain(
      `W-D-L ${result.wdl.wins}-${result.wdl.draws}-${result.wdl.losses}`,
    )
  })
})
