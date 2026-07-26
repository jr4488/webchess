import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  BrainCircuit,
  CircleCheck,
  Cpu,
  MessageSquareQuote,
  Radio,
  Sparkles,
} from 'lucide-react'

import type {
  ModelActivityPhase,
  ModelActivityState,
  ReasoningSource,
} from '../types'

const HEARTBEAT_STALE_MS = 25_000
const SCROLL_LOCK_SLACK_PX = 24

const REASONING_LABELS: Record<ReasoningSource, {
  title: string
  caption: string
  boundary: string
}> = {
  summary: {
    title: 'Reasoning summary',
    caption: 'Written by the provider for display',
    boundary:
      'The provider summarises its own reasoning for end users. It reflects the ' +
      'model’s process but is not a literal transcript of it.',
  },
  raw: {
    title: 'Model thinking',
    caption: 'Live from the model on this machine',
    boundary:
      'This is the local model’s own thinking, streamed as it works. It never ' +
      'leaves this machine, and it is working text rather than a final answer.',
  },
}

export interface ModelActivityMetric {
  label: string
  value: string | number
}

interface ModelActivityPanelProps {
  activity: ModelActivityState
  modelLabel: string
  providerLabel: string
  summary: string
  metrics?: readonly ModelActivityMetric[]
}

const PHASE_LABELS: Record<ModelActivityPhase, string> = {
  'request-accepted': 'Request accepted',
  'preparing-input': 'Preparing the model input',
  'awaiting-model': 'Waiting for the model',
  thinking: 'Model activity received',
  'writing-rationale': 'Writing a public rationale',
  drafting: 'Drafting the structured response',
  'validating-output': 'Checking the completed response',
  complete: 'Response complete',
}

const DIVISION_PHASE_DETAILS: Record<ModelActivityPhase, string> = {
  'request-accepted': 'WebChess has opened the live division request.',
  'preparing-input': 'The question and 64-facet structure are being prepared.',
  'awaiting-model': 'The local model has the question and is beginning the division.',
  thinking: 'The model is reasoning through the 64 facets.',
  'writing-rationale': 'The local model is writing a short rationale specifically for this display.',
  drafting: 'The model is forming the structured 64-facet response.',
  'validating-output': 'WebChess is checking IDs, uniqueness, and completeness.',
  complete: 'The validated facets are ready for the board.',
}

const ANSWER_PHASE_DETAILS: Record<ModelActivityPhase, string> = {
  'request-accepted': 'WebChess has opened the live answer request.',
  'preparing-input': 'The outcome and captured game signals are being prepared.',
  'awaiting-model': 'The local model has the game reading and is beginning the answer.',
  thinking: 'The model is reasoning about the captured signals.',
  'writing-rationale': 'The local model is writing a short rationale specifically for this display.',
  drafting: 'The model is forming the structured final response.',
  'validating-output': 'WebChess is checking the final answer contract.',
  complete: 'The validated final answer is ready.',
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatFreshness(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  if (totalSeconds < 5) return 'just now'
  if (totalSeconds < 60) return `${totalSeconds}s ago`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds === 0 ? `${minutes}m ago` : `${minutes}m ${seconds}s ago`
}

function operationPhaseDetail(
  operation: ModelActivityState['operation'],
  phase: ModelActivityPhase,
): string {
  return operation === 'division'
    ? DIVISION_PHASE_DETAILS[phase]
    : ANSWER_PHASE_DETAILS[phase]
}

/**
 * Follow streaming reasoning, unless the reader has scrolled up to re-read
 * something. Yanking them back to the bottom on every delta makes the panel
 * unusable while the model is still working.
 */
function useFollowingScroll(dependency: string | undefined) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const followRef = useRef(true)

  const onScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    followRef.current = distanceFromBottom <= SCROLL_LOCK_SLACK_PX
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !followRef.current) return
    viewport.scrollTop = viewport.scrollHeight
  }, [dependency])

  return { viewportRef, onScroll }
}

function latestPhaseTime(
  history: ModelActivityState['history'],
  phase: ModelActivityPhase,
): number | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].phase === phase) return history[index].at
  }
  return undefined
}

