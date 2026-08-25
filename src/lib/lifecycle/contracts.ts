import { z } from 'zod'

import type { CellCoord, PieceKind, ProblemPart, Side } from '../../types'
import type { ResearchRecord } from '../research'
import {
  CURRENT_LIFECYCLE_VERSIONS,
  LEGACY_GATE_ALGORITHM_VERSION,
  LEGACY_PROMPT_BOUND_PORTIA_CONTRACT_VERSION,
} from './versions'
import type { TrajectoryDirectionalRecord } from './trajectory-direction'

export const LIFECYCLE_STATES = [
  'anansi_pending',
  'anansi_running',
  'field_ready',
  'chess_ready',
  'chess_playing',
  'chess_terminal',
  'portia_pending',
  'portia_running',
  'portia_unavailable',
  'portia_complete',
  'gate_passed',
  'gate_failed',
  'retry_ready',
  'retry_running',
  'charlotte_pending',
  'charlotte_running',
  'charlotte_unavailable',
  'charlotte_complete',
  'wilbur_planning',
  'wilbur_in_progress',
  'wilbur_observed',
  'insufficient_basis',
  'abandoned',
] as const

export type LifecycleState = (typeof LIFECYCLE_STATES)[number]

export const PORTIA_DISPOSITIONS = [
  'preserved',
  'wounded',
  'consumed',
  'unresolved',
] as const

export type PortiaDisposition = (typeof PORTIA_DISPOSITIONS)[number]

export const PORTIA_ATTACK_TYPES = [
  'relevance_to_original_problem',
  'unsupported_assumption',
  'evidence_grounding',
  'redundancy',
  'contradiction',
  'causal_overreach',
  'stakeholder_or_opponent_response',
  'seed_or_path_sensitivity',
  'actionability',
  'reversibility',
  'harm_or_exclusion',
  'metaphor_overreach',
  'narrative_overfitting',
] as const

export type PortiaAttackType = (typeof PORTIA_ATTACK_TYPES)[number]

export const COVERAGE_TAGS = [
  'protected_outcome',
  'stakeholder',
  'evidence_or_reality',
  'risk_or_countercase',
  'agency_or_action',
  'value_constraint',
  'resource_constraint',
  'timing',
  'alternative',
  'tension',
] as const

export type CoverageTag = (typeof COVERAGE_TAGS)[number]

export const findingSeveritySchema = z.enum([
  'low',
  'moderate',
  'severe',
  'fatal',
])

export const attackOutcomeSchema = z.enum([
  'passed',
  'qualified',
  'failed',
  'unresolved',
  'not_applicable',
])

const boundedText = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum)

const nullableBoundedText = (minimum: number, maximum: number) =>
  boundedText(minimum, maximum).nullable()

export const attackFindingSchema = z
  .strictObject({
    attackType: z.enum(PORTIA_ATTACK_TYPES),
    outcome: attackOutcomeSchema,
    severity: findingSeveritySchema,
    finding: boundedText(8, 1_200),
    consequence: boundedText(8, 1_200),
    requiredRevision: nullableBoundedText(8, 1_200),
  })
  .superRefine((finding, context) => {
    if (
      finding.outcome === 'not_applicable' &&
      (finding.severity !== 'low' || finding.requiredRevision !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A not-applicable attack must be low severity and require no revision.',
        path: ['outcome'],
      })
    }
    if (
      (finding.severity === 'severe' || finding.severity === 'fatal') &&
      finding.consequence.length < 24
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Severe and fatal findings require a concrete consequence.',
        path: ['consequence'],
      })
    }
    if (
      (finding.outcome === 'passed' || finding.outcome === 'not_applicable') &&
      finding.requiredRevision !== null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A passed or not-applicable attack cannot require a revision.',
        path: ['requiredRevision'],
      })
    }
  })

export type AttackFinding = z.infer<typeof attackFindingSchema>

