export const RESEARCH_STAGES = [
  'anansi',
  'chess',
  'portia',
  'answer',
  'charlotte',
  'wilbur',
  'web',
] as const

export type ResearchStage = (typeof RESEARCH_STAGES)[number]

export const RESEARCH_STATUSES = [
  'searching',
  'completed',
  'not_needed',
  'failed',
  'timed_out',
  'refused',
] as const

export type ResearchStatus = (typeof RESEARCH_STATUSES)[number]

export type ResearchMateriality = 'helpful' | 'required'

export type ResearchSourceTrust =
  | 'government_or_education'
  | 'general_web'

export interface ResearchBounds {
  /** One durable broker invocation is the entire automatic retry budget. */
  readonly invocationLimit: 1
  readonly resultLimit: number
  readonly sourceLimit: number
  readonly timeoutMs: number
  readonly synthesisCharacterLimit: number
}

/**
 * A link discovered by Codex Search. It is a citation candidate, not proof
 * that WebChess directly fetched or independently verified the page text.
 */
export interface ResearchSource {
  readonly id: string
  readonly citationId: string
  readonly ordinal: number
  readonly title: string
  readonly url: string
  readonly hostname: string
  readonly trust: ResearchSourceTrust
  readonly discoveredFrom: 'search_activity' | 'synthesis_link'
  readonly createdAt: string
}

/**
 * Durable, player-visible output from the central research broker. Codex
 * Search returns a grounded model synthesis plus links; it does not return
 * directly fetched page passages. Keeping that distinction in the contract
 * prevents a later stage from relabeling inference as retrieved fact.
 */
export interface ResearchRecord {
  readonly id: string
  readonly lifecycleRunId: string
  readonly gameId: string
  readonly stage: ResearchStage
  readonly requestedBy: 'research-policy'
  readonly policyVersion: string
  readonly materiality: ResearchMateriality | null
  readonly reason: string
  readonly query: string | null
  readonly status: ResearchStatus
  readonly provider: 'codex'
  readonly transport: 'local'
  readonly model: string | null
  readonly bounds: ResearchBounds
  readonly attemptCount: number
  readonly executedQueries: readonly string[]
  /** Model-generated Codex Search synthesis; always untrusted input data. */
  readonly searchSynthesis: string | null
  /** This broker deliberately performs no third-party page fetch. */
  readonly directPageTextFetched: false
  /** Therefore no claim may be labelled a directly retrieved fact. */
  readonly retrievedFacts: readonly []
  readonly sources: readonly ResearchSource[]
  readonly omittedSourceCount: number
  readonly injectionSignalsDetected: readonly string[]
  readonly contentDigest: string | null
  readonly failureCode: string | null
  readonly startedAt: string | null
  readonly completedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ResearchPromptEvidence {
  readonly recordId: string
  readonly stage: ResearchStage
  readonly materiality: ResearchMateriality
  readonly reason: string
  readonly query: string
  readonly provider: 'codex'
  readonly status: 'completed' | 'failed' | 'timed_out' | 'refused'
  readonly model: string | null
  readonly untrusted: true
  readonly contentKind: 'model_generated_search_synthesis'
  readonly directPageTextFetched: false
  readonly searchSynthesis: string | null
  readonly sourceLinks: readonly Pick<
    ResearchSource,
    'citationId' | 'title' | 'url' | 'trust'
  >[]
  readonly injectionSignalsDetected: readonly string[]
  readonly contentDigest: string | null
  readonly failureCode: string | null
}

export function isResearchTerminal(status: ResearchStatus): boolean {
  return status !== 'searching'
}
