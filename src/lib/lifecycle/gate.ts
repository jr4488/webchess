import { createHash } from 'node:crypto'

import type {
  CoverageTag,
  GateRecommendation,
  GateResult,
  PortiaReview,
} from './contracts'
import { COVERAGE_TAGS } from './contracts'
import {
  CURRENT_LIFECYCLE_VERSIONS,
  LEGACY_GATE_ALGORITHM_VERSION,
} from './versions'
import type { TrajectoryDirectionalRecord } from './trajectory-direction'

export const GATE_THRESHOLDS = Object.freeze({
  minimumUsableCandidates: 3,
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

function promptRecommendation(
  review: PortiaReview,
  context: GateRetryContext,
  duplicateHeavy: boolean,
): GateRecommendation {
  if (review.promptDecision === 'deny') {
    return context.fieldRegenerationCount < 1
      ? 'retry_field'
      : 'insufficient_basis'
  }
  if (review.promptDecision === 'retry_field') {
    return context.fieldRegenerationCount < 1
      ? 'retry_field'
      : 'insufficient_basis'
  }
  if (review.promptDecision === 'retry_game') {
    if (context.sameFieldRetryCount < 2) return 'retry_game'
    return context.fieldRegenerationCount < 1
      ? 'retry_field'
      : 'insufficient_basis'
  }
  return nextRecommendation(review, context, duplicateHeavy)
}

export function evaluateGate(
  review: PortiaReview,
  context: GateRetryContext = {
    sameFieldRetryCount: 0,
    fieldRegenerationCount: 0,
  },
  directionalRecord?: TrajectoryDirectionalRecord,
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
  const severeOrFatalUnaddressedIds = review.crossCandidateContradictions
    .filter(
      (contradiction) =>
        (contradiction.severity === 'severe' ||
          contradiction.severity === 'fatal') &&
        !contradiction.addressed,
    )
    .map((contradiction) => contradiction.id)
  const severeUnresolvedObjectionCount = usable.reduce(
    (count, assessment) =>
      count + assessment.attackFindings.filter(
        (finding) =>
          (finding.severity === 'severe' || finding.severity === 'fatal') &&
          (finding.outcome === 'failed' || finding.outcome === 'unresolved'),
      ).length,
    0,
  )
  const usableRevisionCount = usable.reduce(
    (count, assessment) =>
      count + assessment.attackFindings.filter(
        (finding) => finding.requiredRevision !== null,
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
  let directionalBindingsSatisfied: boolean | undefined
  if (directionalRecord) {
    const allowedKeys = new Set(directionalRecord.survivingDirectionKeys)
    directionalBindingsSatisfied =
      review.contractVersion === CURRENT_LIFECYCLE_VERSIONS.portiaContract &&
      review.directionalRecordVersion === directionalRecord.version &&
      review.directionalRecordDigest === directionalRecord.digest &&
      typeof review.directionalSummary === 'string' &&
      review.directionalSummary.trim().length >= 20 &&
      review.assessments.every((assessment) => {
        const keys = assessment.directionalSignalKeys
        return assessment.directionalRecordDigest === directionalRecord.digest &&
          typeof assessment.directionalInterpretation === 'string' &&
          assessment.directionalInterpretation.trim().length >= 20 &&
          typeof assessment.directionalAmendment === 'string' &&
          assessment.directionalAmendment.trim().length >= 20 &&
          Array.isArray(keys) &&
          keys.length >= 1 &&
          keys.length <= 8 &&
          new Set(keys).size === keys.length &&
          keys.every((key) => allowedKeys.has(key))
      })
    if (!directionalBindingsSatisfied) {
      missingRequirements.push(
        'The trajectory-derived directional record is missing or incompletely bound into Portia scrutiny.',
      )
    }
  }
  if (review.promptDecision !== 'permit') {
    missingRequirements.push(
      `Portia did not permit the reviewed answer prompt: ${review.promptDecision}.`,
    )
  }
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
  if (severeOrFatalUnaddressedIds.length > 0) {
    missingRequirements.push(
      `${severeOrFatalUnaddressedIds.length} unaddressed severe or fatal contradiction${severeOrFatalUnaddressedIds.length === 1 ? ' remains' : 's remain'}.`,
    )
  }
  if (severeUnresolvedObjectionCount > 0) {
    missingRequirements.push(
      `${severeUnresolvedObjectionCount} severe or fatal Portia finding${severeUnresolvedObjectionCount === 1 ? '' : 's'} remain without a required revision.`,
    )
  }
  // A permit decision authorizes the answer stage to append Portia's exact
  // required revisions to the reviewed board prompt. They therefore become
  // trusted prompt amendments, not permanently "unapplied" defects. A retry
  // or deny decision never authorizes those amendments and remains blocked.
  if (usableRevisionCount > 0 && review.promptDecision !== 'permit') {
    missingRequirements.push(
      `${usableRevisionCount} Portia-required prompt revision${usableRevisionCount === 1 ? ' cannot' : 's cannot'} be applied without a permit decision.`,
    )
  }
  if (review.recommendedGateInputs.fieldRepairReasons.length > 0) {
    missingRequirements.push(
      'Portia identified field-level defects that require regeneration before an answer can be generated.',
    )
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
    ? 'answer'
    : promptRecommendation(review, context, duplicateHeavy)
  const explanation = passed
    ? `Portia's candidate prompt is permitted: ${usable.length} usable candidates remain across ${independentClusterCount} independent clusters and all required coverage floors${directionalRecord ? `; the exact trajectory-directional record ${directionalRecord.digest} is bound through scrutiny` : ''}.`
    : `The Gate failed ${missingRequirements.length} sufficiency requirement${missingRequirements.length === 1 ? '' : 's'}; ${recommendedNextTransition === 'retry_game' ? 'another trajectory is recommended' : recommendedNextTransition === 'retry_field' ? 'the semantic field should be regenerated' : 'the bounded retry policy is exhausted'}.`

  const reviewDirectionalBinding =
    review.contractVersion === CURRENT_LIFECYCLE_VERSIONS.portiaContract
      ? {
          version: review.directionalRecordVersion ?? null,
          digest: review.directionalRecordDigest ?? null,
          summary: review.directionalSummary ?? null,
        }
      : null

  const inputDigest = stableDigest({
    contractVersion: review.contractVersion,
    assessments,
    contradictions: review.crossCandidateContradictions,
    gateInputs: review.recommendedGateInputs,
    missingCoverage: review.missingCoverage,
    promptDecision: review.promptDecision,
    reviewedAnswerPromptDigest: review.reviewedAnswerPromptDigest,
    ...(directionalRecord
      ? {
          reviewDirectionalBinding,
          directionalRecord: {
            version: directionalRecord.version,
            digest: directionalRecord.digest,
            survivingDirectionKeys: directionalRecord.survivingDirectionKeys,
          },
        }
      : {}),
    context,
    thresholds: GATE_THRESHOLDS,
  })

  const result = {
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
    inputDigest,
  }
  if (directionalRecord) {
    return {
      ...result,
      algorithmVersion: CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm,
      directionalRecordVersion: directionalRecord.version,
      directionalRecordDigest: directionalRecord.digest,
      survivingDirectionKeys: directionalRecord.survivingDirectionKeys,
      directionalBindingsSatisfied: directionalBindingsSatisfied === true,
    }
  }
  return {
    ...result,
    algorithmVersion: LEGACY_GATE_ALGORITHM_VERSION,
  }
}
