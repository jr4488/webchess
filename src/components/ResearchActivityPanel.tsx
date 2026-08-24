import { useEffect, useState } from 'react'

import {
  CircleAlert,
  Clock3,
  ExternalLink,
  Globe2,
  Search,
  ShieldCheck,
} from 'lucide-react'

import type {
  ResearchRecord,
  ResearchSource,
  ResearchSourceTrust,
  ResearchStage,
  ResearchStatus,
} from '../lib/research'
import { isResearchTerminal } from '../lib/research'

export interface ResearchPortiaAdjudication {
  readonly status: 'pending' | 'reviewing' | 'completed' | 'unavailable'
  readonly decision: 'deny' | 'permit' | 'retry_field' | 'retry_game' | null
  readonly rationale: string | null
  readonly reviewedPromptDigest: string | null
  readonly currentPromptDigest: string | null
  readonly requiredAmendmentCount: number
}

const STAGE_LABELS: Readonly<Record<ResearchStage, string>> = {
  anansi: 'Anansi',
  chess: 'Chess',
  portia: 'Portia',
  answer: 'Answer',
  charlotte: 'Charlotte',
  wilbur: 'Wilbur',
  web: 'Web',
}

const STATUS_LABELS: Readonly<Record<ResearchStatus, string>> = {
  searching: 'Searching now',
  completed: 'Completed',
  not_needed: 'Not needed',
  failed: 'Failed safely',
  timed_out: 'Timed out',
  refused: 'Refused safely',
}

const TRUST_LABELS: Readonly<Record<ResearchSourceTrust, string>> = {
  government_or_education: 'Government or education link',
  general_web: 'General web link',
}

function stageLabel(stage: ResearchStage): string {
  return STAGE_LABELS[stage]
}

function safeSourceHref(source: ResearchSource): string | null {
  try {
    const parsed = new URL(source.url)
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.hostname.toLowerCase() !== source.hostname.toLowerCase() ||
      parsed.hostname.toLowerCase() === 'localhost' ||
      parsed.hostname.toLowerCase().endsWith('.localhost') ||
      parsed.hostname.toLowerCase().endsWith('.local') ||
      parsed.hostname.toLowerCase().endsWith('.internal')
    ) {
      return null
    }
    return parsed.href
  } catch {
    return null
  }
}

function formatInteger(value: number): string {
  return value.toLocaleString('en-US')
}

function formatTimeout(timeoutMs: number): string {
  return timeoutMs % 1_000 === 0
    ? `${formatInteger(timeoutMs / 1_000)} seconds`
    : `${formatInteger(timeoutMs)} milliseconds`
}

function modelLabel(record: ResearchRecord): string {
  if (record.model) return record.model
  return record.attemptCount === 0 ? 'not invoked' : 'not reported by provider'
}

function statusExplanation(record: ResearchRecord): string {
  switch (record.status) {
    case 'searching':
      return 'Codex Search is executing the single bounded broker invocation. If it returns eligible links, the local broker will attempt up to three sequential, bounded HTTPS page fetches.'
    case 'completed':
      return `Search completed. Its model-generated synthesis and ${record.retrievedFacts.length} accepted direct-page excerpts remain untrusted until Portia reviews them.`
    case 'not_needed':
      return 'The research policy found no material current or external fact gap, so it issued no query.'
    case 'failed':
      return 'The broker failed safely. No synthesis from this request entered the stage.'
    case 'timed_out':
      return `The search exceeded a configured time boundary within the broker’s ${formatTimeout(record.bounds.timeoutMs)} limit. No background retry continues.`
    case 'refused':
      return 'The broker refused this request under its safety policy. No synthesis entered the stage.'
  }
}

function liveAnnouncement(records: readonly ResearchRecord[]): string {
  const searching = records.filter((record) => record.status === 'searching')
  if (searching.length > 0) {
    const latest = searching.at(-1)!
    return `Automatic research for ${stageLabel(latest.stage)} is searching. ${latest.sources.length} source links are visible so far.`
  }

  const latest = records.at(-1)
  if (!latest) return 'No automatic research records are present.'
  return `Automatic research for ${stageLabel(latest.stage)} is ${STATUS_LABELS[latest.status].toLowerCase()}. ${latest.sources.length} source links are visible.`
}

function timestampMs(value: string | null): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function researchElapsedSeconds(record: ResearchRecord, nowMs: number): number {
  const startedMs = timestampMs(record.startedAt)
  if (startedMs === null) return 0
  const completedMs = timestampMs(record.completedAt)
  return Math.max(0, Math.floor(((completedMs ?? nowMs) - startedMs) / 1_000))
}

