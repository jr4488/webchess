import type { DivisionAnalysis, ProblemFacet, ProblemPart } from '../types'
import {
  BOARD_SECTOR_COUNT,
  deterministicShuffle,
  HEXAGRAM_LENSES,
  PROBLEM_DIMENSIONS,
  PROBLEM_MOVEMENTS,
} from './problem'

const FACET_COUNT = 64
export const DIVISION_CAST_APPLICATION_MIN_CHARS = 20
export const DIVISION_CAST_APPLICATION_MAX_CHARS = 480

export type DivisionPermutation = 'facets' | 'hexagrams' | 'board'

export const DIVISION_CAST_BINDING_VERSION =
  'webchess-division-cast-binding-v1' as const

/**
 * Trusted, replayable direction supplied to the model for one fixed facet ID.
 * The pairing is derived only from the durable Division seed; model output
 * cannot choose or rearrange it.
 */
export interface DivisionCastAssignment {
  readonly id: number
  readonly dimension: string
  readonly movement: string
  readonly hexagram: number
  readonly hexagramName: string
  readonly theme: string
  readonly directionalCue: string
}

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

function cleanCastApplication(value: unknown, id: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error(`Facet ${id} has an invalid cast application.`)
  }
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (
    normalized.length < DIVISION_CAST_APPLICATION_MIN_CHARS ||
    normalized.length > DIVISION_CAST_APPLICATION_MAX_CHARS
  ) {
    throw new Error(`Facet ${id} has an invalid cast application.`)
  }
  return normalized
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

    const castApplication = cleanCastApplication(record.castApplication, Number(id))
    return {
      id: Number(id),
      title: cleanFacetString(record.title, 'a title', Number(id)),
      focus: cleanFacetString(record.focus, 'a focus', Number(id)),
      question: cleanFacetString(record.question, 'a question', Number(id)),
      keyword: cleanFacetString(record.keyword, 'a keyword', Number(id)),
      ...(castApplication ? { castApplication } : {}),
    }
  })

  if (new Set(facets.map((facet) => facet.id)).size !== FACET_COUNT) {
    throw new Error('The model must return each facet id from 1 through 64 exactly once.')
  }

  return facets
}

function directionalCue(
  dimension: (typeof PROBLEM_DIMENSIONS)[number],
  movement: (typeof PROBLEM_MOVEMENTS)[number],
  hexagram: (typeof HEXAGRAM_LENSES)[number],
): string {
  return `Through ${hexagram.name} (${hexagram.theme}), direct the ${dimension.name} × ${movement.name} facet toward this inquiry: ${movement.lead} ${dimension.focus}?`
}

/**
 * Reconstruct the exact facet-to-I-Ching pairing used by composeProblemParts.
 * Results are returned in stable facet-ID order for prompts and provenance.
 */
export function deriveDivisionCastAssignments(
  seed: DivisionAnalysis['seed'],
): DivisionCastAssignment[] {
  const shuffledFacetIds = deterministicShuffle(
    Array.from({ length: FACET_COUNT }, (_, index) => index + 1),
    divisionSeed(seed, 'facets'),
  )
  const shuffledHexagrams = deterministicShuffle(
    HEXAGRAM_LENSES,
    divisionSeed(seed, 'hexagrams'),
  )
  const byId = new Map<number, DivisionCastAssignment>()

  shuffledFacetIds.forEach((id, index) => {
    const originalSlot = id - 1
    const dimension = PROBLEM_DIMENSIONS[Math.floor(originalSlot / BOARD_SECTOR_COUNT)]
    const movement = PROBLEM_MOVEMENTS[originalSlot % BOARD_SECTOR_COUNT]
    const hexagram = shuffledHexagrams[index]
    if (!dimension || !movement || !hexagram) {
      throw new Error('The canonical Division cast could not be constructed.')
    }
    byId.set(id, {
      id,
      dimension: dimension.name,
      movement: movement.name,
      hexagram: hexagram.number,
      hexagramName: hexagram.name,
      theme: hexagram.theme,
      directionalCue: directionalCue(dimension, movement, hexagram),
    })
  })

  return Array.from({ length: FACET_COUNT }, (_, index) => {
    const assignment = byId.get(index + 1)
    if (!assignment) {
      throw new Error('The canonical Division cast is missing a facet assignment.')
    }
    return assignment
  })
}

export function composeProblemParts(
  facets: readonly ProblemFacet[],
  seed: DivisionAnalysis['seed'],
): ProblemPart[] {
  const validatedFacets = parseFacets(facets).sort((left, right) => left.id - right.id)
  const shuffledFacets = deterministicShuffle(validatedFacets, divisionSeed(seed, 'facets'))
  const assignments = new Map(
    deriveDivisionCastAssignments(seed).map((assignment) => [
      assignment.id,
      assignment,
    ]),
  )

  const paired = shuffledFacets.map((facet): ProblemPart => {
    const assignment = assignments.get(facet.id)
    if (!assignment) {
      throw new Error(`The canonical Division cast is missing facet ${facet.id}.`)
    }

    return {
      id: facet.id,
      title: facet.title,
      focus: facet.focus,
      hexagram: assignment.hexagram,
      hexagramName: assignment.hexagramName,
      theme: assignment.theme,
      dimension: assignment.dimension,
      movement: assignment.movement,
      prompt: facet.question,
      keyword: facet.keyword,
      ...(facet.castApplication
        ? { castApplication: facet.castApplication }
        : {}),
    }
  })

  return deterministicShuffle(paired, divisionSeed(seed, 'board'))
}
