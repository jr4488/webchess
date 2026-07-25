// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { DIVISION_QUALITY_FIXTURES } from '../evals/division-quality-fixtures.mjs'
import {
  assessDivisionQuality,
  DIVISION_QUALITY_THRESHOLDS,
} from './division-quality.mjs'
import {
  DivisionResultError,
  normalizeDivisionFacets,
} from './division.mjs'

describe('division quality assessment', () => {
  it.each(DIVISION_QUALITY_FIXTURES)(
    '$name: $description',
    ({ expectedIssueCodes, expectedOk, facets, problem }) => {
      const assessment = assessDivisionQuality(facets, { problem })

      expect(assessment.ok).toBe(expectedOk)
      expect(assessment.issues.map((issue) => issue.code))
        .toEqual(expect.arrayContaining(expectedIssueCodes))
      if (expectedOk) {
        expect(assessment.issues).toEqual([])
      }
      expect(assessment.metrics.facetCount).toBe(64)
    },
  )

  it('reports deterministic, inspectable evidence for a numbered scaffold', () => {
    const fixture = DIVISION_QUALITY_FIXTURES.find(
      ({ name }) => name === 'generic numbered scaffold',
    )
    const first = assessDivisionQuality(fixture.facets, { problem: fixture.problem })
    const second = assessDivisionQuality(fixture.facets, { problem: fixture.problem })

    expect(second).toEqual(first)
    expect(first.metrics).toMatchObject({
      genericNumberedTitleCount: 64,
      genericNumberedTitleRatio: 1,
      idEchoCount: 64,
      idEchoRatio: 1,
      templateFields: {
        title: {
          dominantCount: 64,
          dominantRatio: 1,
          dominantSkeleton: 'facet {number}',
        },
      },
    })
    expect(first.issues.find(({ code }) => code === 'generic-numbered-facets'))
      .toMatchObject({
        evidence: {
          genericNumberedTitleRatio: 1,
          idEchoRatio: 1,
        },
      })
  })

  it('reports widespread high-overlap pairs without failing one local parallel', () => {
    const cosmetic = DIVISION_QUALITY_FIXTURES.find(
      ({ name }) => name === 'cosmetic paraphrase cluster',
    )
    const localized = DIVISION_QUALITY_FIXTURES.find(
      ({ name }) => name === 'localized parallel wording',
    )
    const cosmeticResult = assessDivisionQuality(cosmetic.facets)
    const localizedResult = assessDivisionQuality(localized.facets)

    expect(cosmeticResult.metrics.overlap).toMatchObject({
      similarityThreshold: DIVISION_QUALITY_THRESHOLDS.highOverlapSimilarity,
      facetsWithHighOverlapNeighbor: 64,
      highOverlapNeighborRatio: 1,
    })
    expect(cosmeticResult.metrics.overlap.highOverlapPairCount).toBeGreaterThanOrEqual(16)
    expect(cosmeticResult.metrics.overlap.examplePairs.length).toBeGreaterThan(0)
    expect(localizedResult.ok).toBe(true)
    expect(localizedResult.metrics.overlap.facetsWithHighOverlapNeighbor).toBeLessThan(32)
  })

  it('keeps lexical problem overlap informational rather than a rejection rule', () => {
    const fixture = DIVISION_QUALITY_FIXTURES[0]
    const assessment = assessDivisionQuality(fixture.facets, {
      problem: fixture.problem,
    })

    expect(assessment.ok).toBe(true)
    expect(assessment.metrics.problem.termCount).toBeGreaterThan(0)
    expect(assessment.metrics.problem.referencedTermCount).toBeGreaterThan(0)
    expect(assessment.metrics.problem.note).toMatch(/review only/)
  })

  it('fails closed with a clear issue for invalid evaluator input', () => {
    expect(assessDivisionQuality(null)).toEqual({
      ok: false,
      issues: [{
        code: 'invalid-quality-input',
        message: 'Division quality assessment requires an array of facets.',
      }],
      metrics: {
        facetCount: 0,
      },
    })
  })

  it('enforces the quality assessment in the live division normalization path', () => {
    const healthy = DIVISION_QUALITY_FIXTURES.find(
      ({ name }) => name === 'specific workshop map',
    )
    const numbered = DIVISION_QUALITY_FIXTURES.find(
      ({ name }) => name === 'generic numbered scaffold',
    )

    expect(normalizeDivisionFacets(
      { facets: healthy.facets },
      { problem: healthy.problem },
    )).toHaveLength(64)
    expect(() => normalizeDivisionFacets(
      { facets: numbered.facets },
      { problem: numbered.problem },
    )).toThrow(DivisionResultError)
  })
})
