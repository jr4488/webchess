import { describe, expect, it } from 'vitest'

import { makeProblemParts } from '../test/fixtures'
import {
  HEXAGRAM_LENSES,
  PROBLEM_DIMENSIONS,
  PROBLEM_MOVEMENTS,
  createSeededRandom,
  deterministicShuffle,
  hashString,
  normalizeProblemInput,
  problemPartAt,
} from './problem'

describe('problem-board primitives', () => {
  it('defines the 8 × 8 metadata grid and all 64 I Ching lenses', () => {
    expect(PROBLEM_DIMENSIONS).toHaveLength(8)
    expect(PROBLEM_MOVEMENTS).toHaveLength(8)
    expect(HEXAGRAM_LENSES).toHaveLength(64)
    expect(new Set(HEXAGRAM_LENSES.map((hexagram) => hexagram.number))).toEqual(
      new Set(Array.from({ length: 64 }, (_, index) => index + 1)),
    )
  })

  it('normalizes submitted problem whitespace without inventing content', () => {
    expect(normalizeProblemInput('  How   should\nthis change?  ')).toBe(
      'How should this change?',
    )
    expect(normalizeProblemInput('   ')).toBe('')
  })

  it('provides stable hashing, random sequences, and seeded permutations', () => {
    const firstRandom = createSeededRandom('a considered question')
    const secondRandom = createSeededRandom('a considered question')
    const values = Array.from({ length: 16 }, (_, index) => index + 1)

    expect(hashString('WebChess')).toBe(hashString('WebChess'))
    expect(Array.from({ length: 6 }, () => firstRandom())).toEqual(
      Array.from({ length: 6 }, () => secondRandom()),
    )
    expect(deterministicShuffle(values, 'seed')).toEqual(
      deterministicShuffle(values, 'seed'),
    )
    expect(deterministicShuffle(values, 'other-seed')).not.toEqual(
      deterministicShuffle(values, 'seed'),
    )
  })

  it('looks up a board part by ring and sector', () => {
    const parts = makeProblemParts('board lookup')

    expect(problemPartAt(parts, { ring: 3, sector: 5 })).toBe(parts[29])
    expect(() => problemPartAt(parts.slice(1), { ring: 0, sector: 0 })).toThrow(/exactly 64/)
    expect(() => problemPartAt(parts, { ring: 8, sector: 0 })).toThrow(/Invalid board coordinate/)
  })
})
