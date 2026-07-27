import type { DivisionAnalysis, ProblemFacet, ProblemPart } from '../types'
import {
  BOARD_SECTOR_COUNT,
  deterministicShuffle,
  HEXAGRAM_LENSES,
  PROBLEM_DIMENSIONS,
  PROBLEM_MOVEMENTS,
} from './problem'

const FACET_COUNT = 64

export type DivisionPermutation = 'facets' | 'hexagrams' | 'board'

export function divisionSeed(
  seed: DivisionAnalysis['seed'],
  permutation: DivisionPermutation,
): string {
  return `webchess/division/${String(seed)}/${permutation}`
}

function cleanFacetString(value: unknown, field: string, id: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Facet ${id} is missing ${field}.`)
  }
  return value.trim()
}

function parseFacets(value: unknown): ProblemFacet[] {
  if (!Array.isArray(value) || value.length !== FACET_COUNT) {
    const count = Array.isArray(value) ? value.length : 0
    throw new Error(`The model returned ${count} facets; WebChess requires exactly 64.`)
  }

  const facets = value.map((candidate, index): ProblemFacet => {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error(`Facet ${index + 1} is not a valid object.`)
    }
    const record = candidate as Record<string, unknown>
    const id = record.id
    if (!Number.isInteger(id) || Number(id) < 1 || Number(id) > FACET_COUNT) {
      throw new Error(`Facet ${index + 1} has an invalid id.`)
    }

    return {
      id: Number(id),
      title: cleanFacetString(record.title, 'a title', Number(id)),
      focus: cleanFacetString(record.focus, 'a focus', Number(id)),
      question: cleanFacetString(record.question, 'a question', Number(id)),
      keyword: cleanFacetString(record.keyword, 'a keyword', Number(id)),
    }
  })

  if (new Set(facets.map((facet) => facet.id)).size !== FACET_COUNT) {
    throw new Error('The model must return each facet id from 1 through 64 exactly once.')
  }

  return facets
}

export function composeProblemParts(
  facets: readonly ProblemFacet[],
  seed: DivisionAnalysis['seed'],
): ProblemPart[] {
  const validatedFacets = parseFacets(facets).sort((left, right) => left.id - right.id)
  const shuffledFacets = deterministicShuffle(validatedFacets, divisionSeed(seed, 'facets'))
  const shuffledHexagrams = deterministicShuffle(
    HEXAGRAM_LENSES,
    divisionSeed(seed, 'hexagrams'),
  )

  const paired = shuffledFacets.map((facet, index): ProblemPart => {
    const originalSlot = facet.id - 1
    const dimension = PROBLEM_DIMENSIONS[Math.floor(originalSlot / BOARD_SECTOR_COUNT)]
    const movement = PROBLEM_MOVEMENTS[originalSlot % BOARD_SECTOR_COUNT]
    const hexagram = shuffledHexagrams[index]

    return {
      id: facet.id,
      title: facet.title,
      focus: facet.focus,
      hexagram: hexagram.number,
      hexagramName: hexagram.name,
      theme: hexagram.theme,
      dimension: dimension.name,
      movement: movement.name,
      prompt: facet.question,
      keyword: facet.keyword,
    }
  })

  return deterministicShuffle(paired, divisionSeed(seed, 'board'))
}