export const portiaCandidateAssessmentBaseSchema = z.strictObject({
  candidateId: boundedText(3, 220),
  disposition: z.enum(PORTIA_DISPOSITIONS),
  survivingInterpretation: nullableBoundedText(12, 1_500),
  requiredQualification: nullableBoundedText(8, 1_200),
  redundancyClusterId: nullableBoundedText(1, 120),
  coverageTags: z.array(z.enum(COVERAGE_TAGS)).max(COVERAGE_TAGS.length),
  missingEvidence: z.array(boundedText(3, 500)).max(12),
  countercase: boundedText(8, 1_200),
  reversalCondition: boundedText(8, 1_200),
  attackFindings: z.array(attackFindingSchema).min(1).max(PORTIA_ATTACK_TYPES.length),
  /** Required for v2.5 runs; absent only on preserved legacy reviews. */
  directionalRecordDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  directionalSignalKeys: z.array(boundedText(3, 160)).min(1).max(8).optional(),
  directionalInterpretation: boundedText(20, 1_500).optional(),
  directionalAmendment: boundedText(20, 1_500).optional(),
})

export const portiaCandidateAssessmentSchema =
  portiaCandidateAssessmentBaseSchema
  .superRefine((assessment, context) => {
    const outcomes = new Set(
      assessment.attackFindings.map((finding) => finding.outcome),
    )
    if (
      assessment.disposition === 'consumed' &&
      assessment.survivingInterpretation !== null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A consumed candidate cannot retain a supporting interpretation.',
        path: ['survivingInterpretation'],
      })
    }
    if (
      (assessment.disposition === 'preserved' ||
        assessment.disposition === 'wounded') &&
      assessment.survivingInterpretation === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A usable candidate requires a surviving interpretation.',
        path: ['survivingInterpretation'],
      })
    }
    if (
      assessment.disposition === 'wounded' &&
      assessment.requiredQualification === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A wounded candidate requires a qualification.',
        path: ['requiredQualification'],
      })
    }
    if (
      assessment.disposition === 'preserved' &&
      [...outcomes].some(
        (outcome) => outcome !== 'passed' && outcome !== 'not_applicable',
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A preserved candidate may contain only passed or not-applicable attacks.',
        path: ['attackFindings'],
      })
    }
    if (
      assessment.disposition === 'wounded' &&
      (
        !outcomes.has('qualified') ||
        outcomes.has('failed') ||
        outcomes.has('unresolved')
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A wounded candidate requires a qualified attack and cannot retain failed or unresolved attacks.',
        path: ['attackFindings'],
      })
    }
    if (
      assessment.disposition === 'unresolved' &&
      !outcomes.has('unresolved')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An unresolved candidate requires at least one unresolved attack.',
        path: ['attackFindings'],
      })
    }
    if (
      (assessment.disposition === 'preserved' ||
        assessment.disposition === 'wounded') &&
      assessment.attackFindings.some((finding) => finding.severity === 'fatal')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A candidate with a fatal finding cannot remain usable.',
        path: ['attackFindings'],
      })
    }
  })

export type PortiaCandidateAssessment = z.infer<
  typeof portiaCandidateAssessmentSchema
>

export const portiaContradictionSchema = z.strictObject({
  id: boundedText(1, 120),
  candidateIds: z.array(boundedText(3, 220)).min(2).max(8),
  severity: findingSeveritySchema,
  finding: boundedText(8, 1_200),
  consequence: boundedText(8, 1_200),
  addressed: z.boolean(),
})

export const portiaRedundancyClusterSchema = z.strictObject({
  id: boundedText(1, 120),
  candidateIds: z.array(boundedText(3, 220)).min(2).max(32),
  explanation: boundedText(8, 1_200),
})

