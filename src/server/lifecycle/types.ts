import type {
  CharlotteResult,
  GateResult,
  LifecycleActivity,
  LifecycleAggregate,
  LifecycleState,
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

export interface StoreGateInput {
  readonly ownerId: string
  readonly gameId: string
  readonly expectedRevision: number
  readonly result: GateResult
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
  readonly charlotteActionIndex: number | null
  readonly actor: string
  readonly action: string
  readonly testedAssumption: string
  readonly expectedObservation: string
  readonly decisionThreshold: string
  readonly reviewHorizon: string
  readonly configurationDigest: string
}

export interface UpdateWilburActionInput {
  readonly ownerId: string
  readonly gameId: string
  readonly actionId: string
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
  storePortia(input: StorePortiaInput): Promise<LifecycleAggregate>
  storeGate(input: StoreGateInput): Promise<LifecycleAggregate>
  storeCharlotte(input: StoreCharlotteInput): Promise<LifecycleAggregate>
  createRetryRun(input: CreateRetryRunInput): Promise<LifecycleAggregate>
  hasPriorTerminalFingerprint(
    ownerId: string,
    rootRunId: string,
    fingerprint: string,
    excludingRunId: string,
  ): Promise<boolean>
  createWilburAction(input: CreateWilburActionInput): Promise<WilburAction>
  updateWilburAction(input: UpdateWilburActionInput): Promise<WilburAction>
  appendWilburObservation(
    input: AppendWilburObservationInput,
  ): Promise<WilburObservation>
}
