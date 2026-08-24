import type {
  ResearchFetchFailure,
  ResearchRecord,
  ResearchRetrievedFact,
  ResearchSource,
} from '../../lib/research'
import {
  RESEARCH_PAGE_FETCH_LIMIT,
} from '../../lib/research'
import { hashCanonicalJson, type CanonicalJson } from '../db'
import {
  OpenClawCliError,
  runOpenClawWebSearch,
  type OpenClawWebSearchActivity,
  type OpenClawWebSearchResult,
} from '../openclaw/cli'
import {
  resolveOpenClawConfig,
  type OpenClawConfig,
} from '../openclaw/config'
import {
  RESEARCH_BOUNDS,
  RESEARCH_POLICY_VERSION,
  planResearchForStage,
} from './policy'
import type {
  ResearchBrokerPort,
  ResearchRepositoryPort,
  ResearchRequestContext,
} from './types'
import {
  DIRECT_PAGE_DIGEST_ALGORITHM,
  DIRECT_PAGE_EXTRACTOR_VERSION,
  DIRECT_PAGE_FETCH_TIMEOUT_MS,
  DIRECT_PAGE_FETCH_VERSION,
  DIRECT_PAGE_RAW_DIGEST_ALGORITHM,
  SecureDirectPageFetcher,
  isResearchFetchFailure,
  normalizePublicHttpsUrl,
} from './direct-page-fetch'

const RESEARCH_MAX_OUTPUT_BYTES = 512 * 1024
const RESEARCH_MAX_SEARCH_ACTIVITIES = 24
const SEARCH_BOUNDARY =
  /^<<<EXTERNAL_UNTRUSTED_CONTENT id="[a-f0-9]{16}">>>\nSource: Web Search\n---\n([\s\S]+)\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id="[a-f0-9]{16}">>>$/u

const INJECTION_PATTERNS = [
  {
    code: 'instruction_override_language',
    pattern: /\b(?:disregard|forget|ignore|override)\b.{0,80}\b(?:instruction|prompt|rule|system)\b/iu,
  },
  {
    code: 'role_impersonation_language',
    pattern: /\b(?:assistant|developer|system)\s*(?:message|prompt|role)?\s*:/iu,
  },
  {
    code: 'model_control_token',
    pattern: /<\|(?:assistant|developer|end|system|tool)[^>]*\|>/iu,
  },
] as const

interface NormalizedSearch {
  readonly contentDigest: string
  readonly executedQueries: readonly string[]
  readonly injectionSignalsDetected: readonly string[]
  readonly omittedSourceCount: number
  readonly searchSynthesis: string
  readonly sources: readonly Omit<ResearchSource, 'id' | 'createdAt'>[]
}

function canonicalJson(value: unknown): CanonicalJson {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new TypeError('Research provenance must be JSON serializable.')
  }
  return JSON.parse(serialized) as CanonicalJson
}

function safePublicUrl(value: string): URL | null {
  return normalizePublicHttpsUrl(value)
}

function sourcesToFetch(
  sources: readonly Omit<ResearchSource, 'id' | 'createdAt'>[],
): readonly Omit<ResearchSource, 'id' | 'createdAt'>[] {
  return [...sources]
    .sort((left, right) => {
      const leftAuthority = left.trust === 'government_or_education'
      const rightAuthority = right.trust === 'government_or_education'
      if (leftAuthority !== rightAuthority) return leftAuthority ? -1 : 1
      return left.ordinal - right.ordinal
    })
    .slice(0, RESEARCH_PAGE_FETCH_LIMIT)
}

function pageBudgetFailure(
  source: Omit<ResearchSource, 'id' | 'createdAt'>,
): ResearchFetchFailure {
  return {
    citationId: source.citationId,
    requestedUrl: source.url,
    finalUrl: null,
    status: 'timed_out',
    failureCode: 'page_fetch_budget_exhausted',
    httpStatus: null,
    fetchVersion: DIRECT_PAGE_FETCH_VERSION,
    extractor: DIRECT_PAGE_EXTRACTOR_VERSION,
    rawByteLength: 0,
    rawContentDigest: null,
    rawDigestAlgorithm: DIRECT_PAGE_RAW_DIGEST_ALGORITHM,
    acceptedCharacterLength: 0,
    truncated: false,
    contentDigest: null,
    digestAlgorithm: DIRECT_PAGE_DIGEST_ALGORITHM,
    redirectChain: [source.url],
    injectionSignalsDetected: [],
    retrievedAt: new Date().toISOString(),
  }
}

