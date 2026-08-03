import { z } from 'zod'

import type { CellCoord, PieceKind, ProblemPart, Side } from '../../types'
import type { ResearchRecord } from '../research'
import { CURRENT_LIFECYCLE_VERSIONS } from './versions'

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

export const portiaReviewSchema = z.strictObject({
  contractVersion: z.literal(CURRENT_LIFECYCLE_VERSIONS.portiaContract),
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
})

export type PortiaReview = z.infer<typeof portiaReviewSchema>

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
  return review.contractVersion === CURRENT_LIFECYCLE_VERSIONS.portiaContract
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

export interface GateResult {
  readonly algorithmVersion: typeof CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm
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

export interface WilburAction {
  readonly id: string
  readonly lifecycleRunId: string
  readonly charlotteActionIndex: number | null
  readonly actor: string
  readonly action: string
  readonly testedAssumption: string
  readonly expectedObservation: string
  readonly decisionThreshold: string
  readonly reviewHorizon: string
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
}
