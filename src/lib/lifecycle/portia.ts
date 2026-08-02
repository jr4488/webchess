import type {
  PortiaReview,
  SurvivorCandidate,
} from './contracts'
import {
  PORTIA_ATTACK_TYPES,
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

export function validatePortiaReview(
  value: unknown,
  survivors: readonly SurvivorCandidate[],
): PortiaReview {
  const parsed = portiaReviewSchema.parse(value)
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
  }

  const contradictionIds = new Set<string>()
  for (const contradiction of parsed.crossCandidateContradictions) {
    if (contradictionIds.has(contradiction.id)) {
      throw new Error('Portia returned duplicate contradiction identifiers.')
    }
    contradictionIds.add(contradiction.id)
    if (contradiction.candidateIds.some((candidateId) => !candidateIds.has(candidateId))) {
      throw new Error('A Portia contradiction contains an unknown candidate.')
    }
  }

  for (const assessment of parsed.assessments) {
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
    if (
      assessment.redundancyClusterId !== null &&
      !clusterIds.has(assessment.redundancyClusterId)
    ) {
      throw new Error('A Portia assessment references an unknown redundancy cluster.')
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

  return parsed
}