function cleanTitle(value: string, hostname: string): string {
  const title = value
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return (title || hostname).slice(0, 500)
}

function sourceTrust(hostname: string): ResearchSource['trust'] {
  return /(?:\.gov|\.edu)$/iu.test(hostname)
    ? 'government_or_education'
    : 'general_web'
}

function executedQueries(
  activities: readonly OpenClawWebSearchActivity[],
  requestedQuery: string,
): readonly string[] {
  const queries = [requestedQuery]
  for (const activity of activities) {
    if (activity.query) queries.push(activity.query)
    if (activity.queries) queries.push(...activity.queries)
  }
  return [...new Set(queries.map((query) => query.replace(/\s+/gu, ' ').trim()))]
}

function unwrapSearchContent(content: string): string {
  const match = SEARCH_BOUNDARY.exec(content)
  const body = match?.[1]?.trim()
  if (!body) throw new Error('search_content_boundary_invalid')
  return body
}

function sanitizedSynthesis(body: string): {
  readonly synthesis: string
  readonly signals: readonly string[]
} {
  const signals = new Set<string>()
  const safeLines: string[] = []
  for (const line of body.split(/\r?\n/u)) {
    let suspicious = false
    for (const injection of INJECTION_PATTERNS) {
      if (injection.pattern.test(line)) {
        signals.add(injection.code)
        suspicious = true
      }
    }
    if (!suspicious) safeLines.push(line)
  }
  const synthesis = safeLines
    .join('\n')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return character === '\n' || character === '\t' || (code >= 32 && code !== 127)
    })
    .join('')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  if (
    synthesis.length === 0 ||
    synthesis.length > RESEARCH_BOUNDS.synthesisCharacterLimit
  ) {
    throw new Error('search_synthesis_out_of_bounds')
  }
  return { synthesis, signals: [...signals] }
}

function sourceCandidates(
  sanitizedSynthesis: string,
  activities: readonly OpenClawWebSearchActivity[],
): readonly {
  discoveredFrom: ResearchSource['discoveredFrom']
  title: string
  url: string
}[] {
  const candidates: Array<{
    discoveredFrom: ResearchSource['discoveredFrom']
    title: string
    url: string
  }> = []
  for (const activity of activities) {
    if (activity.url) {
      candidates.push({
        discoveredFrom: 'search_activity',
        title: '',
        url: activity.url,
      })
    }
  }
  const markdownLink = /\[([^\]\n]{1,500})\]\((https?:\/\/[^\s)]+)\)/giu
  for (const match of sanitizedSynthesis.matchAll(markdownLink)) {
    candidates.push({
      discoveredFrom: 'synthesis_link',
      title: match[1] ?? '',
      url: match[2] ?? '',
    })
  }
  const withoutMarkdown = sanitizedSynthesis.replace(markdownLink, ' ')
  const bareUrl = /https?:\/\/[^\s<>()"']+/giu
  for (const match of withoutMarkdown.matchAll(bareUrl)) {
    candidates.push({
      discoveredFrom: 'synthesis_link',
      title: '',
      url: match[0],
    })
  }
  return candidates
}

export function normalizeCodexSearch(
  result: OpenClawWebSearchResult,
): NormalizedSearch {
  const body = unwrapSearchContent(result.content)
  const safe = sanitizedSynthesis(body)
  const seen = new Set<string>()
  const allSources: Array<Omit<ResearchSource, 'id' | 'createdAt'>> = []
  for (const candidate of sourceCandidates(safe.synthesis, result.searches)) {
    const parsed = safePublicUrl(candidate.url)
    if (!parsed) continue
    const url = parsed.toString()
    if (seen.has(url)) continue
    seen.add(url)
    const ordinal = allSources.length + 1
    allSources.push({
      citationId: `R${ordinal}`,
      ordinal,
      title: cleanTitle(candidate.title, parsed.hostname),
      url,
      hostname: parsed.hostname,
      trust: sourceTrust(parsed.hostname),
      discoveredFrom: candidate.discoveredFrom,
    })
  }
  if (allSources.length === 0) {
    throw new Error('insufficient_source_basis')
  }
  const sources = allSources.slice(0, RESEARCH_BOUNDS.sourceLimit)
  return {
    contentDigest: hashCanonicalJson({
      kind: 'codex-search-synthesis-v1',
      provider: result.provider,
      model: result.model,
      query: result.query,
      body,
      searches: result.searches,
    }),
    executedQueries: executedQueries(result.searches, result.query),
    injectionSignalsDetected: safe.signals,
    omittedSourceCount: Math.max(0, allSources.length - sources.length),
    searchSynthesis: safe.synthesis,
    sources,
  }
}

