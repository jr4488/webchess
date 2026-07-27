import { describe, expect, it } from 'vitest'

import { makeProblemFacets } from '../test/fixtures'
import {
  composeProblemParts,
  divisionSeed,
} from './division'
import { deterministicShuffle, HEXAGRAM_LENSES } from './problem'

describe('semantic problem division', () => {
  it('uses independent facet, hexagram, and board permutations', () => {
    const facets = makeProblemFacets()
    const seed = 'server-random-seed-42'
    const facetOrder = deterministicShuffle(facets, divisionSeed(seed, 'facets'))
    const hexagramOrder = deterministicShuffle(
      HEXAGRAM_LENSES,
      divisionSeed(seed, 'hexagrams'),
    )
    const parts = composeProblemParts(facets, seed)
    const expectedPairings = new Map(
      facetOrder.map((facet, index) => [facet.id, hexagramOrder[index].number]),
    )
    const expectedBoardOrder = deterministicShuffle(
      facetOrder.map((facet) => facet.id),
      divisionSeed(seed, 'board'),
    )

    expect(facetOrder.map((facet) => facet.id)).not.toEqual(
      hexagramOrder.map((hexagram) => hexagram.number),
    )
    expect(new Map(parts.map((part) => [part.id, part.hexagram]))).toEqual(expectedPairings)
    expect(parts.map((part) => part.id)).toEqual(expectedBoardOrder)
  })

  it('is reproducible for one server seed and remaps for a new seed', () => {
    const facets = makeProblemFacets()
    const first = composeProblemParts(facets, 'seed-a')
    const replay = composeProblemParts([...facets].reverse(), 'seed-a')
    const newDivision = composeProblemParts(facets, 'seed-b')

    expect(replay).toEqual(first)
    expect(newDivision).not.toEqual(first)
  })

  it('keeps dimension and movement metadata tied to each facet id original slot', () => {
    const parts = composeProblemParts(makeProblemFacets(), 'metadata-seed')
    const byId = new Map(parts.map((part) => [part.id, part]))

    expect(byId.get(1)).toMatchObject({ dimension: 'Purpose', movement: 'Begin' })
    expect(byId.get(9)).toMatchObject({ dimension: 'People', movement: 'Begin' })
    expect(byId.get(64)).toMatchObject({
      dimension: 'Possibilities',
      movement: 'Release',
      title: 'Facet 64',
      focus: 'Concrete focus 64',
      prompt: 'What would clarify facet 64?',
    })
  })

  it('rejects anything other than 64 distinct complete facets', () => {
    const incomplete = makeProblemFacets().slice(0, 63)
    expect(() => composeProblemParts(incomplete, 'bad-seed')).toThrow(/requires exactly 64/i)

    const duplicated = makeProblemFacets()
    duplicated[63] = { ...duplicated[63], id: 1 }
    expect(() => composeProblemParts(duplicated, 'bad-seed')).toThrow(/each facet id/i)
  })

})
