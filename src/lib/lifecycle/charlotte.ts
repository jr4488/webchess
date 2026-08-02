import type {
  CharlotteResult,
  PortiaReview,
} from './contracts'
import { charlotteResultSchema } from './contracts'

export function validateCharlotteResult(
  value: unknown,
  portia: PortiaReview,
): CharlotteResult {
  const parsed = charlotteResultSchema.parse(value)
  const assessments = new Map(
    portia.assessments.map((assessment) => [assessment.candidateId, assessment]),
  )
  const supportIds = new Set<string>()

  for (const candidateId of parsed.supportingCandidateIds) {
    if (supportIds.has(candidateId)) {
      throw new Error('Charlotte returned a duplicate supporting candidate ID.')
    }
    supportIds.add(candidateId)
    const assessment = assessments.get(candidateId)
    if (!assessment) {
      throw new Error('Charlotte cited a candidate outside the Portia review.')
    }
    if (
      assessment.disposition !== 'preserved' &&
      assessment.disposition !== 'wounded'
    ) {
      throw new Error('Charlotte may support claims only with preserved or wounded candidates.')
    }
    if (assessment.disposition === 'wounded') {
      const retained = parsed.qualificationsByCandidateId[candidateId]
      if (!retained || retained !== assessment.requiredQualification) {
        throw new Error(
          `Charlotte must retain the exact qualification for wounded candidate ${candidateId}.`,
        )
      }
    }
  }

  for (const candidateId of Object.keys(parsed.qualificationsByCandidateId)) {
    if (!supportIds.has(candidateId)) {
      throw new Error('Charlotte included a qualification for an unsupported candidate.')
    }
  }

  return parsed
}
