import type {
  CharlotteResult,
  GateResult,
  LifecycleActivity,
  LifecycleAggregate,
  LifecycleState,
  PortiaCandidateAssessment,
  PortiaReview,
  SurvivorCandidate,
  WilburAction,
  WilburActionStatus,
  WilburObservation,
} from '../../lib/lifecycle'
import type { AssumptionResult } from '../../lib/lifecycle/contracts'
import type { DurableGameSnapshot } from '../games'

export interface EnsureLifecycleInput {
  readonly ownerId: string
  readonly game: DurableGameSnapshot
  readonly trajectorySeed: string
}

export interface TransitionLifecycleInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly to: LifecycleState
  readonly stage: string
  readonly activityType: string
  readonly status?: LifecycleActivity['status']
  readonly inputEntityIds?: readonly string[]
  readonly outputEntityIds?: readonly string[]
  readonly responsibleAgentIds?: readonly string[]
  readonly configurationDigest: string
  readonly terminalFingerprint?: string
  readonly survivors?: readonly SurvivorCandidate[]
}

export interface StorePortiaInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly modelRequestId: string
  readonly inputDigest: string
  readonly outputDigest: string
  readonly review: PortiaReview
  readonly configurationDigest: string
}

export interface UpdatePortiaProgressInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly modelRequestId: string
  readonly answerPromptDigest: string
  readonly currentCandidateId: string | null
  readonly completedCandidateIds: readonly string[]
  readonly completedAssessments: readonly PortiaCandidateAssessment[]
}

export interface BeginPortiaAttemptInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly modelRequestId: string
  readonly requestDigest: string
  readonly answerPromptDigest: string
  readonly configurationDigest: string
  readonly activityType: 'adversarial_review_started' | 'adversarial_review_recovered'
}

export interface FailPortiaAttemptInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly modelRequestId: string
  readonly requestDigest: string
  readonly configurationDigest: string
  readonly activityType:
    | 'adversarial_review_failed'
    | 'adversarial_review_recovered_for_retry'
}

export interface StoreGateInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly result: GateResult
  /** Exact player-visible Answer input; required only when the Gate passes. */
  readonly answerUserPrompt: string | null
  readonly configurationDigest: string
}

export interface StoreCharlotteInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly modelRequestId: string
  readonly inputDigest: string
  readonly outputDigest: string
  readonly result: CharlotteResult
  readonly renderedAnswer: string
  readonly configurationDigest: string
}

export interface BeginCharlotteAttemptInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly modelRequestId: string
  readonly requestDigest: string
  readonly configurationDigest: string
  readonly activityType: 'qualification_started' | 'qualification_recovered'
}

export interface FailCharlotteAttemptInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly modelRequestId: string
  readonly requestDigest: string
  readonly configurationDigest: string
  readonly activityType:
    | 'qualification_failed'
    | 'qualification_recovered_for_retry'
}

export interface CreateRetryRunInput {
  readonly ownerId: string
  readonly parentGameId: string
  readonly childGame: DurableGameSnapshot
  readonly trajectorySeed: string
  readonly mode: 'replay_game' | 'regenerate_field'
  readonly reason: string
  readonly configurationDigest: string
}

export interface CreateWilburActionInput {
  readonly ownerId: string
  readonly gameId: string
  readonly id: string
  readonly idempotencyKey: string
  readonly requestDigest: string
  readonly charlotteActionIndex: number
  readonly actor: string
  readonly action: string
  readonly testedAssumption: string
  readonly expectedObservation: string
  readonly decisionThreshold: string
  readonly reviewHorizon: string
  readonly configurationDigest: string
}

export type WilburMutationOperation =
  | 'create_action'
  | 'update_action'
  | 'append_observation'

export interface ClaimWilburMutationInput {
  readonly ownerId: string
  readonly gameId: string
  readonly actionId: string | null
  readonly idempotencyKey: string
  readonly operation: WilburMutationOperation
  readonly requestDigest: string
  readonly rateKind: 'action' | 'observation'
  /** Rows the admitted mutation will add after its request-ledger row exists. */
  readonly reservedFutureRows: 1 | 2
  readonly reservedTextBytes: number
  readonly storageRowLimit: number
  readonly storageTextBytesLimit: number
}

export type ClaimWilburMutationResult =
  | { readonly kind: 'pending' }
  | { readonly kind: 'committed'; readonly action: WilburAction }
  | { readonly kind: 'committed'; readonly observation: WilburObservation }

export interface SettleWilburMutationConflictInput {
  readonly ownerId: string
  readonly gameId: string
  readonly actionId: string | null
  readonly idempotencyKey: string
  readonly operation: WilburMutationOperation
  readonly requestDigest: string
  readonly rateKind: 'action' | 'observation'
  readonly reservedFutureRows: 1 | 2
  readonly reservedTextBytes: number
}

export interface UpdateWilburActionInput {
  readonly ownerId: string
  readonly gameId: string
  readonly actionId: string
  readonly idempotencyKey: string
  readonly requestDigest: string
  readonly expectedRevision: number
  readonly status: WilburActionStatus
  readonly configurationDigest: string
}

export interface AppendWilburObservationInput {
  readonly ownerId: string
  readonly gameId: string
  readonly actionId: string
  readonly id: string
  readonly idempotencyKey: string
  readonly requestDigest: string
  readonly observedAt: string
  readonly observation: string
  readonly evidenceClassification: string
  readonly expectedEffect: string
  readonly unexpectedEffect: string
  readonly stakeholderResponse: string
  readonly assumptionResult: AssumptionResult
  readonly nextDecision: string
  readonly configurationDigest: string
}

export interface LifecycleRepositoryPort {
  ensureForGame(input: EnsureLifecycleInput): Promise<LifecycleAggregate>
  getForGame(ownerId: string, gameId: string): Promise<LifecycleAggregate | null>
  transition(input: TransitionLifecycleInput): Promise<LifecycleAggregate>
  beginPortiaAttempt(input: BeginPortiaAttemptInput): Promise<LifecycleAggregate>
  updatePortiaProgress(input: UpdatePortiaProgressInput): Promise<LifecycleAggregate>
  failPortiaAttempt(input: FailPortiaAttemptInput): Promise<LifecycleAggregate>
  storePortia(input: StorePortiaInput): Promise<LifecycleAggregate>
  storeGate(input: StoreGateInput): Promise<LifecycleAggregate>
  beginCharlotteAttempt(input: BeginCharlotteAttemptInput): Promise<LifecycleAggregate>
  failCharlotteAttempt(input: FailCharlotteAttemptInput): Promise<LifecycleAggregate>
  storeCharlotte(input: StoreCharlotteInput): Promise<LifecycleAggregate>
  createRetryRun(input: CreateRetryRunInput): Promise<LifecycleAggregate>
  hasPriorTerminalFingerprint(
    ownerId: string,
    rootRunId: string,
    fingerprint: string,
    excludingRunId: string,
  ): Promise<boolean>
  claimWilburMutation(
    input: ClaimWilburMutationInput,
  ): Promise<ClaimWilburMutationResult>
  settleWilburMutationConflict(
    input: SettleWilburMutationConflictInput,
  ): Promise<void>
  createWilburAction(input: CreateWilburActionInput): Promise<WilburAction>
  updateWilburAction(input: UpdateWilburActionInput): Promise<WilburAction>
  appendWilburObservation(
    input: AppendWilburObservationInput,
  ): Promise<WilburObservation>
}
