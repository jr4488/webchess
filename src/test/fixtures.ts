import { composeProblemParts } from '../lib/division'
import type { DivisionAnalysis, ProblemFacet, ProblemPart } from '../types'

export function makeProblemFacets(label = 'Facet'): ProblemFacet[] {
  return Array.from({ length: 64 }, (_, index) => ({
    id: index + 1,
    title: `${label} ${index + 1}`,
    focus: `Concrete focus ${index + 1}`,
    question: `What would clarify facet ${index + 1}?`,
    keyword: `keyword-${index + 1}`,
  }))
}

export function makeProblemParts(seed = 'test-problem'): ProblemPart[] {
  return composeProblemParts(makeProblemFacets(), `fixture/${seed}`)
}

export function makeDivisionAnalysis(seed = 'fresh-server-seed'): DivisionAnalysis {
  return {
    facets: makeProblemFacets('Sol facet'),
    seed,
    model: 'gpt-5.6-sol',
    prompt: 'Canonical semantic division prompt.',
  }
}