function failureStatus(error: unknown): {
  readonly code: string
  readonly status: 'failed' | 'refused' | 'timed_out'
} {
  if (error instanceof OpenClawCliError) {
    if (error.kind === 'timeout') {
      return { code: 'codex_search_timeout', status: 'timed_out' }
    }
    if (error.kind === 'not-found') {
      return { code: 'codex_search_unavailable', status: 'refused' }
    }
    if (error.kind === 'invalid-output') {
      return { code: 'codex_search_contract_invalid', status: 'failed' }
    }
    if (error.kind === 'aborted') {
      return { code: 'codex_search_aborted', status: 'failed' }
    }
    return { code: 'codex_search_failed', status: 'failed' }
  }
  if (error instanceof RangeError) {
    return { code: 'research_bound_refused', status: 'refused' }
  }
  if (error instanceof Error && /^[a-z0-9_]{3,80}$/u.test(error.message)) {
    return { code: error.message, status: 'failed' }
  }
  return { code: 'research_normalization_failed', status: 'failed' }
}

function configurationDigest(
  timeoutMs: number,
  consent: ResearchRequestContext['researchConsent'],
): string {
  return hashCanonicalJson(canonicalJson({
    kind: 'webchess-visible-research-configuration-v3',
    provider: 'codex',
    transport: 'local',
    consent,
    fetch: {
      mode: DIRECT_PAGE_FETCH_VERSION,
      pageLimit: RESEARCH_PAGE_FETCH_LIMIT,
      acceptedCharacterLimitPerPage: 6_000,
      rawByteLimitPerPage: 1_048_576,
      timeoutMsPerPage: DIRECT_PAGE_FETCH_TIMEOUT_MS,
      redirectPolicy: 'same-host-https-only',
      dnsPolicy: 'all-addresses-global-then-pin-one',
    },
    policyVersion: RESEARCH_POLICY_VERSION,
    bounds: {
      invocationLimit: RESEARCH_BOUNDS.invocationLimit,
      resultLimit: RESEARCH_BOUNDS.resultLimit,
      sourceLimit: RESEARCH_BOUNDS.sourceLimit,
      timeoutMs,
      synthesisCharacterLimit: RESEARCH_BOUNDS.synthesisCharacterLimit,
    },
  }))
}

function staleSearching(record: ResearchRecord): boolean {
  if (record.status !== 'searching' || !record.startedAt) return false
  return Date.now() - new Date(record.startedAt).getTime() >
    record.bounds.timeoutMs + 5_000
}

export class DurableResearchBroker implements ResearchBrokerPort {
  constructor(
    private readonly repository: ResearchRepositoryPort,
    private readonly pageFetcher: Pick<SecureDirectPageFetcher, 'fetch'> =
      new SecureDirectPageFetcher(),
  ) {}

  getForGame(ownerId: string, gameId: string): Promise<readonly ResearchRecord[]> {
    return this.repository.getForGame(ownerId, gameId)
  }

