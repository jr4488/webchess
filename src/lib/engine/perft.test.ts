import { describe, expect, it } from 'vitest'

import { webChessPerft } from '../../test/engine-perft'
import {
  PERFT_FIXTURES,
  forcedPassPieces,
  moveLimitPieces,
} from '../../test/engine-fixtures'
import { positionFromPieces } from './position'

describe('canonical WebChess perft fixtures', () => {
  for (const fixture of PERFT_FIXTURES) {
    for (const [depthText, expected] of Object.entries(fixture.expected)) {
      const depth = Number(depthText)

      it(`${fixture.name} has ${expected} leaves at depth ${depth}`, () => {
        const position = positionFromPieces(fixture.pieces, fixture.sideToMove)

        expect(webChessPerft(position, depth).nodes).toBe(expected)
      })
    }
  }
})

describe('variant terminal transitions', () => {
  it('counts a forced pass as one ply and then lets the opponent move', () => {
    const position = positionFromPieces(forcedPassPieces(), 'white')

    expect(webChessPerft(position, 1)).toMatchObject({ nodes: 1, passes: 1 })
    expect(webChessPerft(position, 2)).toMatchObject({ nodes: 8, passes: 1 })
  })

  it('makes action 256 legal and stops before action 257', () => {
    const pieces = moveLimitPieces()

    const beforeAction255 = positionFromPieces(pieces, 'white')
    expect(webChessPerft(beforeAction255, 2, { completedPlies: 254 })).toMatchObject({
      nodes: 25,
      moveLimitDraws: 0,
    })

    const beforeAction256 = positionFromPieces(pieces, 'white')
    expect(webChessPerft(beforeAction256, 2, { completedPlies: 255 })).toMatchObject({
      nodes: 5,
      moveLimitDraws: 5,
    })
  })

  it('lets a pass consume the final legal action', () => {
    const position = positionFromPieces(forcedPassPieces(), 'white')

    expect(webChessPerft(position, 2, { completedPlies: 255 })).toMatchObject({
      nodes: 1,
      passes: 1,
      moveLimitDraws: 1,
    })
  })
})