export const currentPortiaReviewSchema = z.strictObject({
  contractVersion: z.literal(CURRENT_LIFECYCLE_VERSIONS.portiaContract),
  reviewedAnswerPromptDigest: z.string().regex(/^[0-9a-f]{64}$/),
  directionalRecordVersion: boundedText(3, 80).optional(),
  directionalRecordDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  directionalSummary: boundedText(20, 2_000).optional(),
  promptDecision: z.enum(['permit', 'retry_game', 'retry_field', 'deny']),
  promptDecisionRationale: boundedText(20, 2_000),
  runSummary: boundedText(20, 4_000),
  assessments: z.array(portiaCandidateAssessmentSchema).min(1).max(32),
  crossCandidateContradictions: z.array(portiaContradictionSchema).max(24),
  redundancyClusters: z.array(portiaRedundancyClusterSchema).max(32),
  missingCoverage: z.array(z.enum(COVERAGE_TAGS)).max(COVERAGE_TAGS.length),
  unresolvedQuestions: z.array(boundedText(5, 800)).max(24),
  recommendedGateInputs: z.strictObject({
    tensionCandidatePairs: z
      .array(z.array(boundedText(3, 220)).length(2))
      .max(16),
    fatalContradictionIds: z.array(boundedText(1, 120)).max(24),
    fieldRepairReasons: z.array(boundedText(5, 800)).max(24),
  }),
})

/**
 * Exact prompt-bound review-v2 shape used by lifecycle-v2.4. Directional
 * fields are deliberately not accepted at the review level, and the
 * refinement below prevents them from being smuggled into an assessment.
 */
export const legacyPromptBoundPortiaReviewSchema = z.strictObject({
  contractVersion: z.literal(LEGACY_PROMPT_BOUND_PORTIA_CONTRACT_VERSION),
  reviewedAnswerPromptDigest: z.string().regex(/^[0-9a-f]{64}$/),
  promptDecision: z.enum(['permit', 'retry_game', 'retry_field', 'deny']),
  promptDecisionRationale: boundedText(20, 2_000),
  runSummary: boundedText(20, 4_000),
  assessments: z.array(portiaCandidateAssessmentSchema).min(1).max(32),
  crossCandidateContradictions: z.array(portiaContradictionSchema).max(24),
  redundancyClusters: z.array(portiaRedundancyClusterSchema).max(32),
  missingCoverage: z.array(z.enum(COVERAGE_TAGS)).max(COVERAGE_TAGS.length),
  unresolvedQuestions: z.array(boundedText(5, 800)).max(24),
  recommendedGateInputs: z.strictObject({
    tensionCandidatePairs: z
      .array(z.array(boundedText(3, 220)).length(2))
      .max(16),
    fatalContradictionIds: z.array(boundedText(1, 120)).max(24),
    fieldRepairReasons: z.array(boundedText(5, 800)).max(24),
  }),
}).superRefine((review, context) => {
  review.assessments.forEach((assessment, index) => {
    if (
      assessment.directionalRecordDigest !== undefined ||
      assessment.directionalSignalKeys !== undefined ||
      assessment.directionalInterpretation !== undefined ||
      assessment.directionalAmendment !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A preserved review-v2 assessment cannot claim trajectory-directional provenance.',
        path: ['assessments', index],
      })
    }
  })
})

export const portiaReviewSchema = z.union([
  currentPortiaReviewSchema,
  legacyPromptBoundPortiaReviewSchema,
])

export type CurrentPortiaReview = z.infer<typeof currentPortiaReviewSchema>
export type LegacyPromptBoundPortiaReview = z.infer<
  typeof legacyPromptBoundPortiaReviewSchema
>
export type PortiaReview = z.infer<typeof portiaReviewSchema>

export type DirectionalPortiaCandidateAssessment =
  PortiaCandidateAssessment & {
    readonly directionalRecordDigest: string
    readonly directionalSignalKeys: readonly string[]
    readonly directionalInterpretation: string
    readonly directionalAmendment: string
  }

export type DirectionalPortiaReview = CurrentPortiaReview & {
  readonly directionalRecordVersion: string
  readonly directionalRecordDigest: string
  readonly directionalSummary: string
  readonly assessments: readonly DirectionalPortiaCandidateAssessment[]
}

