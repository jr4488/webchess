import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowRight,
  CircleAlert,
  GitBranch,
  Eye,
  FlaskConical,
  History,
  Play,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type {
  AppendWilburObservationCommand,
} from '../../lib/webchess-api'
import type {
  AssumptionResult,
  LifecycleAggregate,
  WilburAction,
  WilburActionStatus,
} from '../../lib/lifecycle/contracts'
import type {
  CaptureRecord,
  GameOutcome,
  LastMove,
  Piece,
  ProblemPart,
} from '../../types'
import { cellKey } from '../../lib/board'
import { LifecycleRail } from '../LifecycleRail'
import { ProcessGraphic } from '../ProcessGraphic'
import { RadialBoard } from '../RadialBoard'

interface LifecycleStageProps {
  problem: string
  parts: readonly ProblemPart[]
  pieces: readonly Piece[]
  captures: readonly CaptureRecord[]
  lastMove: LastMove | null
  outcome: GameOutcome
  lifecycle: LifecycleAggregate | null
  busy: boolean
  error: string
  actionPendingIndex: number | null
  wilburPending: boolean
  onRefresh: () => void
  onRetry: () => void
  onCreateAction: (index: number) => void
  onUpdateAction: (action: WilburAction, status: WilburActionStatus) => void
  onObserve: (
    action: WilburAction,
    observation: AppendWilburObservationCommand,
  ) => Promise<boolean>
}

const EMPTY_SET = new Set<string>()

function activeHeadline(lifecycle: LifecycleAggregate | null): string {
  if (!lifecycle) return 'Finding the lifecycle thread'
  if (lifecycle.state === 'portia_pending' || lifecycle.state === 'portia_running') {
    return 'Portia is testing every survivor'
  }
  if (lifecycle.state === 'portia_complete') return 'The Gate is checking sufficiency'
  if (lifecycle.state === 'charlotte_pending' || lifecycle.state === 'charlotte_running') {
    return 'Charlotte is weaving a grounded answer'
  }
  if (lifecycle.state === 'gate_failed') return 'The web needs another path'
  if (lifecycle.state === 'retry_ready' || lifecycle.state === 'retry_running') {
    return 'Retry is changing one variable'
  }
  if (lifecycle.state === 'insufficient_basis') return 'The bounded inquiry has reached its limit'
  return 'The lifecycle record is ready'
}

