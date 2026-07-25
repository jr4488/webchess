import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeProblemFacets } from '../test/fixtures'
import {
  composeProblemParts,
  divisionSeed,
  parseDivisionAnalysis,
  requestProblemDivision,
} from './division'
import { deterministicShuffle, HEXAGRAM_LENSES } from './problem'

describe('semantic problem division', () => {
  afterEach(() => vi.unstubAllGlobals())

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

  it('posts only the problem and parses the server analysis', async () => {
    const response = {
      facets: makeProblemFacets(),
      seed: 'fresh-server-seed',
      model: 'gpt-5.6-sol',
      prompt: 'Canonical division prompt',
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestProblemDivision(
      'How should this plan change?',
      undefined,
      'csrf-token',
    )).resolves.toEqual(
      parseDivisionAnalysis(response),
    )
    expect(fetchMock).toHaveBeenCalledWith('/api/divide', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-WebChess-CSRF': 'csrf-token' }),
      body: JSON.stringify({ problem: 'How should this plan change?' }),
    }))
  })

  it('surfaces an expired session distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Your access session has expired.',
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(requestProblemDivision('How should this plan change?')).rejects.toMatchObject({
      name: 'SessionRequiredError',
      status: 401,
      message: 'Your access session has expired.',
    })
  })
})