const legacyAttackFindingSchema = z.strictObject({
  attackType: z.enum(PORTIA_ATTACK_TYPES),
  severity: findingSeveritySchema,
  finding: boundedText(8, 1_200),
  consequence: boundedText(8, 1_200),
  requiredRevision: nullableBoundedText(8, 1_200),
})

const legacyPortiaCandidateAssessmentSchema = z.strictObject({
  candidateId: boundedText(3, 220),
  disposition: z.enum(PORTIA_DISPOSITIONS),
  survivingInterpretation: nullableBoundedText(12, 1_500),
  requiredQualification: nullableBoundedText(8, 1_200),
  redundancyClusterId: nullableBoundedText(1, 120),
  coverageTags: z.array(z.enum(COVERAGE_TAGS)).max(COVERAGE_TAGS.length),
  missingEvidence: z.array(boundedText(3, 500)).max(12),
  countercase: boundedText(8, 1_200),
  reversalCondition: boundedText(8, 1_200),
  attackFindings: z.array(legacyAttackFindingSchema).min(1).max(PORTIA_ATTACK_TYPES.length),
})

/** Read-only compatibility contract for immutable reviews created before prompt binding. */
export const legacyPortiaReviewSchema = z.strictObject({
  contractVersion: z.literal('webchess-portia-review-v1'),
  runSummary: boundedText(20, 4_000),
  assessments: z.array(legacyPortiaCandidateAssessmentSchema).min(1).max(32),
  crossCandidateContradictions: z.array(portiaContradictionSchema).max(24),
  redundancyClusters: z.array(portiaRedundancyClusterSchema).max(32),
  missingCoverage: z.array(z.enum(COVERAGE_TAGS)).max(COVERAGE_TAGS.length),
  unresolvedQuestions: z.array(boundedText(5, 800)).max(24),
  recommendedGateInputs: z.strictObject({
    tensionCandidatePairs: z
      .array(z.array(boundedText(3, 220)).length(2))
      .max(16),
    fatalContradictionIds: z.array(boundedText(1, 120)).max(24),
    fieldRepairReasons: z.array(boundedText(5, 800)).max(24),
  }),
})

export type LegacyPortiaReview = z.infer<typeof legacyPortiaReviewSchema>
export type PersistedPortiaReview = PortiaReview | LegacyPortiaReview

export function isPromptBoundPortiaReview(
  review: PersistedPortiaReview,
): review is PortiaReview {
  return review.contractVersion === CURRENT_LIFECYCLE_VERSIONS.portiaContract ||
    review.contractVersion === LEGACY_PROMPT_BOUND_PORTIA_CONTRACT_VERSION
}

export function isDirectionalPortiaReview(
  review: PersistedPortiaReview,
): review is DirectionalPortiaReview {
  return review.contractVersion === CURRENT_LIFECYCLE_VERSIONS.portiaContract &&
    typeof review.directionalRecordVersion === 'string' &&
    typeof review.directionalRecordDigest === 'string' &&
    typeof review.directionalSummary === 'string' &&
    review.assessments.every((assessment) =>
      typeof assessment.directionalRecordDigest === 'string' &&
      Array.isArray(assessment.directionalSignalKeys) &&
      typeof assessment.directionalInterpretation === 'string' &&
      typeof assessment.directionalAmendment === 'string')
}

export interface SurvivorRouteStep {
  readonly ply: number
  readonly from: CellCoord
  readonly to: CellCoord
  readonly capturedPieceId: string | null
  readonly promotedTo: 'queen' | null
}

export interface SurvivorCandidate {
  readonly candidateId: string
  readonly pieceId: string
  readonly side: Side
  readonly pieceKind: PieceKind
  readonly originalPieceKind: PieceKind
  readonly pieceRole: string
  readonly sidePolarity: string
  readonly finalCoordinate: CellCoord
  readonly facet: ProblemPart
  readonly route: readonly SurvivorRouteStep[]
  readonly capturesMade: readonly string[]
  readonly attackedPlies: readonly number[]
  readonly moveCount: number
  readonly promoted: boolean
  readonly terminalGameId: string
  readonly attemptId: string
  readonly sourceDigest: string
}

