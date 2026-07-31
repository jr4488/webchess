import { useEffect, useId, useState } from 'react'
import {
  BrainCircuit,
  Sparkles,
} from 'lucide-react'

import type { WebChessProviderKind } from '../lib/hosted-provider'
import type { ModelActivityState } from '../types'

export interface ModelActivityMetric {
  label: string
  value: string | number
}

interface ModelActivityPanelProps {
  activity: ModelActivityState
  modelLabel: string
  providerLabel: string
  runtimeKind?: WebChessProviderKind
  summary: string
  metrics?: readonly ModelActivityMetric[]
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function requestDetail(
  activity: ModelActivityState,
  runtimeKind: WebChessProviderKind,
): string {
  if (activity.status === 'error') {
    return 'The request ended without a validated result. The error below describes what can be tried next.'
  }
  if (runtimeKind === 'openclaw') {
    return activity.operation === 'division'
      ? 'Waiting for the loopback-only WebChess process to ask your configured OpenClaw model for exactly 64 facets and validate the completed structure.'
      : 'Waiting for the loopback-only WebChess process to replay the completed game, derive the captured record, and validate the completed answer.'
  }
  return activity.operation === 'division'
    ? 'Waiting for the authenticated server to apply durable controls, request exactly 64 facets, and validate the completed structure.'
    : 'Waiting for the authenticated server to replay the completed game, derive the captured record, and validate the completed answer.'
}

export function ModelActivityPanel({
  activity,
  modelLabel,
  providerLabel,
  runtimeKind = 'hosted',
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

  const endedAt = activity.status === 'error'
    ? activity.lastUpdatedAt
    : Math.max(clockNow, activity.startedAt)
  const elapsedLabel = formatDuration(endedAt - activity.startedAt)
  const statusLabel =
    activity.status === 'error' ? 'Request ended' : 'Request in progress'
  const detail = requestDetail(activity, runtimeKind)

  return (
    <section
      className={`model-activity-panel is-${activity.status}`}
      aria-labelledby={headingId}
      aria-busy={active || undefined}
      data-activity-operation={activity.operation}
    >
      <header className="model-activity-panel__header">
        <div className="model-activity-panel__title">
          <BrainCircuit size={21} aria-hidden="true" />
          <div>
            <h3 id={headingId}>Model request</h3>
            <small>Elapsed request time</small>
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

      <div className="model-activity-panel__current">
        <small>Status</small>
        <strong>{statusLabel}</strong>
        <p>{detail}</p>
        <p className="model-activity-panel__summary">{summary}</p>
      </div>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusLabel}. {detail}
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

      <p className="model-activity-panel__privacy-note">
        The browser shows elapsed request time and, when complete, the validated
        structured result. Private chain-of-thought and unvalidated drafts are
        not exposed.
      </p>
    </section>
  )
}
