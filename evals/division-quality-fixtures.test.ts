import { describe, expect, it } from 'vitest'

import { assessDivisionQuality } from '../src/server/openai/division-quality'
import { DIVISION_QUALITY_FIXTURES } from './division-quality-fixtures'

describe('documented division-quality fixtures', () => {
  for (const fixture of DIVISION_QUALITY_FIXTURES) {
    it(`${fixture.name}: ${fixture.description}`, () => {
      const assessment = assessDivisionQuality(fixture.facets, {
        problem: fixture.problem,
      })
      const issueCodes = assessment.issues.map((issue) => issue.code)

      expect(assessment.ok).toBe(fixture.expectedOk)
      expect(issueCodes).toEqual(
        expect.arrayContaining(fixture.expectedIssueCodes),
      )
      if (fixture.expectedOk) {
        expect(assessment.issues).toEqual([])
      }
    })
  }
})