export const GATE_RECOMMENDATIONS = [
  'answer',
  'retry_game',
  'retry_field',
  'insufficient_basis',
] as const

export type GateRecommendation = (typeof GATE_RECOMMENDATIONS)[number]

export interface GateCoverageResult {
  readonly tag: CoverageTag
  readonly satisfied: boolean
  readonly candidateIds: readonly string[]
}

interface GateResultBase {
  readonly passed: boolean
  readonly usableCandidateCount: number
  readonly preservedCount: number
  readonly woundedCount: number
  readonly consumedCount: number
  readonly unresolvedCount: number
  readonly independentClusterCount: number
  readonly coverageResults: readonly GateCoverageResult[]
  readonly severeUnresolvedObjectionCount: number
  readonly contradictionResults: {
    readonly fatalUnaddressedIds: readonly string[]
    readonly tensionCandidatePairs: readonly (readonly [string, string])[]
  }
  readonly missingRequirements: readonly string[]
  readonly recommendedNextTransition: GateRecommendation
  readonly explanation: string
  readonly inputDigest: string
}

export interface DirectionalGateResult extends GateResultBase {
  readonly algorithmVersion: typeof CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm
  readonly directionalRecordVersion: string
  readonly directionalRecordDigest: string
  readonly survivingDirectionKeys: readonly string[]
  readonly directionalBindingsSatisfied: boolean
}

/** Read-only compatibility type for immutable lifecycle-v2.4 Gate rows. */
export interface LegacyGateResult extends GateResultBase {
  readonly algorithmVersion: typeof LEGACY_GATE_ALGORITHM_VERSION
}

export type GateResult = DirectionalGateResult | LegacyGateResult

export function isDirectionalGateResult(
  result: GateResult,
): result is DirectionalGateResult {
  return result.algorithmVersion === CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm &&
    'directionalBindingsSatisfied' in result
}

export const RETRY_MODES = [
  'replay_game',
  'regenerate_field',
  'insufficient_basis',
] as const

export type RetryMode = (typeof RETRY_MODES)[number]

export interface RetryDecision {
  readonly policyVersion: typeof CURRENT_LIFECYCLE_VERSIONS.retryPolicy
  readonly mode: RetryMode
  readonly reason: string
  readonly sameFieldRetryCount: number
  readonly fieldRegenerationCount: number
  readonly remainingSameFieldRetries: number
  readonly remainingFieldRegenerations: number
}

export const charlotteActionSchema = z.strictObject({
  title: boundedText(3, 160),
  actor: boundedText(2, 240),
  assumptionBeingTested: boundedText(8, 800),
  smallestAction: boundedText(8, 1_000),
  expectedObservation: boundedText(8, 800),
  decisionThreshold: boundedText(8, 800),
  reviewHorizon: boundedText(2, 240),
  reversibility: boundedText(8, 800),
  risksOrAffectedParties: boundedText(8, 800),
  decisionRule: z.enum(['stop', 'continue', 'revise']),
})

export const charlotteResultSchema = z.strictObject({
  contractVersion: z.literal(CURRENT_LIFECYCLE_VERSIONS.charlotteContract),
  protectedOutcome: boundedText(12, 1_200),
  directAnswer: boundedText(80, 3_000),
  supportingCandidateIds: z.array(boundedText(3, 220)).min(1).max(32),
  qualificationsByCandidateId: z.record(
    boundedText(3, 220),
    boundedText(8, 1_200),
  ),
  centralTension: boundedText(24, 1_500),
  valueConstraints: z.array(boundedText(5, 800)).min(1).max(12),
  stakeholderConsequences: z.array(boundedText(5, 1_000)).min(1).max(16),
  recommendation: boundedText(80, 3_000),
  communicationStrategy: boundedText(24, 1_500),
  uncertainties: z.array(boundedText(5, 800)).min(1).max(16),
  whatCouldChangeTheAnswer: z.array(boundedText(5, 800)).min(1).max(16),
  exactlyThreeNextActions: z.array(charlotteActionSchema).length(3),
})