function packetStatus(record: ResearchRecord): string {
  switch (record.status) {
    case 'searching':
      return 'Waiting for Codex Search to return one bounded result packet.'
    case 'completed':
      return `Packet received with ${record.executedQueries.length} executed queries, ${record.sources.length} citation links, ${record.retrievedFacts.length} accepted page excerpts, and ${record.fetchFailures.length} visible page-fetch failures.`
    case 'not_needed':
      return 'No provider packet was needed for this stage.'
    case 'failed':
    case 'timed_out':
    case 'refused':
      return 'No result packet was accepted into the lifecycle.'
  }
}

function ResearchLiveProgress({ record }: { record: ResearchRecord }) {
  const active = record.status === 'searching'
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [active, record.id, record.startedAt])

  if (record.startedAt === null || record.attemptCount === 0) return null

  const elapsedSeconds = researchElapsedSeconds(record, nowMs)
  const timeoutSeconds = Math.max(1, Math.ceil(record.bounds.timeoutMs / 1_000))
  const elapsedWithinBound = Math.min(elapsedSeconds, timeoutSeconds)
  const nodeCount = Math.min(5, Math.max(1, record.bounds.sourceLimit))
  const sourceNodes = Array.from({ length: nodeCount }, (_, index) => record.sources[index] ?? null)

  return (
    <section
      className={`research-live-progress is-${record.status}`}
      aria-label="Live Codex Search progress"
    >
      <header className="research-live-progress__header">
        <div>
          <small>{active ? 'Live provider activity' : 'Saved provider timing'}</small>
          <h3>{active ? 'The search is moving through the web' : 'The research packet has settled'}</h3>
        </div>
        <div className="research-live-progress__timer" role="timer" aria-label="Research elapsed time">
          <Clock3 size={16} aria-hidden="true" />
          <strong>{formatInteger(elapsedSeconds)}</strong>
          <span>seconds elapsed</span>
        </div>
      </header>

      <div className="research-live-progress__body">
        <div
          className={`research-live-web${active ? ' is-active' : ''}`}
          aria-hidden="true"
        >
          <span className="research-live-web__orbit is-outer" />
          <span className="research-live-web__orbit is-inner" />
          <span className="research-live-web__sweep" />
          <span className="research-live-web__hub">
            <Globe2 size={23} />
          </span>
          {sourceNodes.map((source, index) => (
            <span
              className={`research-live-web__node research-live-web__node--${index + 1}${source ? ' has-source' : ''}`}
              key={source?.id ?? `pending-${index + 1}`}
            >
              {source ? source.citationId : index + 1}
            </span>
          ))}
        </div>

        <ol className="research-live-progress__signals">
          <li className="is-complete">
            <span aria-hidden="true" />
            <div><strong>Query sent</strong><small>The exact broker query is visible below.</small></div>
          </li>
          <li className={active ? 'is-active' : 'is-complete'}>
            <span aria-hidden="true" />
            <div>
              <strong>{active ? 'Codex Search is working' : 'Provider call ended'}</strong>
              <small>{active ? 'OpenClaw is keeping the bounded provider request open.' : STATUS_LABELS[record.status]}</small>
            </div>
          </li>
          <li className={record.status === 'completed' ? 'is-complete' : active ? 'is-pending' : 'is-stopped'}>
            <span aria-hidden="true" />
            <div><strong>Result packet</strong><small>{packetStatus(record)}</small></div>
          </li>
        </ol>
      </div>

      <div className="research-live-progress__meter">
        <div>
          <span>Elapsed time against the broker limit</span>
          <strong>{formatInteger(elapsedSeconds)} / {formatInteger(timeoutSeconds)} seconds</strong>
        </div>
        <progress
          max={timeoutSeconds}
          value={elapsedWithinBound}
          aria-label="Elapsed research time against the broker limit"
        >
          {elapsedWithinBound} of {timeoutSeconds} seconds
        </progress>
        <p>
          {record.sources.length} source {record.sources.length === 1 ? 'link' : 'links'} received.
          {' '}Codex Search returns its search activity and citations together as one validated packet;
          WebChess does not invent intermediate results while it waits.
        </p>
      </div>
    </section>
  )
}

