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

export const RESEARCH_CONSENT_VERSION =
  'webchess-research-consent-v1' as const
export const LEGACY_RESEARCH_CONSENT_VERSION =
  'legacy-no-research-consent-v0' as const

export type ResearchConsentVersion =
  | typeof RESEARCH_CONSENT_VERSION
  | typeof LEGACY_RESEARCH_CONSENT_VERSION

export type ResearchConsentDecision =
  | 'allow_search_and_page_fetch'
  | 'no_external_research'

export interface ResearchConsent {
  readonly version: ResearchConsentVersion
  readonly decision: ResearchConsentDecision
  /** Null only for a historical game created before consent was recorded. */
  readonly recordedAt: string | null
}

export const RESEARCH_PAGE_FETCH_LIMIT = 3 as const
export const RESEARCH_PAGE_FETCH_CHARACTER_LIMIT = 6_000 as const

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
 * A bounded, directly retrieved page excerpt. It records what the page
 * returned at retrieval time; it does not establish that the page's claims
 * are accurate or independent evidence.
 */
export interface ResearchRetrievedFact {
  readonly citationId: string
  readonly requestedUrl: string
  readonly finalUrl: string
  readonly title: string
  readonly provider: 'webchess-direct-https'
  readonly fetchVersion: 'webchess-direct-page-fetch-v1'
  readonly retrievedAt: string
  readonly httpStatus: number
  readonly contentType: 'application/xhtml+xml' | 'text/html' | 'text/plain'
  readonly extractor: 'webchess-readable-text-v1'
  readonly rawByteLength: number
  readonly rawContentDigest: string
  readonly rawDigestAlgorithm: 'sha256-raw-response-bytes-v1'
  readonly acceptedCharacterLength: number
  /** SHA-256 of the exact UTF-8 bytes in `text`, independently recomputable. */
  readonly contentDigest: string
  readonly digestAlgorithm: 'sha256-utf8-accepted-text-v1'
  readonly redirectChain: readonly string[]
  readonly text: string
  readonly truncated: boolean
  readonly untrusted: true
  readonly contentKind: 'direct_page_text'
}

export interface ResearchFetchFailure {
  readonly citationId: string
  readonly requestedUrl: string
  readonly finalUrl: string | null
  readonly status: 'failed' | 'refused' | 'timed_out'
  readonly failureCode: string
  readonly httpStatus: number | null
  readonly fetchVersion: 'webchess-direct-page-fetch-v1'
  readonly extractor: 'webchess-readable-text-v1'
  readonly rawByteLength: number
  readonly rawContentDigest: string | null
  readonly rawDigestAlgorithm: 'sha256-raw-response-bytes-v1'
  readonly acceptedCharacterLength: number
  readonly truncated: boolean
  readonly contentDigest: null
  readonly digestAlgorithm: 'sha256-utf8-accepted-text-v1'
  readonly redirectChain: readonly string[]
  readonly injectionSignalsDetected: readonly string[]
  readonly retrievedAt: string
}

/**
 * Durable, player-visible output from the central research broker. Codex
 * Search returns a grounded model synthesis plus discovered links. The local
 * broker may separately retrieve a bounded subset of those links. Keeping the
 * two provenance classes distinct prevents a later stage from relabeling model
 * inference as page text or page assertions as independently verified truth.
 */
export interface ResearchRecord {
  readonly id: string
  readonly lifecycleRunId: string
  readonly gameId: string
  readonly stage: ResearchStage
  readonly requestedBy: 'research-policy'
  readonly consent: ResearchConsent
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
  readonly directPageTextFetched: boolean
  readonly retrievedFacts: readonly ResearchRetrievedFact[]
  readonly fetchFailures: readonly ResearchFetchFailure[]
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
  readonly consent: ResearchConsent
  readonly status: 'completed' | 'failed' | 'timed_out' | 'refused'
  readonly model: string | null
  readonly untrusted: true
  readonly contentKind: 'model_generated_search_synthesis'
  readonly directPageTextFetched: boolean
  readonly searchSynthesis: string | null
  readonly retrievedFacts: readonly ResearchRetrievedFact[]
  readonly fetchFailures: readonly ResearchFetchFailure[]
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
