import type { DivisionAnalysis, ProblemFacet, ProblemPart } from '../types'
import {
  BOARD_SECTOR_COUNT,
  deterministicShuffle,
  HEXAGRAM_LENSES,
  PROBLEM_DIMENSIONS,
  PROBLEM_MOVEMENTS,
} from './problem'
import {
  modelActivityAcceptHeader,
  readModelActivityPayload,
} from './model-activity'
import type { ModelActivityEvent } from './model-activity'
import { SessionRequiredError } from './session'
import { describeTransportFailure } from './transport'

const FACET_COUNT = 64

interface DivisionErrorPayload {
  code?: string
  error?: string
  message?: string
  prompt?: string
}

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

export function parseDivisionAnalysis(value: unknown): DivisionAnalysis {
  if (!value || typeof value !== 'object') {
    throw new Error('The division service returned an incomplete analysis.')
  }
  const payload = value as Record<string, unknown>
  const seed = payload.seed
  const validSeed =
    (typeof seed === 'string' && seed.trim().length > 0) ||
    (typeof seed === 'number' && Number.isFinite(seed))
  if (!validSeed) {
    throw new Error('The division service did not return a random seed.')
  }
  if (typeof payload.model !== 'string' || payload.model.trim().length === 0) {
    throw new Error('The division service did not identify its model.')
  }
  if (typeof payload.prompt !== 'string') {
    throw new Error('The division service did not return its canonical prompt.')
  }

  return {
    facets: parseFacets(payload.facets),
    seed,
    model: payload.model.trim(),
    prompt: payload.prompt,
  }
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

export async function requestProblemDivision(
  problem: string,
  signal?: AbortSignal,
  csrfToken?: string,
  onActivity?: (event: ModelActivityEvent) => void,
): Promise<DivisionAnalysis> {
  let response: Response
  let payload: Record<string, unknown> & DivisionErrorPayload
  try {
    response = await fetch('/api/divide', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: onActivity ? modelActivityAcceptHeader() : 'application/json',
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-WebChess-CSRF': csrfToken } : {}),
      },
      body: JSON.stringify({ problem }),
      signal,
    })
    payload = await readModelActivityPayload(response, onActivity) as
      Record<string, unknown> & DivisionErrorPayload
  } catch (error) {
    throw describeTransportFailure(error, 'division')
  }

  if (!response.ok) {
    const message =
      payload.error ?? payload.message ?? 'The model could not divide this problem. Please try again.'
    const sessionInvalid =
      response.status === 401 ||
      (response.status === 403 && payload.code === 'csrf')
    const failure = (
      sessionInvalid ? new SessionRequiredError(message) : new Error(message)
    ) as Error & { prompt?: string }
    failure.prompt = payload.prompt
    throw failure
  }

  return parseDivisionAnalysis(payload)
}