function ResearchSourceItem({ source }: { source: ResearchSource }) {
  const safeHref = safeSourceHref(source)
  return (
    <li className="research-source">
      <div className="research-source__heading">
        <code>{source.citationId}</code>
        {safeHref ? (
          <a href={safeHref} target="_blank" rel="noopener noreferrer">
            {source.title} <ExternalLink size={12} aria-hidden="true" />
          </a>
        ) : (
          <strong>{source.title} · link withheld</strong>
        )}
      </div>
      <p>
        {source.hostname} · {TRUST_LABELS[source.trust]} · discovered from{' '}
        {source.discoveredFrom.replaceAll('_', ' ')}
      </p>
      <small>Source record ID: <code>{source.id}</code></small>
    </li>
  )
}

function ResearchRecordCard({
  adjudication,
  record,
}: {
  adjudication: ResearchPortiaAdjudication | null
  record: ResearchRecord
}) {
  const headingId = `research-record-${record.id}`
  const sourceCount = record.sources.length
  const sourceCap = Math.max(1, record.bounds.sourceLimit)
  const sourceProgress = Math.min(sourceCount, sourceCap)
  const terminal = isResearchTerminal(record.status)

  return (
    <article
      className={`research-record is-${record.status}`}
      aria-labelledby={headingId}
      aria-busy={record.status === 'searching'}
      data-research-status={record.status}
    >
      <header className="research-record__header">
        <span className="research-record__icon" aria-hidden="true">
          {record.status === 'completed' || record.status === 'not_needed'
            ? <ShieldCheck size={18} />
            : record.status === 'searching'
              ? <Search size={18} />
              : <CircleAlert size={18} />}
        </span>
        <div>
          <small>{stageLabel(record.stage)} · automatic research</small>
          <h2 id={headingId}>{STATUS_LABELS[record.status]}</h2>
        </div>
        <span className="research-record__status">{record.status.replaceAll('_', ' ')}</span>
      </header>

      <p className="research-record__explanation">{statusExplanation(record)}</p>

      <ResearchLiveProgress record={record} />

      <dl className="research-record__request">
        <div><dt>Stage</dt><dd>{stageLabel(record.stage)}</dd></div>
        <div><dt>Materiality</dt><dd>{record.materiality ?? 'not applicable'}</dd></div>
        <div>
          <dt>Game-scoped research choice</dt>
          <dd>{record.consent.version === 'legacy-no-research-consent-v0'
            ? 'Historical record: no consent was recorded; new research is fail-closed'
            : record.consent.decision === 'allow_search_and_page_fetch'
              ? 'Search and bounded direct-page retrieval allowed'
              : 'External research declined'}</dd>
        </div>
        <div><dt>Consent contract</dt><dd><code>{record.consent.version}</code></dd></div>
        <div className="is-wide"><dt>Reason</dt><dd>{record.reason}</dd></div>
      </dl>

      <section className="research-query" aria-label={`Broker query for ${stageLabel(record.stage)}`}>
        <h3>Exact broker query</h3>
        <code>{record.query ?? 'No query was issued.'}</code>
      </section>

      <div className="research-provider">
        <dl>
          <div><dt>Search provider</dt><dd>OpenClaw Codex Hosted Search ({record.provider})</dd></div>
          <div><dt>Model</dt><dd>{modelLabel(record)}</dd></div>
          <div><dt>Search transport</dt><dd>{record.transport}</dd></div>
          <div><dt>Page retrieval</dt><dd>WebChess local bounded HTTPS fetcher</dd></div>
        </dl>
      </div>

      <section className="research-bounds" aria-label="Applied research bounds">
        <h3>Applied broker bounds</h3>
        <dl>
          <div>
            <dt>Invocations</dt>
            <dd>{record.attemptCount} used · {record.bounds.invocationLimit} maximum</dd>
          </div>
          <div><dt>Result limit</dt><dd>{formatInteger(record.bounds.resultLimit)}</dd></div>
          <div><dt>Source limit</dt><dd>{formatInteger(record.bounds.sourceLimit)}</dd></div>
          <div><dt>Time limit</dt><dd>{formatTimeout(record.bounds.timeoutMs)}</dd></div>
          <div>
            <dt>Synthesis character limit</dt>
            <dd>{formatInteger(record.bounds.synthesisCharacterLimit)}</dd>
          </div>
        </dl>
      </section>

      <section className="research-progress" aria-label="Research status and source progress">
        <div>
          <strong>{STATUS_LABELS[record.status]}</strong>
          <span>{sourceCount} linked of {record.bounds.sourceLimit} allowed · {record.omittedSourceCount} omitted</span>
        </div>
        <progress
          max={sourceCap}
          value={sourceProgress}
          aria-label="Source links found against the applied source limit"
        >
          {sourceProgress} of {sourceCap}
        </progress>
      </section>

      <section className="research-queries">
        <h3>Every executed query</h3>
        {record.executedQueries.length > 0 ? (
          <ol>
            {record.executedQueries.map((query, index) => (
              <li key={`${index}-${query}`}><code>{query}</code></li>
            ))}
          </ol>
        ) : (
          <p>None. The broker did not execute a search query.</p>
        )}
      </section>

      <div className="research-evidence">
        <section className="research-evidence__direct">
          <h3>Direct-page excerpts: {record.retrievedFacts.length}</h3>
          <p>
            These are untrusted excerpts accepted by WebChess’s bounded local fetcher.
            They show what page bytes yielded at retrieval time; they do not prove the
            page’s claims are true or independently corroborated.
          </p>
          {record.retrievedFacts.map((fact) => (
            <details className="research-page-evidence" key={fact.citationId}>
              <summary><code>{fact.citationId}</code> · {fact.title}</summary>
              <dl>
                <div><dt>Requested URL</dt><dd><code>{fact.requestedUrl}</code></dd></div>
                <div><dt>Final URL</dt><dd><code>{fact.finalUrl}</code></dd></div>
                <div><dt>HTTP / media type</dt><dd>{fact.httpStatus} · {fact.contentType}</dd></div>
                <div><dt>Fetcher / extractor</dt><dd><code>{fact.fetchVersion}</code> · <code>{fact.extractor}</code></dd></div>
                <div><dt>Raw response</dt><dd>{formatInteger(fact.rawByteLength)} bytes · <code>{fact.rawContentDigest}</code></dd></div>
                <div><dt>Accepted text</dt><dd>{formatInteger(fact.acceptedCharacterLength)} characters{fact.truncated ? ' · truncated at policy limit' : ''}</dd></div>
                <div><dt>Accepted-text digest</dt><dd><code>{fact.contentDigest}</code></dd></div>
                <div><dt>Retrieved</dt><dd>{fact.retrievedAt}</dd></div>
              </dl>
              <p><strong>Redirect chain:</strong> {fact.redirectChain.join(' → ')}</p>
              <pre>{fact.text}</pre>
            </details>
          ))}
          {record.retrievedFacts.length === 0 ? (
            <p>No third-party page text was accepted for this record.</p>
          ) : null}
          <h4>Visible page-fetch failures: {record.fetchFailures.length}</h4>
          {record.fetchFailures.length > 0 ? (
            <ul className="research-fetch-failures">
              {record.fetchFailures.map((failure) => (
                <li key={`${failure.citationId}-${failure.failureCode}`}>
                  <strong><code>{failure.citationId}</code> · {failure.status}</strong>
                  <code>{failure.failureCode}</code>
                  <span>{failure.requestedUrl}</span>
                  <span>Final URL: {failure.finalUrl ?? 'not reached'} · HTTP {failure.httpStatus ?? 'not received'}</span>
                  <span>{formatInteger(failure.rawByteLength)} raw bytes · digest {failure.rawContentDigest ?? 'not available'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No page-fetch failure was recorded.</p>
          )}
        </section>
        <section className="research-evidence__synthesis">
          <h3>Codex Search synthesis (model-generated, untrusted until Portia)</h3>
          <p>{record.searchSynthesis ?? 'No synthesis was returned.'}</p>
        </section>
      </div>

      <section className="research-sources">
        <div className="research-sources__title">
          <h3>Citation links discovered by Codex Search</h3>
          <span>{sourceCount} visible · {record.omittedSourceCount} omitted</span>
        </div>
        {sourceCount > 0 ? (
          <ol>{record.sources.map((source) => <ResearchSourceItem key={source.id} source={source} />)}</ol>
        ) : (
          <p>No citation links were returned.</p>
        )}
      </section>

      <section
        className={`research-safety${record.injectionSignalsDetected.length > 0 ? ' is-flagged' : ''}`}
      >
        <h3>Injection signals detected: {record.injectionSignalsDetected.length}</h3>
        {record.injectionSignalsDetected.length > 0 ? (
          <ul>
            {record.injectionSignalsDetected.map((signal, index) => (
              <li key={`${index}-${signal}`}>{signal}</li>
            ))}
          </ul>
        ) : (
          <p>None reported by the broker.</p>
        )}
      </section>

      {record.stage === 'portia' && adjudication ? (
        <section
          className={`research-adjudication is-${adjudication.status}`}
          aria-label="Portia assessment of the research packet"
        >
          <h3>Portia’s research-packet assessment</h3>
          {adjudication.status === 'reviewing' ? (
            <p>
              Portia is assessing this read-only packet inside the exact candidate
              prompt while its spider visits the real survivor signals. Research
              does not move, delete, consume, or reweight a board piece.
            </p>
          ) : adjudication.status === 'completed' ? (
            <>
              <p>
                Portia’s prompt decision: <strong>{adjudication.decision?.replaceAll('_', ' ')}</strong>.
                {' '}{adjudication.rationale}
              </p>
              <dl>
                <div>
                  <dt>Exact prompt binding</dt>
                  <dd>
                    {adjudication.reviewedPromptDigest &&
                    adjudication.reviewedPromptDigest === adjudication.currentPromptDigest
                      ? 'Digest matched'
                      : 'Digest did not match'}
                  </dd>
                </div>
                <div>
                  <dt>Required prompt amendments</dt>
                  <dd>{adjudication.requiredAmendmentCount}</dd>
                </div>
              </dl>
              <p className="research-adjudication__boundary">
                Portia controls whether and how this synthesis enters Answer; the
                persisted board remains unchanged.
              </p>
            </>
          ) : adjudication.status === 'unavailable' ? (
            <p>
              Portia exhausted its bounded provider attempts, so this research
              packet was not silently admitted to Answer.
            </p>
          ) : (
            <p>
              This packet is frozen and waiting for Portia’s pre-generation review.
              It cannot enter Answer before the reviewed prompt digest is permitted.
            </p>
          )}
        </section>
      ) : null}

      <dl className="research-record__metadata">
        <div><dt>Research record ID</dt><dd><code>{record.id}</code></dd></div>
        <div>
          <dt>Status</dt>
          <dd>{terminal ? `terminal · ${record.status}` : `active · ${record.status}`}</dd>
        </div>
        <div><dt>Policy</dt><dd>{record.policyVersion}</dd></div>
        <div><dt>Content digest</dt><dd><code>{record.contentDigest ?? 'none'}</code></dd></div>
        {record.failureCode ? (
          <div className="is-wide"><dt>Failure code</dt><dd><code>{record.failureCode}</code></dd></div>
        ) : null}
      </dl>
    </article>
  )
}

export function ResearchActivityPanel({
  portiaAdjudication = null,
  records,
}: {
  portiaAdjudication?: ResearchPortiaAdjudication | null
  records: readonly ResearchRecord[]
}) {
  if (records.length === 0) return null
  const activeCount = records.filter((record) => record.status === 'searching').length

  return (
    <section className="research-activity-panel" aria-label="Visible automatic web research">
      <header className="research-activity-panel__heading">
        <span aria-hidden="true"><Search size={20} /></span>
        <div>
          <small>Nested inside the seven-stage lifecycle</small>
          <h2>Automatic web research</h2>
          <p>Every broker query and returned result stays inspectable here.</p>
        </div>
        <strong>{activeCount > 0 ? `${activeCount} active` : `${records.length} saved`}</strong>
      </header>

      <div className="research-activity-panel__records">
        {records.map((record) => (
          <ResearchRecordCard
            key={record.id}
            adjudication={portiaAdjudication}
            record={record}
          />
        ))}
      </div>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveAnnouncement(records)}
      </p>
    </section>
  )
}

export function ResearchProvenanceDetails({
  records,
}: {
  records: readonly ResearchRecord[]
}) {
  if (records.length === 0) return null

  return (
    <section className="research-provenance" aria-label="Durable research records">
      <h3>Research records</h3>
      <ol>
        {records.slice().reverse().map((record) => {
          const terminal = isResearchTerminal(record.status)
          return (
            <li key={record.id}>
              <span className={`is-${record.status}`} aria-hidden="true" />
              <div>
                <strong>
                  {stageLabel(record.stage)} research · {terminal ? 'terminal' : 'active'}{' '}
                  {record.status.replaceAll('_', ' ')}
                </strong>
                <small>Research record <code>{record.id}</code></small>
                {record.sources.length > 0 ? (
                  <ul>
                    {record.sources.map((source) => (
                      <li key={source.id}>
                        <code>{source.citationId}</code> · source record <code>{source.id}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <small>No source records.</small>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
