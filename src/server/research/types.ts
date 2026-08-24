import type {
  ResearchConsent,
  ResearchFetchFailure,
  ResearchMateriality,
  ResearchRecord,
  ResearchRetrievedFact,
  ResearchSource,
  ResearchStage,
} from '../../lib/research'

export interface ResearchPolicyDecision {
  readonly needed: boolean
  readonly reason: string
  readonly materiality: ResearchMateriality | null
  readonly query: string | null
}

export interface ResearchRequestContext {
  readonly ownerId: string
  readonly gameId: string
  readonly lifecycleRunId: string
  readonly lifecycleState: string
  readonly stage: ResearchStage
  readonly problem: string
  readonly researchConsent: ResearchConsent
}

export interface ResearchBrokerPort {
  ensureForStage(input: ResearchRequestContext): Promise<ResearchRecord>
  getForGame(ownerId: string, gameId: string): Promise<readonly ResearchRecord[]>
}

export interface StartResearchInput extends ResearchRequestContext {
  readonly policyVersion: string
  readonly materiality: ResearchMateriality
  readonly reason: string
  readonly query: string
  readonly timeoutMs: number
  readonly configurationDigest: string
}

export interface StartResearchResult {
  /** True only for the caller that durably inserted and therefore owns execution. */
  readonly created: boolean
  readonly record: ResearchRecord
}

export interface RecordNoResearchInput extends ResearchRequestContext {
  readonly policyVersion: string
  readonly reason: string
  readonly configurationDigest: string
}

export interface CompleteResearchInput {
  readonly ownerId: string
  readonly requestId: string
  readonly lifecycleState: string
  readonly model: string
  readonly executedQueries: readonly string[]
  readonly searchSynthesis: string
  readonly directPageTextFetched: boolean
  readonly retrievedFacts: readonly ResearchRetrievedFact[]
  readonly fetchFailures: readonly ResearchFetchFailure[]
  readonly sources: readonly Omit<ResearchSource, 'id' | 'createdAt'>[]
  readonly omittedSourceCount: number
  readonly injectionSignalsDetected: readonly string[]
  readonly contentDigest: string
  readonly configurationDigest: string
}

export interface FailResearchInput {
  readonly ownerId: string
  readonly requestId: string
  readonly lifecycleState: string
  readonly status: 'failed' | 'timed_out' | 'refused'
  readonly failureCode: string
  readonly configurationDigest: string
}

export interface ResearchRepositoryPort {
  getForGame(ownerId: string, gameId: string): Promise<readonly ResearchRecord[]>
  recordNotNeeded(input: RecordNoResearchInput): Promise<ResearchRecord>
  start(input: StartResearchInput): Promise<StartResearchResult>
  complete(input: CompleteResearchInput): Promise<ResearchRecord>
  fail(input: FailResearchInput): Promise<ResearchRecord>
}
