import type {
  PortiaCandidateAssessment,
  PortiaReview,
  SurvivorCandidate,
} from './contracts'
import {
  PORTIA_ATTACK_TYPES,
  portiaCandidateAssessmentSchema,
  portiaReviewSchema,
} from './contracts'

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

export function validatePortiaCandidateAssessment(
  value: unknown,
  survivor: SurvivorCandidate,
): PortiaCandidateAssessment {
  const assessment = portiaCandidateAssessmentSchema.parse(value)
  if (assessment.candidateId !== survivor.candidateId) {
    throw new Error('Portia assessed a different candidate than requested.')
  }
  const actualAttackTypes = assessment.attackFindings
    .map((finding) => finding.attackType)
    .sort()
  const expectedAttackTypes = [...PORTIA_ATTACK_TYPES].sort()
  if (
    duplicateValues(actualAttackTypes).length > 0 ||
    actualAttackTypes.length !== expectedAttackTypes.length ||
    actualAttackTypes.some(
      (attackType, index) => attackType !== expectedAttackTypes[index],
    )
  ) {
    throw new Error(
      `Portia must assess every attack type exactly once for candidate ${assessment.candidateId}.`,
    )
  }
  if (duplicateValues(assessment.coverageTags).length > 0) {
    throw new Error('A Portia candidate repeats a coverage tag.')
  }
  if (duplicateValues(assessment.missingEvidence).length > 0) {
    throw new Error('A Portia candidate repeats a missing-evidence item.')
  }
  return assessment
}

export function validatePortiaReview(
  value: unknown,
  survivors: readonly SurvivorCandidate[],
  reviewedAnswerPromptDigest?: string,
): PortiaReview {
  const parsed = portiaReviewSchema.parse(value)
  if (
    reviewedAnswerPromptDigest !== undefined &&
    parsed.reviewedAnswerPromptDigest !== reviewedAnswerPromptDigest
  ) {
    throw new Error('Portia reviewed a different answer prompt than requested.')
  }
  const expectedIds = survivors.map((candidate) => candidate.candidateId).sort()
  const actualIds = parsed.assessments.map((assessment) => assessment.candidateId).sort()

  if (duplicateValues(actualIds).length > 0) {
    throw new Error('Portia returned duplicate candidate assessments.')
  }
  if (
    actualIds.length !== expectedIds.length ||
    actualIds.some((candidateId, index) => candidateId !== expectedIds[index])
  ) {
    throw new Error('Portia must assess every and only every terminal survivor.')
  }

  const candidateIds = new Set(expectedIds)
  const clusterIds = new Set<string>()
  for (const cluster of parsed.redundancyClusters) {
    if (clusterIds.has(cluster.id)) {
      throw new Error('Portia returned duplicate redundancy cluster identifiers.')
    }
    clusterIds.add(cluster.id)
    if (duplicateValues(cluster.candidateIds).length > 0) {
      throw new Error('A Portia redundancy cluster repeats a candidate.')
    }
    if (cluster.candidateIds.some((candidateId) => !candidateIds.has(candidateId))) {
      throw new Error('A Portia redundancy cluster contains an unknown candidate.')
    }
    for (const candidateId of cluster.candidateIds) {
      const assessment = parsed.assessments.find(
        (candidate) => candidate.candidateId === candidateId,
      )
      if (assessment?.redundancyClusterId !== cluster.id) {
        throw new Error('A Portia redundancy cluster is not reciprocal.')
      }
    }
  }

  const contradictionIds = new Set<string>()
  for (const contradiction of parsed.crossCandidateContradictions) {
    if (contradictionIds.has(contradiction.id)) {
      throw new Error('Portia returned duplicate contradiction identifiers.')
    }
    contradictionIds.add(contradiction.id)
    if (duplicateValues(contradiction.candidateIds).length > 0) {
      throw new Error('A Portia contradiction repeats a candidate.')
    }
    if (contradiction.candidateIds.some((candidateId) => !candidateIds.has(candidateId))) {
      throw new Error('A Portia contradiction contains an unknown candidate.')
    }
  }

  for (const assessment of parsed.assessments) {
    const survivor = survivors.find(
      (candidate) => candidate.candidateId === assessment.candidateId,
    )!
    validatePortiaCandidateAssessment(assessment, survivor)
    if (
      assessment.redundancyClusterId !== null &&
      !clusterIds.has(assessment.redundancyClusterId)
    ) {
      throw new Error('A Portia assessment references an unknown redundancy cluster.')
    }
    if (
      assessment.redundancyClusterId !== null &&
      !parsed.redundancyClusters.find(
        (cluster) =>
          cluster.id === assessment.redundancyClusterId &&
          cluster.candidateIds.includes(assessment.candidateId),
      )
    ) {
      throw new Error('A Portia assessment is absent from its redundancy cluster.')
    }
  }

  for (const pair of parsed.recommendedGateInputs.tensionCandidatePairs) {
    if (!candidateIds.has(pair[0]) || !candidateIds.has(pair[1]) || pair[0] === pair[1]) {
      throw new Error('A Portia tension pair must contain two known, distinct candidates.')
    }
  }
  if (
    parsed.recommendedGateInputs.fatalContradictionIds.some(
      (id) => !contradictionIds.has(id),
    )
  ) {
    throw new Error('Portia recommended an unknown fatal contradiction to the Gate.')
  }
  if (duplicateValues(parsed.missingCoverage).length > 0) {
    throw new Error('Portia repeated a missing coverage tag.')
  }
  const usableCoverage = new Set(
    parsed.assessments.flatMap((assessment) =>
      assessment.disposition === 'preserved' ||
      assessment.disposition === 'wounded'
        ? assessment.coverageTags
        : []),
  )
  if (parsed.missingCoverage.some((tag) => usableCoverage.has(tag))) {
    throw new Error(
      'Portia cannot mark coverage missing when a usable candidate supplies it.',
    )
  }

  return parsed
}