export type CharlotteResult = z.infer<typeof charlotteResultSchema>

export const WILBUR_ACTION_STATUSES = [
  'planned',
  'in_progress',
  'completed',
  'abandoned',
  'inconclusive',
] as const

export type WilburActionStatus = (typeof WILBUR_ACTION_STATUSES)[number]

export const ASSUMPTION_RESULTS = [
  'supported',
  'rejected',
  'unresolved',
] as const

export type AssumptionResult = (typeof ASSUMPTION_RESULTS)[number]

export const CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION =
  'webchess-charlotte-action-binding-v1' as const

export const CURRENT_WEB_MEMORY_CONSENT_VERSION =
  'webchess-web-memory-consent-v1' as const

export interface WilburAction {
  readonly id: string
  readonly lifecycleRunId: string
  readonly charlotteActionIndex: number | null
  /** NULL identifies an upgrade-preserved action created before canonical binding. */
  readonly charlotteBindingVersion:
    | typeof CURRENT_WILBUR_CHARLOTTE_BINDING_VERSION
    | null
  readonly actor: string
  readonly action: string
  readonly testedAssumption: string
  readonly expectedObservation: string
  readonly decisionThreshold: string
  readonly reviewHorizon: string
  /** Player-chosen calendar time for the next visible follow-up reminder. */
  readonly followUpAt: string | null
  readonly status: WilburActionStatus
  readonly revision: number
  readonly version: typeof CURRENT_LIFECYCLE_VERSIONS.wilburRecord
  readonly createdAt: string
  readonly updatedAt: string
}

export interface WilburObservation {
  readonly id: string
  readonly actionId: string
  readonly observedAt: string
  readonly observation: string
  readonly evidenceClassification: string
  readonly expectedEffect: string
  readonly unexpectedEffect: string
  readonly stakeholderResponse: string
  readonly assumptionResult: AssumptionResult
  readonly nextDecision: string
  readonly version: typeof CURRENT_LIFECYCLE_VERSIONS.wilburRecord
  readonly createdAt: string
}

/**
 * A player-authored Wilbur observation that was explicitly selected for reuse.
 * It remains untrusted historical context: it is not a verified fact, a causal
 * result, or permission to repeat the prior action.
 */
export interface WebMemoryEvidence {
  readonly observationId: string
  readonly sourceGameId: string
  readonly sourceActionId: string
  readonly sourceProblem: string
  readonly action: string
  readonly testedAssumption: string
  readonly expectedObservation: string
  readonly observedAt: string
  readonly observation: string
  readonly evidenceClassification: string
  readonly expectedEffect: string
  readonly unexpectedEffect: string
  readonly stakeholderResponse: string
  readonly assumptionResult: AssumptionResult
  readonly nextDecision: string
  /** Stable player-selected order used by prompts, Retry, and export. */
  readonly selectionOrdinal: number
  readonly consentVersion: typeof CURRENT_WEB_MEMORY_CONSENT_VERSION
  /** Null only while validating a selection before its durable attachment. */
  readonly attachedAt: string | null
}

export interface WebMemoryActionRecord {
  readonly action: WilburAction
  readonly observations: readonly WilburObservation[]
}

export interface WebMemoryCase {
  readonly gameId: string
  readonly problem: string
  readonly isCurrent: boolean
  readonly createdAt: string
  readonly updatedAt: string
  readonly actions: readonly WebMemoryActionRecord[]
}

export interface WebMemoryIndex {
  readonly cases: readonly WebMemoryCase[]
  /** Observations already bound to the owner's current game, if one exists. */
  readonly carriedObservationIds: readonly string[]
}