function ObservationForm({
  action,
  pending,
  onObserve,
}: {
  action: WilburAction
  pending: boolean
  onObserve: LifecycleStageProps['onObserve']
}) {
  const [open, setOpen] = useState(false)
  const [observation, setObservation] = useState('')
  const [nextDecision, setNextDecision] = useState('')
  const [assumptionResult, setAssumptionResult] = useState<AssumptionResult>('unresolved')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const accepted = await onObserve(action, {
      observedAt: new Date().toISOString(),
      observation,
      evidenceClassification: 'Direct observation recorded by the player',
      expectedEffect: action.expectedObservation,
      unexpectedEffect: 'No unexpected effect recorded yet.',
      stakeholderResponse: 'No stakeholder response recorded yet.',
      assumptionResult,
      nextDecision,
    })
    if (accepted) {
      setObservation('')
      setNextDecision('')
      setAssumptionResult('unresolved')
      setOpen(false)
    }
  }

  if (!open) {
    return (
      <button
        className="text-button wilbur-observe-button"
        type="button"
        onClick={() => setOpen(true)}
      >
        <Eye size={14} /> Record what happened
      </button>
    )
  }

  return (
    <form className="wilbur-observation-form" onSubmit={submit}>
      <label>
        What did you observe?
        <textarea
          value={observation}
          minLength={3}
          maxLength={4_000}
          required
          onChange={(event) => setObservation(event.target.value)}
        />
      </label>
      <label>
        What should happen next?
        <textarea
          value={nextDecision}
          minLength={3}
          maxLength={2_000}
          required
          onChange={(event) => setNextDecision(event.target.value)}
        />
      </label>
      <label>
        What did this do to the tested assumption?
        <select
          value={assumptionResult}
          onChange={(event) => setAssumptionResult(event.target.value as AssumptionResult)}
        >
          <option value="unresolved">Still unresolved</option>
          <option value="supported">Supported by this observation</option>
          <option value="rejected">Rejected by this observation</option>
        </select>
      </label>
      <div>
        <button className="secondary-button" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Add to the web'}
        </button>
        <button className="text-button" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function LifecycleStage({
  problem,
  parts,
  pieces,
  captures,
  lastMove,
  outcome,
  lifecycle,
  busy,
  error,
  actionPendingIndex,
  wilburPending,
  onRefresh,
  onRetry,
  onCreateAction,
  onUpdateAction,
  onObserve,
}: LifecycleStageProps) {
  const captureKeys = useMemo(
    () => new Set(captures.map((capture) => cellKey(capture.cell))),
    [captures],
  )
  const actionsByIndex = useMemo(
    () => new Map(
      (lifecycle?.wilburActions ?? []).flatMap((action) =>
        action.charlotteActionIndex === null
          ? []
          : [[action.charlotteActionIndex, action] as const],
      ),
    ),
    [lifecycle?.wilburActions],
  )
  const complete = lifecycle?.charlotte !== null && lifecycle?.charlotte !== undefined
  const activeIndices = lifecycle?.survivors.map(
    (candidate) => candidate.finalCoordinate.ring * 8 + candidate.finalCoordinate.sector,
  ) ?? []

  return (
    <section
      className="lifecycle-layout stage-enter"
      data-stage-root
      tabIndex={-1}
      aria-label="WebChess 2.0 lifecycle"
    >
      <header className="lifecycle-heading">
        <p className="eyebrow"><span /> Game complete · Move {outcome.completedTurn}</p>
        <h1>The ending is only<br /><em>the middle of the web.</em></h1>
        <p>{problem}</p>
      </header>

      {lifecycle ? <LifecycleRail lifecycle={lifecycle} /> : null}

      <div className="lifecycle-grid">
        <aside className="lifecycle-board-panel">
          <div className="board-card is-reading">
            <RadialBoard
              parts={parts}
              pieces={pieces}
              stage="reading"
              capturedCellKeys={captureKeys}
              highlightedCellKeys={EMPTY_SET}
              lastMove={lastMove}
              revealParts
              disabled
            />
          </div>
          <dl className="lifecycle-evidence-counts">
            <div><dt>Terminal survivors</dt><dd>{lifecycle?.survivors.length ?? '—'}</dd></div>
            <div><dt>Captured signals</dt><dd>{captures.length}</dd></div>
            <div><dt>Field generation</dt><dd>{lifecycle?.fieldGeneration ?? '—'}</dd></div>
            <div><dt>Game attempt</dt><dd>{lifecycle?.gameAttempt ?? '—'}</dd></div>
          </dl>
        </aside>

        <article className="lifecycle-workspace">
          {error ? (
            <div className="lifecycle-error" role="alert">
              <CircleAlert size={22} />
              <div><strong>The thread snagged.</strong><p>{error}</p></div>
              <button className="secondary-button" type="button" onClick={onRefresh}>
                <RefreshCw size={14} /> Check the saved state
              </button>
            </div>
          ) : null}

          {busy || !lifecycle ? (
            <ProcessGraphic
              mode="answering"
              headline={activeHeadline(lifecycle)}
              active
              activeIndices={activeIndices}
              metrics={[
                { label: 'Survivors', value: lifecycle?.survivors.length ?? '…' },
                { label: 'Portia attacks', value: lifecycle ? lifecycle.survivors.length * 13 : '…' },
                { label: 'Retry budget', value: lifecycle ? `${2 - lifecycle.sameFieldRetryCount} + ${1 - lifecycle.fieldRegenerationCount}` : '…' },
                { label: 'State', value: lifecycle?.state.replaceAll('_', ' ') ?? 'Loading' },
              ]}
            />
          ) : null}

          {lifecycle && (
            lifecycle.parentRunId
            || lifecycle.retryReason
            || lifecycle.sameFieldRetryCount > 0
            || lifecycle.fieldRegenerationCount > 0
          ) ? (
            <section className="lifecycle-card lifecycle-ancestry-card">
              <div className="lifecycle-card__title">
                <span><GitBranch size={17} /></span>
                <div><small>Retry · bounded ancestry</small><h2>This path keeps its history</h2></div>
              </div>
              <p>{lifecycle.retryReason ?? 'This run descends from an earlier saved attempt.'}</p>
              <dl className="lifecycle-ancestry-grid">
                <div><dt>Same-field replays</dt><dd>{lifecycle.sameFieldRetryCount} / 2</dd></div>
                <div><dt>Field regenerations</dt><dd>{lifecycle.fieldRegenerationCount} / 1</dd></div>
                <div><dt>Parent run</dt><dd>{lifecycle.parentRunId?.slice(0, 8) ?? 'Root'}</dd></div>
                <div><dt>Root run</dt><dd>{lifecycle.rootRunId.slice(0, 8)}</dd></div>
              </dl>
            </section>
          ) : null}

          {lifecycle?.portia ? (
            <section className="lifecycle-card portia-card">
              <div className="lifecycle-card__title">
                <span><FlaskConical size={17} /></span>
                <div><small>Portia · adversarial examination</small><h2>What survived scrutiny</h2></div>
              </div>
              <p>{lifecycle.portia.runSummary}</p>
              <div className="portia-dispositions">
                {(['preserved', 'wounded', 'consumed', 'unresolved'] as const).map((disposition) => (
                  <span key={disposition} className={`is-${disposition}`}>
                    <strong>{lifecycle.portia?.assessments.filter((item) => item.disposition === disposition).length ?? 0}</strong>
                    {disposition}
                  </span>
                ))}
              </div>
              <details>
                <summary>Inspect survivor-by-survivor findings</summary>
                <div className="portia-assessments">
                  {lifecycle.portia.assessments.map((assessment) => (
                    <article key={assessment.candidateId}>
                      <small>{assessment.candidateId}</small>
                      <strong>{assessment.disposition}</strong>
                      <p>{assessment.survivingInterpretation ?? assessment.countercase}</p>
                      {assessment.requiredQualification ? <blockquote>{assessment.requiredQualification}</blockquote> : null}
                    </article>
                  ))}
                </div>
              </details>
            </section>
          ) : null}

          {lifecycle?.gate ? (
            <section className={`lifecycle-card gate-card is-${lifecycle.gate.passed ? 'passed' : 'failed'}`}>
              <div className="lifecycle-card__title">
                <span><ShieldCheck size={17} /></span>
                <div><small>Deterministic Gate</small><h2>{lifecycle.gate.passed ? 'The evidence web is sufficient.' : 'This web cannot support an answer yet.'}</h2></div>
              </div>
              <p>{lifecycle.gate.explanation}</p>
              <dl className="gate-metrics">
                <div><dt>Usable</dt><dd>{lifecycle.gate.usableCandidateCount}</dd></div>
                <div><dt>Independent</dt><dd>{lifecycle.gate.independentClusterCount}</dd></div>
                <div><dt>Fatal conflicts</dt><dd>{lifecycle.gate.contradictionResults.fatalUnaddressedIds.length}</dd></div>
              </dl>
              {!lifecycle.gate.passed ? (
                <>
                  <ul>{lifecycle.gate.missingRequirements.map((item) => <li key={item}>{item}</li>)}</ul>
                  <button className="primary-button" type="button" onClick={onRetry}>
                    Try another bounded path <ArrowRight size={16} />
                  </button>
                </>
              ) : null}
            </section>
          ) : null}

          {complete && lifecycle?.charlotte && lifecycle.charlotteRenderedAnswer ? (
            <section className="lifecycle-card charlotte-card">
              <div className="lifecycle-card__title">
                <span><ShieldCheck size={17} /></span>
                <div><small>Charlotte · synthesis</small><h2>A direction that keeps its qualifications</h2></div>
              </div>
              <div className="charlotte-answer">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {lifecycle.charlotteRenderedAnswer}
                </ReactMarkdown>
              </div>
              <div className="charlotte-support">
                <h3>Grounded in Portia's surviving candidates</h3>
                <ul>
                  {lifecycle.charlotte.supportingCandidateIds.map((candidateId) => (
                    <li key={candidateId}>
                      <code>{candidateId}</code>
                      {lifecycle.charlotte?.qualificationsByCandidateId[candidateId] ? (
                        <span>{lifecycle.charlotte.qualificationsByCandidateId[candidateId]}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          {lifecycle?.charlotte ? (
            <section className="lifecycle-card wilbur-card">
              <div className="lifecycle-card__title">
                <span><Play size={17} /></span>
                <div><small>Wilbur · action record</small><h2>Let the web meet reality</h2></div>
              </div>
              <p>Track one of Charlotte’s reversible actions, then return with an observation. The record stays append-only.</p>
              <div className="wilbur-actions">
                {lifecycle.charlotte.exactlyThreeNextActions.map((suggestion, index) => {
                  const action = actionsByIndex.get(index)
                  return (
                    <article key={suggestion.title}>
                      <small>Action {index + 1} · {suggestion.reviewHorizon}</small>
                      <h3>{suggestion.title}</h3>
                      <p>{suggestion.smallestAction}</p>
                      <dl><dt>Watch for</dt><dd>{suggestion.expectedObservation}</dd></dl>
                      {!action ? (
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={actionPendingIndex !== null}
                          onClick={() => onCreateAction(index)}
                        >
                          {actionPendingIndex === index ? 'Adding…' : 'Track with Wilbur'}
                        </button>
                      ) : (
                        <div className="wilbur-tracked">
                          <label className="wilbur-status-control">
                            Status
                            <select
                              value={action.status}
                              disabled={wilburPending}
                              onChange={(event) => onUpdateAction(
                                action,
                                event.target.value as WilburActionStatus,
                              )}
                            >
                              <option value="planned">Planned</option>
                              <option value="in_progress">In progress</option>
                              <option value="completed">Completed</option>
                              <option value="inconclusive">Inconclusive</option>
                              <option value="abandoned">Abandoned</option>
                            </select>
                          </label>
                          <ObservationForm
                            action={action}
                            pending={wilburPending}
                            onObserve={onObserve}
                          />
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}

          {lifecycle?.state === 'insufficient_basis' ? (
            <section className="lifecycle-card insufficient-card">
              <CircleAlert size={22} />
              <h2>Insufficient basis</h2>
              <p>The retry budget is exhausted. WebChess is refusing to manufacture certainty from this field.</p>
            </section>
          ) : null}

          {lifecycle && lifecycle.activities.length > 0 ? (
            <details className="lifecycle-card lifecycle-provenance-card">
              <summary>
                <span><History size={17} /></span>
                <span><small>The Web · durable provenance</small><strong>Inspect the saved activity thread</strong></span>
                <em>{lifecycle.activities.length} events</em>
              </summary>
              <ol>
                {lifecycle.activities.slice().reverse().map((activity) => (
                  <li key={activity.id}>
                    <span className={`is-${activity.status}`} aria-hidden="true" />
                    <div>
                      <strong>{activity.stage} · {activity.activityType.replaceAll('_', ' ')}</strong>
                      <small>
                        #{activity.sequence} · {activity.status} · {activity.stateTo.replaceAll('_', ' ')}
                      </small>
                    </div>
                    <time dateTime={activity.createdAt}>
                      {new Date(activity.createdAt).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ol>
              <p>
                Lifecycle {lifecycle.versions.lifecycle} · Gate {lifecycle.versions.gateAlgorithm}
                {' · '}Event schema {lifecycle.versions.event}
              </p>
            </details>
          ) : null}
        </article>
      </div>
    </section>
  )
}
