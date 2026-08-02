import { createHash } from 'node:crypto'

import type {
  CoverageTag,
  GateRecommendation,
  GateResult,
  PortiaReview,
} from './contracts'
import { COVERAGE_TAGS } from './contracts'
import { CURRENT_LIFECYCLE_VERSIONS } from './versions'

export const GATE_THRESHOLDS = Object.freeze({
  minimumUsableCandidates: 4,
  minimumIndependentClusters: 3,
  requiredCoverage: [
    'protected_outcome',
    'evidence_or_reality',
    'risk_or_countercase',
    'agency_or_action',
  ] as const satisfies readonly CoverageTag[],
})

export interface GateRetryContext {
  readonly sameFieldRetryCount: number
  readonly fieldRegenerationCount: number
}

function stableDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function nextRecommendation(
  review: PortiaReview,
  context: GateRetryContext,
  duplicateHeavy: boolean,
): GateRecommendation {
  const fieldLooksBroken =
    duplicateHeavy ||
    review.missingCoverage.length >= 2 ||
    review.recommendedGateInputs.fieldRepairReasons.length > 0

  if (fieldLooksBroken || context.sameFieldRetryCount >= 2) {
    return context.fieldRegenerationCount < 1
      ? 'retry_field'
      : 'insufficient_basis'
  }
  return 'retry_game'
}

export function evaluateGate(
  review: PortiaReview,
  context: GateRetryContext = {
    sameFieldRetryCount: 0,
    fieldRegenerationCount: 0,
  },
): GateResult {
  if (
    !Number.isInteger(context.sameFieldRetryCount) ||
    context.sameFieldRetryCount < 0 ||
    !Number.isInteger(context.fieldRegenerationCount) ||
    context.fieldRegenerationCount < 0
  ) {
    throw new TypeError('Gate retry counters must be nonnegative integers.')
  }

  const assessments = review.assessments
  const usable = assessments.filter(
    (assessment) =>
      assessment.disposition === 'preserved' ||
      assessment.disposition === 'wounded',
  )
  const preservedCount = assessments.filter(
    (assessment) => assessment.disposition === 'preserved',
  ).length
  const woundedCount = assessments.filter(
    (assessment) => assessment.disposition === 'wounded',
  ).length
  const consumedCount = assessments.filter(
    (assessment) => assessment.disposition === 'consumed',
  ).length
  const unresolvedCount = assessments.filter(
    (assessment) => assessment.disposition === 'unresolved',
  ).length

  const clusterByCandidate = new Map(
    usable.map((assessment) => [
      assessment.candidateId,
      assessment.redundancyClusterId ?? `independent:${assessment.candidateId}`,
    ]),
  )
  const independentClusterCount = new Set(clusterByCandidate.values()).size
  const coverageResults = COVERAGE_TAGS.map((tag) => {
    const candidateIds = usable
      .filter((assessment) => assessment.coverageTags.includes(tag))
      .map((assessment) => assessment.candidateId)
    return { tag, satisfied: candidateIds.length > 0, candidateIds }
  })

  const fatalUnaddressedIds = review.crossCandidateContradictions
    .filter(
      (contradiction) =>
        contradiction.severity === 'fatal' && !contradiction.addressed,
    )
    .map((contradiction) => contradiction.id)
  const severeUnresolvedObjectionCount = assessments.reduce(
    (count, assessment) =>
      count + assessment.attackFindings.filter(
        (finding) =>
          (finding.severity === 'severe' || finding.severity === 'fatal') &&
          finding.requiredRevision === null,
      ).length,
    0,
  )
  const tensionCandidatePairs = review.recommendedGateInputs
    .tensionCandidatePairs
    .flatMap(([left, right]) => {
      const leftCluster = clusterByCandidate.get(left)
      const rightCluster = clusterByCandidate.get(right)
      return leftCluster !== undefined &&
        rightCluster !== undefined &&
        leftCluster !== rightCluster
        ? [[left, right] as const]
        : []
    })

  const missingRequirements: string[] = []
  if (usable.length < GATE_THRESHOLDS.minimumUsableCandidates) {
    missingRequirements.push(
      `At least ${GATE_THRESHOLDS.minimumUsableCandidates} preserved or wounded candidates are required.`,
    )
  }
  if (independentClusterCount < GATE_THRESHOLDS.minimumIndependentClusters) {
    missingRequirements.push(
      `At least ${GATE_THRESHOLDS.minimumIndependentClusters} independent candidate clusters are required.`,
    )
  }
  for (const required of GATE_THRESHOLDS.requiredCoverage) {
    if (!coverageResults.find((coverage) => coverage.tag === required)?.satisfied) {
      missingRequirements.push(`Required coverage is missing: ${required}.`)
    }
  }
  if (tensionCandidatePairs.length === 0) {
    missingRequirements.push(
      'At least one explicit tension between independent usable candidates is required.',
    )
  }
  if (fatalUnaddressedIds.length > 0) {
    missingRequirements.push('An unaddressed fatal contradiction remains.')
  }
  for (const wounded of usable.filter(
    (assessment) => assessment.disposition === 'wounded',
  )) {
    if (wounded.requiredQualification === null) {
      missingRequirements.push(
        `Wounded candidate ${wounded.candidateId} is missing its qualification.`,
      )
    }
  }

  const passed = missingRequirements.length === 0
  const duplicateHeavy = usable.length > 0 &&
    independentClusterCount / usable.length < 0.6
  const recommendedNextTransition = passed
    ? 'charlotte'
    : nextRecommendation(review, context, duplicateHeavy)
  const explanation = passed
    ? `The Gate passed with ${usable.length} usable candidates across ${independentClusterCount} independent clusters and all required coverage floors.`
    : `The Gate failed ${missingRequirements.length} sufficiency requirement${missingRequirements.length === 1 ? '' : 's'}; ${recommendedNextTransition === 'retry_game' ? 'another trajectory is recommended' : recommendedNextTransition === 'retry_field' ? 'the semantic field should be regenerated' : 'the bounded retry policy is exhausted'}.`

  return {
    algorithmVersion: CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm,
    passed,
    usableCandidateCount: usable.length,
    preservedCount,
    woundedCount,
    consumedCount,
    unresolvedCount,
    independentClusterCount,
    coverageResults,
    severeUnresolvedObjectionCount,
    contradictionResults: {
      fatalUnaddressedIds,
      tensionCandidatePairs,
    },
    missingRequirements,
    recommendedNextTransition,
    explanation,
    inputDigest: stableDigest({
      contractVersion: review.contractVersion,
      assessments,
      contradictions: review.crossCandidateContradictions,
      gateInputs: review.recommendedGateInputs,
      context,
      thresholds: GATE_THRESHOLDS,
    }),
  }
}