export interface LifecycleVersions {
  readonly software: string
  readonly lifecycle: string
  readonly portiaPrompt: string
  readonly portiaContract: string
  readonly gateAlgorithm: string
  readonly retryPolicy: string
  readonly charlottePrompt: string
  readonly charlotteContract: string
  readonly wilburRecord: string
  /** Null only for preserved runs created before trajectory-direction v1. */
  readonly trajectoryDirectionalRecord: string | null
  readonly rules: string
  readonly engine: string
  readonly cast: string
  readonly event: number
}

export interface LifecycleRun {
  readonly id: string
  readonly rootRunId: string
  readonly parentRunId: string | null
  readonly gameId: string
  readonly state: LifecycleState
  readonly revision: number
  readonly fieldGeneration: number
  readonly gameAttempt: number
  readonly sameFieldRetryCount: number
  readonly fieldRegenerationCount: number
  readonly divisionSeed: string
  readonly castSeed: string
  readonly trajectorySeed: string
  readonly retryReason: string | null
  readonly terminalFingerprint: string | null
  /**
   * Complete replay-verifiable trajectory-derived directional input. New v2.5
   * runs bind this atomically when chess becomes terminal; older runs remain
   * null and are labelled rather than retroactively rewritten.
   */
  readonly trajectoryDirectionalRecord: TrajectoryDirectionalRecord | null
  readonly trajectoryDirectionalRecordStatus:
    | 'not_terminal'
    | 'bound'
    | 'legacy_pre_directional_generation'
  /** Digest of the exact board-derived candidate prompt Portia reviewed. */
  readonly answerPromptDigest: string | null
  /**
   * Exact player-visible input authorized by Portia and the Gate for Answer.
   * Provider/system instructions and credentials are intentionally excluded.
   */
  readonly answerUserPrompt: string | null
  /** SHA-256 of the exact UTF-8 bytes in answerUserPrompt. */
  readonly answerUserPromptSha256: string | null
  readonly survivors: readonly SurvivorCandidate[]
  /** Exact provider request allowed to advance this resumable Portia review. */
  readonly portiaActiveModelRequestId: string | null
  /** Provider-started Portia attempts that settled without a usable review. */
  readonly portiaFailedAttemptCount: number
  /** Persisted operational ceiling for this run (currently three). */
  readonly portiaFailureLimit: number
  readonly portiaProgress: {
    readonly currentCandidateId: string | null
    readonly completedCandidateIds: readonly string[]
    readonly completedAssessments: readonly PortiaCandidateAssessment[]
  }
  readonly portia: PersistedPortiaReview | null
  readonly gate: GateResult | null
  /** Exact provider request allowed to advance this Charlotte qualification. */
  readonly charlotteActiveModelRequestId: string | null
  /** Provider-started Charlotte attempts that settled without a usable result. */
  readonly charlotteFailedAttemptCount: number
  /** Persisted operational ceiling for this run (currently three). */
  readonly charlotteFailureLimit: number
  readonly charlotte: CharlotteResult | null
  readonly charlotteRenderedAnswer: string | null
  readonly wilburActions: readonly WilburAction[]
  readonly wilburObservations: readonly WilburObservation[]
  readonly versions: LifecycleVersions
  readonly createdAt: string
  readonly updatedAt: string
}

export interface LifecycleActivity {
  readonly id: string
  readonly sequence: number
  readonly stage: string
  readonly activityType: string
  readonly stateFrom: LifecycleState | null
  readonly stateTo: LifecycleState
  readonly inputEntityIds: readonly string[]
  readonly outputEntityIds: readonly string[]
  readonly responsibleAgentIds: readonly string[]
  readonly configurationDigest: string
  readonly status: 'started' | 'completed' | 'failed' | 'refused'
  readonly eventVersion: number
  readonly createdAt: string
}

export interface LifecycleAggregate extends LifecycleRun {
  readonly activities: readonly LifecycleActivity[]
  /** Player-visible research embedded within one of the seven lifecycle stages. */
  readonly research: readonly ResearchRecord[]
  /** Explicitly consented prior Wilbur observations bound to this game. */
  readonly webMemoryEvidence: readonly WebMemoryEvidence[]
}
