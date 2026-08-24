import { useEffect, useMemo, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import {
  CalendarClock,
  Check,
  Database,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'

import type {
  WebMemoryIndex,
  WilburAction,
  WilburObservation,
} from '../lib/lifecycle/contracts'

interface WebMemoryPanelProps {
  open: boolean
  memory: WebMemoryIndex | null
  busy: boolean
  error: string
  selectionEnabled: boolean
  selectedObservationIds: readonly string[]
  onClose: () => void
  onRefresh: () => void
  onToggleObservation: (observationId: string) => void
  onUseNextDecision: (observation: WilburObservation) => void
}

const ACTIVE_ACTION_STATUSES = new Set<WilburAction['status']>([
  'planned',
  'in_progress',
  'inconclusive',
])

export function isWilburActionDue(
  action: WilburAction,
  observations: readonly WilburObservation[],
  now = Date.now(),
): boolean {
  if (!action.followUpAt || !ACTIVE_ACTION_STATUSES.has(action.status)) return false
  const followUpAt = Date.parse(action.followUpAt)
  if (!Number.isFinite(followUpAt) || followUpAt > now) return false
  return !observations.some(
    (observation) => Date.parse(observation.observedAt) >= followUpAt,
  )
}

export function countDueWebMemoryActions(
  memory: WebMemoryIndex | null,
  now = Date.now(),
): number {
  return memory?.cases.reduce(
    (count, item) => count + item.actions.filter(({ action, observations }) =>
      isWilburActionDue(action, observations, now),
    ).length,
    0,
  ) ?? 0
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
}

function statusLabel(status: WilburAction['status']): string {
  return status.replace('_', ' ')
}

export function WebMemoryPanel({
  open,
  memory,
  busy,
  error,
  selectionEnabled,
  selectedObservationIds,
  onClose,
  onRefresh,
  onToggleObservation,
  onUseNextDecision,
}: WebMemoryPanelProps) {
  const drawerRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const selected = useMemo(
    () => new Set(selectedObservationIds),
    [selectedObservationIds],
  )
  const carried = useMemo(
    () => new Set(memory?.carriedObservationIds ?? []),
    [memory?.carriedObservationIds],
  )
  const dueCount = countDueWebMemoryActions(memory)
  const observationCount = memory?.cases.reduce(
    (count, item) => count + item.actions.reduce(
      (actionCount, record) => actionCount + record.observations.length,
      0,
    ),
    0,
  ) ?? 0

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    closeButtonRef.current?.focus()
    return () => {
      previousFocusRef.current?.focus()
      previousFocusRef.current = null
    }
  }, [open])

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
    ) ?? [])]
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!open) return null

  return (
    <aside
      className="web-memory-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="web-memory-heading"
      onKeyDown={handleDialogKeyDown}
    >
      <div className="web-memory-panel__scrim" aria-hidden="true" onClick={onClose} />
      <div className="web-memory-panel__drawer" ref={drawerRef}>
        <header className="web-memory-panel__header">
          <span className="web-memory-panel__mark" aria-hidden="true">
            <Database size={20} />
          </span>
          <div>
            <p>Web · accumulated observations</p>
            <h2 id="web-memory-heading">Case memory</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close case memory"
          >
            <X size={18} />
          </button>
        </header>

        <div className="web-memory-panel__summary" aria-live="polite">
          <span><strong>{observationCount}</strong> observations</span>
          <span className={dueCount > 0 ? 'is-due' : ''}>
            <CalendarClock size={14} aria-hidden="true" />
            <strong>{dueCount}</strong> due now
          </span>
          <span><strong>{selected.size}</strong> selected for the next question</span>
          <span><strong>{carried.size}</strong> carried by the current case</span>
        </div>

        <p className="web-memory-panel__explanation">
          Wilbur records what happened after a recommendation. Web keeps that record available
          for later review. Nothing is reused silently: select an observation only when it is
          genuinely relevant to a new question. Anansi and Portia will see it as historical,
          player-recorded evidence—not as a verified fact or proof of causation.
        </p>

        <div className="web-memory-panel__tools">
          <button className="text-button" type="button" onClick={onRefresh} disabled={busy}>
            <RefreshCw size={14} aria-hidden="true" className={busy ? 'is-spinning' : ''} />
            {busy ? 'Refreshing…' : 'Refresh memory'}
          </button>
          {!selectionEnabled ? (
            <span>Start a new question to select prior observations.</span>
          ) : selected.size >= 8 ? (
            <span>Eight-observation safety limit reached.</span>
          ) : (
            <span>Select up to eight observations for Anansi and Portia.</span>
          )}
        </div>

        {error ? <p className="web-memory-panel__error" role="alert">{error}</p> : null}

        <div className="web-memory-cases">
          {memory?.cases.length ? memory.cases.map((item, caseIndex) => (
            <details className="web-memory-case" key={item.gameId} open={caseIndex === 0}>
              <summary>
                <span>
                  <small>{item.isCurrent ? 'Current case' : `Case · ${formatDate(item.createdAt)}`}</small>
                  <strong>{item.problem}</strong>
                </span>
                <span>{item.actions.length} action{item.actions.length === 1 ? '' : 's'}</span>
              </summary>
              <div className="web-memory-case__body">
                {item.actions.map(({ action, observations }) => {
                  const due = isWilburActionDue(action, observations)
                  return (
                    <article className="web-memory-action" key={action.id}>
                      <div className="web-memory-action__heading">
                        <div>
                          <small>{action.actor} · {statusLabel(action.status)}</small>
                          <h3>{action.action}</h3>
                        </div>
                        {due ? <span className="web-memory-due"><CalendarClock size={13} /> Follow-up due</span> : null}
                      </div>
                      <dl>
                        <div><dt>Assumption tested</dt><dd>{action.testedAssumption}</dd></div>
                        <div><dt>Expected signal</dt><dd>{action.expectedObservation}</dd></div>
                        <div><dt>Decision threshold</dt><dd>{action.decisionThreshold}</dd></div>
                        <div><dt>Review horizon</dt><dd>{action.reviewHorizon}</dd></div>
                        <div><dt>Scheduled follow-up</dt><dd>{action.followUpAt ? formatDate(action.followUpAt) : 'Not scheduled'}</dd></div>
                      </dl>
                      {observations.length === 0 ? (
                        <p className="web-memory-empty-observation">
                          No observation has been recorded yet. Return to this case when reality answers back.
                        </p>
                      ) : (
                        <ol className="web-memory-observations">
                          {observations.map((observation) => {
                            const checked = selected.has(observation.id)
                            const carriedByCurrentCase = carried.has(observation.id)
                            const selectionDisabled = !selectionEnabled || (!checked && selected.size >= 8)
                            return (
                              <li key={observation.id}>
                                <div className="web-memory-observation__meta">
                                  <span>{formatDate(observation.observedAt)}</span>
                                  <span>{observation.evidenceClassification}</span>
                                  <span>{observation.assumptionResult}</span>
                                  {carriedByCurrentCase ? (
                                    <span className="is-carried">
                                      <Check size={12} aria-hidden="true" />
                                      Carried by current case
                                    </span>
                                  ) : null}
                                </div>
                                <p>{observation.observation}</p>
                                <dl>
                                  <div><dt>Expected effect</dt><dd>{observation.expectedEffect}</dd></div>
                                  <div><dt>Unexpected effect</dt><dd>{observation.unexpectedEffect}</dd></div>
                                  <div><dt>Stakeholder response</dt><dd>{observation.stakeholderResponse}</dd></div>
                                  <div><dt>Next decision</dt><dd>{observation.nextDecision}</dd></div>
                                </dl>
                                <div className="web-memory-observation__actions">
                                  <label className={checked ? 'is-selected' : ''}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={selectionDisabled}
                                      onChange={() => onToggleObservation(observation.id)}
                                    />
                                    {checked ? <Check size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
                                    {checked ? 'Included in next question' : 'Use as prior evidence'}
                                  </label>
                                  <button
                                    className="text-button"
                                    type="button"
                                    disabled={!selectionEnabled}
                                    onClick={() => onUseNextDecision(observation)}
                                  >
                                    Ask its next decision
                                  </button>
                                </div>
                              </li>
                            )
                          })}
                        </ol>
                      )}
                    </article>
                  )
                })}
              </div>
            </details>
          )) : (
            <div className="web-memory-panel__empty">
              <Database size={28} aria-hidden="true" />
              <h3>The web has no observations yet</h3>
              <p>Complete a game, track one of Wilbur’s actions, and record what happened. That becomes the first reusable case.</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