  async ensureForStage(input: ResearchRequestContext): Promise<ResearchRecord> {
    const existing = await this.repository.getForPolicy({
      ownerId: input.ownerId,
      gameId: input.gameId,
      stage: input.stage,
      policyVersion: RESEARCH_POLICY_VERSION,
      researchConsent: input.researchConsent,
    })
    if (existing) {
      if (staleSearching(existing)) {
        return this.repository.fail({
          ownerId: input.ownerId,
          requestId: existing.id,
          lifecycleState: input.lifecycleState,
          status: 'timed_out',
          failureCode: 'durable_research_deadline_expired',
          configurationDigest: configurationDigest(
            existing.bounds.timeoutMs,
            existing.consent,
          ),
        })
      }
      return existing
    }

    const decision = planResearchForStage(input)
    if (
      !decision.needed ||
      !decision.materiality ||
      !decision.query
    ) {
      return this.repository.recordNotNeeded({
        ...input,
        policyVersion: RESEARCH_POLICY_VERSION,
        reason: decision.reason,
        configurationDigest: configurationDigest(
          RESEARCH_BOUNDS.timeoutMs,
          input.researchConsent,
        ),
      })
    }

    let configured: OpenClawConfig
    try {
      configured = resolveOpenClawConfig()
    } catch {
      const claim = await this.repository.start({
        ...input,
        policyVersion: RESEARCH_POLICY_VERSION,
        materiality: decision.materiality,
        reason: decision.reason,
        query: decision.query,
        timeoutMs: RESEARCH_BOUNDS.timeoutMs,
        configurationDigest: configurationDigest(
          RESEARCH_BOUNDS.timeoutMs,
          input.researchConsent,
        ),
      })
      if (!claim.created) return claim.record
      return this.repository.fail({
        ownerId: input.ownerId,
        requestId: claim.record.id,
        lifecycleState: input.lifecycleState,
        status: 'refused',
        failureCode: 'codex_search_configuration_invalid',
        configurationDigest: configurationDigest(
          RESEARCH_BOUNDS.timeoutMs,
          input.researchConsent,
        ),
      })
    }
    const effectiveTimeoutMs = Math.min(
      configured.timeoutMs,
      RESEARCH_BOUNDS.timeoutMs,
    )
    const appliedConfigurationDigest = configurationDigest(
      effectiveTimeoutMs,
      input.researchConsent,
    )
    const claim = await this.repository.start({
      ...input,
      policyVersion: RESEARCH_POLICY_VERSION,
      materiality: decision.materiality,
      reason: decision.reason,
      query: decision.query,
      timeoutMs: effectiveTimeoutMs,
      configurationDigest: appliedConfigurationDigest,
    })
    if (!claim.created) return claim.record
    const started = claim.record
    if (started.status !== 'searching') return started

    const researchConfig = {
      ...configured,
      maxOutputBytes: Math.min(configured.maxOutputBytes, RESEARCH_MAX_OUTPUT_BYTES),
      timeoutMs: effectiveTimeoutMs,
      transport: 'local' as const,
    }
    try {
      const brokerStartedAt = Date.now()
      const result = await runOpenClawWebSearch(decision.query, researchConfig, {
        limit: RESEARCH_BOUNDS.resultLimit,
        maxContentChars: RESEARCH_BOUNDS.synthesisCharacterLimit + 512,
        maxSearchActivities: RESEARCH_MAX_SEARCH_ACTIVITIES,
      })
      const normalized = normalizeCodexSearch(result)
      const retrievedFacts: ResearchRetrievedFact[] = []
      const fetchFailures: ResearchFetchFailure[] = []
      const injectionSignalsDetected = new Set(
        normalized.injectionSignalsDetected,
      )
      for (const source of sourcesToFetch(normalized.sources)) {
        const remainingMs = effectiveTimeoutMs - (Date.now() - brokerStartedAt)
        if (remainingMs < 1) {
          fetchFailures.push(pageBudgetFailure(source))
          continue
        }
        try {
          const fetched = await this.pageFetcher.fetch(
            source,
            Math.min(DIRECT_PAGE_FETCH_TIMEOUT_MS, remainingMs),
          )
          retrievedFacts.push(fetched.fact)
          fetched.injectionSignalsDetected.forEach((signal) =>
            injectionSignalsDetected.add(signal))
        } catch (error) {
          if (!isResearchFetchFailure(error)) throw error
          fetchFailures.push(error)
          error.injectionSignalsDetected.forEach((signal) =>
            injectionSignalsDetected.add(signal))
        }
      }
      const contentDigest = hashCanonicalJson(canonicalJson({
        kind: 'codex-search-with-direct-page-evidence-v2',
        searchContentDigest: normalized.contentDigest,
        retrievedFacts,
        fetchFailures,
      }))
      return this.repository.complete({
        ownerId: input.ownerId,
        requestId: started.id,
        lifecycleState: input.lifecycleState,
        model: result.model,
        ...normalized,
        contentDigest,
        directPageTextFetched: retrievedFacts.length > 0,
        retrievedFacts,
        fetchFailures,
        injectionSignalsDetected: [...injectionSignalsDetected],
        configurationDigest: appliedConfigurationDigest,
      })
    } catch (error) {
      const failure = failureStatus(error)
      return this.repository.fail({
        ownerId: input.ownerId,
        requestId: started.id,
        lifecycleState: input.lifecycleState,
        status: failure.status,
        failureCode: failure.code,
        configurationDigest: appliedConfigurationDigest,
      })
    }
  }
}