export function ModelActivityPanel({
  activity,
  modelLabel,
  providerLabel,
  summary,
  metrics = [],
}: ModelActivityPanelProps) {
  const headingId = useId()
  const [clockNow, setClockNow] = useState(() => Date.now())
  const active = activity.status === 'active'

  useEffect(() => {
    if (!active) return

    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [active, activity.startedAt])

  const now = Math.max(
    clockNow,
    activity.startedAt,
    activity.lastHeartbeatAt,
    activity.lastProviderActivityAt ?? 0,
  )
  const completedAt = latestPhaseTime(activity.history, 'complete')
  const endedAt = activity.status === 'complete'
    ? completedAt ?? activity.lastHeartbeatAt
    : activity.status === 'error'
      ? activity.lastHeartbeatAt
      : now
  const elapsedLabel = formatDuration(endedAt - activity.startedAt)
  const heartbeatAge = Math.max(0, now - activity.lastHeartbeatAt)
  const heartbeatFresh = heartbeatAge <= HEARTBEAT_STALE_MS
  const connectionLabel = activity.status === 'complete'
    ? 'WebChess stream complete'
    : activity.status === 'error'
      ? 'WebChess activity ended'
      : heartbeatFresh
        ? 'WebChess connection active'
        : 'No recent WebChess heartbeat'
  const providerActivityLabel = activity.lastProviderActivityAt === undefined
    ? 'Waiting for model activity'
    : activity.status === 'complete'
      ? 'Model activity complete'
      : `Model activity ${formatFreshness(now - activity.lastProviderActivityAt)}`
  const phaseLabel = PHASE_LABELS[activity.phase]
  const phaseDetail = operationPhaseDetail(activity.operation, activity.phase)
  const history = useMemo(
    () => activity.history.length > 0
      ? activity.history
      : [{ phase: activity.phase, at: activity.startedAt }],
    [activity.history, activity.phase, activity.startedAt],
  )
  const reasoning = activity.reasoning ?? null
  const reasoningCopy = reasoning ? REASONING_LABELS[reasoning.source] : null
  const { viewportRef, onScroll } = useFollowingScroll(reasoning?.text)
  const rationaleNotes = activity.rationaleNotes ?? []
  const featuredRationale = rationaleNotes.at(-1)
  const earlierRationales = rationaleNotes.slice(0, -1).reverse()
  const rationaleAuthorLabel = /^qwen(?:\d|[.:\s-]|$)/iu.test(modelLabel)
    ? 'Qwen'
    : modelLabel
  const showRationale =
    activity.phase === 'writing-rationale' || rationaleNotes.length > 0

  return (
    <section
      className={`model-activity-panel is-${activity.status}`}
      aria-labelledby={headingId}
      data-activity-operation={activity.operation}
      data-activity-phase={activity.phase}
    >
      <header className="model-activity-panel__header">
        <div className="model-activity-panel__title">
          <BrainCircuit size={21} aria-hidden="true" />
          <div>
            <h3 id={headingId}>Thinking</h3>
            <small>Live activity</small>
          </div>
        </div>
        <time
          className="model-activity-panel__elapsed"
          dateTime={`PT${Math.max(0, Math.floor((endedAt - activity.startedAt) / 1_000))}S`}
          aria-label={`Elapsed time ${elapsedLabel}`}
        >
          {elapsedLabel}
        </time>
      </header>

      <p className="model-activity-panel__provider">
        <Sparkles size={14} aria-hidden="true" />
        <span>{modelLabel} via {providerLabel}</span>
      </p>

      <div className="model-activity-panel__freshness" aria-label="Live connection status">
        <div className={`model-activity-panel__freshness-item ${heartbeatFresh && active ? 'is-fresh' : ''}`}>
          <Radio size={14} aria-hidden="true" />
          <span>
            <strong>{connectionLabel}</strong>
            <small>Heartbeat {formatFreshness(heartbeatAge)}</small>
          </span>
        </div>
        <div className={`model-activity-panel__freshness-item ${activity.lastProviderActivityAt === undefined ? 'is-waiting' : 'is-fresh'}`}>
          <BrainCircuit size={14} aria-hidden="true" />
          <span>
            <strong>{providerActivityLabel}</strong>
            <small>Reasoning appears below as it streams; the structured result waits for validation</small>
          </span>
        </div>
      </div>

      <div className="model-activity-panel__current" aria-busy={active || undefined}>
        <small>Current phase</small>
        <strong>{phaseLabel}</strong>
        <p>{phaseDetail}</p>
        <p className="model-activity-panel__summary">{summary}</p>
      </div>

      {reasoning && reasoningCopy && (
        <section
          className={`reasoning-stream is-${reasoning.source}${active ? ' is-live' : ''}`}
          aria-label={reasoningCopy.title}
          data-reasoning-source={reasoning.source}
        >
          <header className="reasoning-stream__header">
            <span className="reasoning-stream__icon" aria-hidden="true">
              {reasoning.source === 'raw' ? <Cpu size={16} /> : <BrainCircuit size={16} />}
            </span>
            <div>
              <h4>{reasoningCopy.title}</h4>
              <small>{reasoningCopy.caption}</small>
            </div>
            {active && (
              <span className="reasoning-stream__pulse" aria-hidden="true">
                <i /><i /><i />
              </span>
            )}
          </header>

          <p className="reasoning-stream__boundary">{reasoningCopy.boundary}</p>

          <div
            className="reasoning-stream__viewport"
            ref={viewportRef}
            onScroll={onScroll}
            tabIndex={0}
            role="log"
            aria-live="off"
            aria-label={`${reasoningCopy.title} text`}
          >
            <p className="reasoning-stream__text">
              {reasoning.text}
              {active && <span className="reasoning-stream__caret" aria-hidden="true" />}
            </p>
          </div>
        </section>
      )}

      {showRationale && (
        <section
          className={`model-activity-panel__rationale${featuredRationale ? ' has-note' : ' is-waiting'}`}
          aria-label={`${rationaleAuthorLabel} public rationale, written for display`}
        >
        <header className="model-activity-panel__rationale-header">
          <span className="model-activity-panel__rationale-icon" aria-hidden="true">
            <MessageSquareQuote size={16} />
          </span>
          <div>
            <h4>{rationaleAuthorLabel} public rationale</h4>
            <small>Written for display</small>
          </div>
          <span className="model-activity-panel__rationale-count">
            {rationaleNotes.length} {rationaleNotes.length === 1 ? 'note' : 'notes'}
          </span>
        </header>

          <p className="model-activity-panel__rationale-boundary">
            A separate short output {rationaleAuthorLabel} wrote for this display—not a transcript of the primary analysis or private chain-of-thought.
          </p>

        {featuredRationale ? (
          <>
            <article
              className="model-activity-panel__rationale-feature"
              key={`${featuredRationale.at}-${featuredRationale.text}`}
            >
              <small>
                Latest display note · {formatDuration(featuredRationale.at - activity.startedAt)}
              </small>
              <p>{featuredRationale.text}</p>
            </article>
            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              New {rationaleAuthorLabel} public rationale: {featuredRationale.text}
            </p>
            {earlierRationales.length > 0 && (
              <details className="model-activity-panel__rationale-history">
                <summary>
                  Review {earlierRationales.length} earlier display {earlierRationales.length === 1 ? 'note' : 'notes'}
                </summary>
                <ol>
                  {earlierRationales.map((note) => (
                    <li key={`${note.at}-${note.text}`}>
                      <time dateTime={`PT${Math.max(0, Math.floor((note.at - activity.startedAt) / 1_000))}S`}>
                        {formatDuration(note.at - activity.startedAt)}
                      </time>
                      <p>{note.text}</p>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </>
        ) : (
          <div className="model-activity-panel__rationale-empty">
            <span aria-hidden="true"><i /><i /><i /></span>
            <p>Waiting for {rationaleAuthorLabel}’s first display note.</p>
          </div>
        )}
        </section>
      )}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {phaseLabel}. {phaseDetail}
      </p>

      {metrics.length > 0 && (
        <dl className="model-activity-panel__metrics">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <dt>{metric.label}</dt>
              <dd>{metric.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <ol className="model-activity-panel__timeline" aria-label="Model activity timeline">
        {history.map((entry, index) => {
          const current = index === history.length - 1
          return (
            <li
              className={`model-activity-panel__timeline-item ${current ? 'is-current' : 'is-complete'}`}
              key={`${entry.phase}-${entry.at}`}
              aria-current={current ? 'step' : undefined}
            >
              <span className="model-activity-panel__timeline-marker" aria-hidden="true">
                {current && active ? <Radio size={12} /> : <CircleCheck size={12} />}
              </span>
              <span>{PHASE_LABELS[entry.phase]}</span>
              <time
                dateTime={`PT${Math.max(0, Math.floor((entry.at - activity.startedAt) / 1_000))}S`}
                aria-label={`${PHASE_LABELS[entry.phase]} at ${formatDuration(entry.at - activity.startedAt)}`}
              >
                {formatDuration(entry.at - activity.startedAt)}
              </time>
            </li>
          )
        })}
      </ol>

      <p className="model-activity-panel__privacy-note">
        {reasoning
          ? reasoning.source === 'raw'
            ? 'Thinking is streamed from the model running on this machine. Draft output is never shown before it is validated.'
            : 'Reasoning summaries come from the provider and are written for display. Draft output is never shown before it is validated.'
          : 'These are live progress summaries. Draft output is never shown before it is validated.'}
      </p>
    </section>
  )
}
