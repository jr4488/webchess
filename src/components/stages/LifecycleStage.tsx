import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowRight,
  Bug,
  ChevronDown,
  CircleAlert,
  Copy,
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
  DurableGame,
} from '../../lib/webchess-api'
import { buildPortableAnswerPrompt } from '../../lib/portable-answer-prompt'
import { resolveFullAnswerModelPrompt } from '../../lib/full-answer-model-prompt'
import type {
  AssumptionResult,
  LifecycleAggregate,
  WilburAction,
  WilburActionStatus,
} from '../../lib/lifecycle/contracts'
import { PORTIA_ATTACK_TYPES } from '../../lib/lifecycle/contracts'
import {
  RETRY_LIMITS,
  canReopenInsufficientBasis,
} from '../../lib/lifecycle/retry'
import type {
  CaptureRecord,
  GeneratedAnswer,
  GameOutcome,
  LastMove,
  Piece,
  ProblemPart,
} from '../../types'
import { cellKey } from '../../lib/board'
import { LifecycleRail } from '../LifecycleRail'
import { ProcessGraphic } from '../ProcessGraphic'
import { RadialBoard } from '../RadialBoard'
import {
  ResearchActivityPanel,
  ResearchProvenanceDetails,
} from '../ResearchActivityPanel'

interface LifecycleStageProps {
  problem: string
  parts: readonly ProblemPart[]
  pieces: readonly Piece[]
  captures: readonly CaptureRecord[]
  lastMove: LastMove | null
  outcome: GameOutcome
  game: DurableGame | null
  lifecycle: LifecycleAggregate | null
  gameStatus: 'completed' | 'answering' | 'answer_failed' | 'answered'
  boardAnswer: GeneratedAnswer | null
  busy: boolean
  error: string
  actionPendingIndex: number | null
  wilburPending: boolean
  onRefresh: () => void
  onRetry: () => void
  onRetryAnswer: () => void
  onCreateAction: (index: number) => void
  onUpdateAction: (action: WilburAction, status: WilburActionStatus) => void
  onObserve: (
    action: WilburAction,
    observation: AppendWilburObservationCommand,
  ) => Promise<boolean>
}

const EMPTY_SET = new Set<string>()

function copyWithDomFallback(text: string): boolean {
  const textarea = document.createElement('textarea')
  const priorFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  textarea.value = text
  textarea.readOnly = true
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.inset = '0 auto auto -9999px'
  textarea.style.opacity = '0'
  document.body.append(textarea)

  try {
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    return typeof document.execCommand === 'function' && document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
    priorFocus?.focus()
  }
}

async function copyText(text: string): Promise<boolean> {
  if (window.navigator.clipboard?.writeText) {
    try {
      await window.navigator.clipboard.writeText(text)
      return true
    } catch {
      // Clipboard permission can be unavailable even on a secure local origin.
      // Keep the user gesture useful with the older DOM copy path.
    }
  }
  return copyWithDomFallback(text)
}

function hasInsufficientBasis(lifecycle: LifecycleAggregate | null): boolean {
  return lifecycle?.state === 'insufficient_basis'
    || (
      lifecycle?.gate?.passed === false
      && lifecycle.gate.recommendedNextTransition === 'insufficient_basis'
    )
}

function activeHeadline(
  lifecycle: LifecycleAggregate | null,
  gameStatus: LifecycleStageProps['gameStatus'],
): string {
  if (!lifecycle) return 'Finding the lifecycle thread'
  if (lifecycle.state === 'portia_unavailable') {
    return 'Portia reached its bounded validation limit'
  }
  if (lifecycle.state === 'charlotte_unavailable') {
    return 'Charlotte reached its bounded qualification limit'
  }
  if (canReopenInsufficientBasis(lifecycle)) {
    return 'The web can repair this evidence path'
  }
  if (hasInsufficientBasis(lifecycle)) return 'The bounded inquiry has reached its limit'
  if (lifecycle.state === 'portia_pending' || lifecycle.state === 'portia_running') {
    return 'Portia is testing every survivor'
  }
  if (lifecycle.state === 'portia_complete') return 'The Gate is checking sufficiency'
  if (lifecycle.state === 'gate_passed' && gameStatus !== 'answered') {
    if (gameStatus === 'answer_failed') {
      return 'The approved prompt is waiting for a fresh Answer attempt'
    }
    return gameStatus === 'answering'
      ? 'The approved board prompt is generating the answer'
      : 'The board-derived answer is ready to generate'
  }
  if (lifecycle.state === 'gate_passed' && gameStatus === 'answered') {
    return 'Charlotte is checking truthfulness and audience fit'
  }
  if (lifecycle.state === 'charlotte_pending' || lifecycle.state === 'charlotte_running') {
    return 'Charlotte is qualifying the generated answer'
  }
  if (lifecycle.state === 'gate_failed') return 'The web needs another path'
  if (lifecycle.state === 'retry_ready' || lifecycle.state === 'retry_running') {
    return 'Retry is changing one variable'
  }
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
  game,
  lifecycle,
  gameStatus,
  boardAnswer,
  busy,
  error,
  actionPendingIndex,
  wilburPending,
  onRefresh,
  onRetry,
  onRetryAnswer,
  onCreateAction,
  onUpdateAction,
  onObserve,
}: LifecycleStageProps) {
  const [portableCopyFeedback, setPortableCopyFeedback] = useState<{
    key: string
    status: 'copying' | 'success' | 'error'
  } | null>(null)
  const [fullPromptCopyFeedback, setFullPromptCopyFeedback] = useState<{
    key: string
    status: 'copying' | 'success' | 'error'
  } | null>(null)
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
  const charlotteQualificationUnavailable = Boolean(
    lifecycle?.state === 'charlotte_unavailable',
  )
  const charlotteComplete = Boolean(
    !charlotteQualificationUnavailable && lifecycle?.charlotte,
  )
  const researchRecords = lifecycle?.research ?? []
  const portablePrompt = useMemo(() => {
    if (!game || !lifecycle?.answerUserPrompt) return null
    try {
      return buildPortableAnswerPrompt(game, lifecycle)
    } catch {
      return null
    }
  }, [game, lifecycle])
  const portableCopyKey = portablePrompt && game && lifecycle
    ? `${game.id}:${game.revision}:${lifecycle.answerUserPromptSha256 ?? lifecycle.id}`
    : null
  const portableCopyStatus = portableCopyFeedback?.key === portableCopyKey
    ? portableCopyFeedback.status
    : null
  const fullModelPromptArtifact = useMemo(
    () => resolveFullAnswerModelPrompt(boardAnswer),
    [boardAnswer],
  )
  const fullModelPrompt = fullModelPromptArtifact?.prompt ?? null
  const fullPromptCopyKey = fullModelPrompt && game
    ? `${game.id}:${game.revision}:${boardAnswer?.model ?? 'answer'}:${fullModelPrompt.length}`
    : null
  const fullPromptCopyStatus = fullPromptCopyFeedback?.key === fullPromptCopyKey
    ? fullPromptCopyFeedback.status
    : null
  const insufficientBasis = hasInsufficientBasis(lifecycle)
  const recoverableInsufficientBasis = lifecycle
    ? canReopenInsufficientBasis(lifecycle)
    : false
  const portiaValidationUnavailable = Boolean(
    lifecycle?.state === 'portia_unavailable',
  )
  const portiaTerminalStop = (
    insufficientBasis && !recoverableInsufficientBasis
  ) || portiaValidationUnavailable
  const stableTerminal = portiaTerminalStop || charlotteQualificationUnavailable
  const retryPending = busy || lifecycle?.state === 'retry_running'
  const canRetry = Boolean(
    lifecycle?.gate?.passed === false
    && (
      recoverableInsufficientBasis
      || (
        !insufficientBasis
        && (
          lifecycle.gate.recommendedNextTransition === 'retry_game'
          || lifecycle.gate.recommendedNextTransition === 'retry_field'
        )
      )
    ),
  )
  const remainingSameFieldRetries = lifecycle
    ? Math.max(0, RETRY_LIMITS.sameFieldReplays - lifecycle.sameFieldRetryCount)
    : null
  const remainingFieldRegenerations = lifecycle
    ? Math.max(0, RETRY_LIMITS.fieldRegenerations - lifecycle.fieldRegenerationCount)
    : null
  const authorizedSameFieldPaths = portiaTerminalStop || recoverableInsufficientBasis
    ? 0
    : remainingSameFieldRetries
  const authorizedFieldRebuilds = portiaTerminalStop ? 0 : remainingFieldRegenerations
  const activeIndices = lifecycle?.survivors.map(
    (candidate) => candidate.finalCoordinate.ring * 8 + candidate.finalCoordinate.sector,
  ) ?? []
  const currentPortiaCandidate = lifecycle?.state === 'portia_running'
    ? lifecycle.survivors.find(
        (candidate) => candidate.candidateId === lifecycle.portiaProgress.currentCandidateId,
      ) ?? null
    : null
  const reviewedPortiaCandidates = lifecycle
    ? new Set(lifecycle.portiaProgress.completedCandidateIds)
    : EMPTY_SET
  const portiaComplete = Boolean(
    lifecycle?.portia &&
    lifecycle.state !== 'portia_pending' &&
    lifecycle.state !== 'portia_running',
  )
  const portiaPromptRevisionCount = lifecycle?.portia?.assessments.reduce(
    (count, assessment) => count + assessment.attackFindings.filter(
      (finding) => finding.requiredRevision !== null,
    ).length,
    0,
  ) ?? 0
  const promptBoundPortia = lifecycle?.portia &&
    'promptDecision' in lifecycle.portia
    ? lifecycle.portia
    : null
  const researchPortiaAdjudication = researchRecords.some(
    (record) => record.stage === 'portia',
  ) ? {
      status: lifecycle?.state === 'portia_unavailable'
        ? 'unavailable' as const
        : lifecycle?.state === 'portia_running'
          ? 'reviewing' as const
          : promptBoundPortia
            ? 'completed' as const
            : 'pending' as const,
      decision: promptBoundPortia?.promptDecision ?? null,
      rationale: promptBoundPortia?.promptDecisionRationale ?? null,
      reviewedPromptDigest:
        promptBoundPortia?.reviewedAnswerPromptDigest ?? null,
      currentPromptDigest: lifecycle?.answerPromptDigest ?? null,
      requiredAmendmentCount: portiaPromptRevisionCount,
    } : null
  const portiaReviewedCellKeys = lifecycle?.survivors
    .filter((candidate) =>
      portiaComplete || reviewedPortiaCandidates.has(candidate.candidateId),
    )
    .map((candidate) => cellKey(candidate.finalCoordinate)) ?? []
  const portiaActivity = lifecycle && (
    lifecycle.state === 'chess_terminal' ||
    lifecycle.state === 'portia_pending' ||
    lifecycle.state === 'portia_running' ||
    lifecycle.state === 'portia_unavailable' ||
    lifecycle.portia !== null
  ) ? {
      status: lifecycle.state === 'portia_unavailable'
        ? 'unavailable' as const
        : portiaComplete
        ? 'complete' as const
        : lifecycle.state === 'portia_running' && currentPortiaCandidate
          ? 'running' as const
          : lifecycle.state === 'portia_running' &&
              lifecycle.portiaProgress.completedCandidateIds.length === lifecycle.survivors.length
            ? 'summarizing' as const
            : 'waiting' as const,
      currentCell: currentPortiaCandidate?.finalCoordinate ?? null,
      currentLabel: currentPortiaCandidate
        ? `${currentPortiaCandidate.facet.title}: ${currentPortiaCandidate.facet.focus}`
        : null,
      reviewedCellKeys: portiaReviewedCellKeys,
      announcement: lifecycle.state === 'portia_unavailable'
        ? `Portia could not complete prompt validation after ${lifecycle.portiaFailedAttemptCount} provider attempts. ${lifecycle.portiaProgress.completedCandidateIds.length} of ${lifecycle.survivors.length} board signals have saved reviews; no answer was generated.`
        : portiaComplete
        ? `Portia completed the review of ${lifecycle.survivors.length} board signals.`
        : currentPortiaCandidate
          ? `Portia is reviewing signal ${lifecycle.portiaProgress.completedCandidateIds.length + 1} of ${lifecycle.survivors.length} with all ${PORTIA_ATTACK_TYPES.length} truthfulness, relevance, and usefulness checks.`
          : lifecycle.state === 'portia_running'
            ? 'Portia finished the individual signals and is deciding whether the candidate answer prompt may proceed.'
            : 'Portia is preparing to review the board-derived candidate answer prompt.',
    } : undefined
  const copyPortablePrompt = async () => {
    if (!portablePrompt || !portableCopyKey) return
    setPortableCopyFeedback({ key: portableCopyKey, status: 'copying' })
    const copied = await copyText(portablePrompt)
    setPortableCopyFeedback({
      key: portableCopyKey,
      status: copied ? 'success' : 'error',
    })
  }
  const copyFullModelPrompt = async () => {
    if (!fullModelPrompt || !fullPromptCopyKey) return
    setFullPromptCopyFeedback({ key: fullPromptCopyKey, status: 'copying' })
    const copied = await copyText(fullModelPrompt)
    setFullPromptCopyFeedback({
      key: fullPromptCopyKey,
      status: copied ? 'success' : 'error',
    })
  }

  return (
    <section
      className="lifecycle-layout stage-enter"
      data-stage-root
      tabIndex={-1}
      aria-label="WebChess 2.1 lifecycle"
    >
      <header className="lifecycle-heading">
        <p className="eyebrow"><span /> Game complete · Move {outcome.completedTurn}</p>
        <h1>The ending is only<br /><em>the middle of the web.</em></h1>
        <p>{problem}</p>
      </header>

      {lifecycle ? <LifecycleRail lifecycle={lifecycle} gameStatus={gameStatus} /> : null}

      <div className="lifecycle-grid">
        <aside className="lifecycle-board-panel">
          <div className="board-card is-reading">
            <RadialBoard
              parts={parts}
              pieces={pieces}
              stage="reading"
              capturedCellKeys={captureKeys}
              highlightedCellKeys={EMPTY_SET}
              portiaActivity={portiaActivity}
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

          {lifecycle?.gate?.passed && gameStatus === 'answer_failed' && !boardAnswer ? (
            <section
              className="lifecycle-card answer-failed-card"
              role="alert"
              aria-labelledby="answer-failed-heading"
            >
              <div className="lifecycle-card__title">
                <span><CircleAlert size={17} /></span>
                <div>
                  <small>Answer · saved technical stop</small>
                  <h2 id="answer-failed-heading">The Answer response could not be accepted</h2>
                </div>
              </div>
              <p>
                Portia approved the board-derived prompt and the Gate passed. The Answer
                model response did not satisfy WebChess’s required output contract, so the
                board, prompt, and approval record were preserved without publishing a
                malformed answer.
              </p>
              <p>
                Automatic retries have stopped. Start one fresh Answer attempt when you are
                ready; it will reuse the approved prompt with a new request identity.
              </p>
              <button
                className="primary-button"
                type="button"
                disabled={busy}
                aria-busy={busy}
                onClick={onRetryAnswer}
              >
                <RefreshCw size={15} aria-hidden="true" />
                {busy ? 'Trying the answer again…' : 'Try the answer again'}
              </button>
            </section>
          ) : null}

          <ResearchActivityPanel
            records={researchRecords}
            portiaAdjudication={researchPortiaAdjudication}
          />

          {(busy || !lifecycle) && !stableTerminal ? (
            <ProcessGraphic
              mode="answering"
              headline={activeHeadline(lifecycle, gameStatus)}
              active
              activeIndices={activeIndices}
              metrics={[
                { label: 'Survivors', value: lifecycle?.survivors.length ?? '…' },
                {
                  label: 'Signals reviewed',
                  value: lifecycle
                    ? `${lifecycle.portiaProgress.completedCandidateIds.length}/${lifecycle.survivors.length}`
                    : '…',
                },
                {
                  label: 'Root retry budget',
                  value: lifecycle
                    ? `${remainingSameFieldRetries} replay · ${remainingFieldRegenerations} field`
                    : '…',
                },
                { label: 'State', value: lifecycle?.state.replaceAll('_', ' ') ?? 'Loading' },
              ]}
            />
          ) : null}

          {lifecycle?.state === 'portia_running' ? (
            <section className="lifecycle-card portia-progress-card">
              <div className="lifecycle-card__title">
                <span><Bug size={17} /></span>
                <div>
                  <small>Portia · live prompt validation</small>
                  <h2>
                    {currentPortiaCandidate
                      ? `Reviewing signal ${lifecycle.portiaProgress.completedCandidateIds.length + 1} of ${lifecycle.survivors.length}`
                      : 'Making the prompt decision'}
                  </h2>
                </div>
              </div>
              {currentPortiaCandidate ? (
                <>
                  <strong>{currentPortiaCandidate.facet.title}</strong>
                  <p>{currentPortiaCandidate.facet.focus}</p>
                  <small>
                    All {PORTIA_ATTACK_TYPES.length} checks are running on this signal:
                    truthfulness, relevance, evidence, risk, and practical use.
                  </small>
                </>
              ) : (
                <p>
                  Every signal has been checked. Portia is now deciding whether to permit,
                  retry, or deny the exact board-derived answer prompt.
                </p>
              )}
            </section>
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
                <div>
                  <dt>Same-field replays left (root)</dt>
                  <dd>{remainingSameFieldRetries} / {RETRY_LIMITS.sameFieldReplays}</dd>
                </div>
                <div>
                  <dt>Field rebuilds left (root)</dt>
                  <dd>{remainingFieldRegenerations} / {RETRY_LIMITS.fieldRegenerations}</dd>
                </div>
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
            <section className={`lifecycle-card gate-card is-${lifecycle.gate.passed ? 'passed' : portiaTerminalStop ? 'terminal' : 'failed'}`}>
              <div className="lifecycle-card__title">
                <span><ShieldCheck size={17} /></span>
                <div>
                  <small>Deterministic Gate{portiaTerminalStop ? ' · bounded conclusion' : recoverableInsufficientBasis ? ' · repair available' : ''}</small>
                  <h2>
                    {lifecycle.gate.passed
                      ? 'Portia permits the candidate answer prompt.'
                      : portiaTerminalStop
                        ? 'The Gate reached a bounded stop.'
                        : recoverableInsufficientBasis
                          ? 'This prompt has one bounded repair path.'
                        : 'This prompt cannot support an answer yet.'}
                  </h2>
                </div>
              </div>
              <p>
                {recoverableInsufficientBasis
                  ? 'This saved conclusion stopped before using its field-rebuild allowance. WebChess can now rebuild the evidence field with Portia and Gate feedback instead of discarding the run.'
                  : lifecycle.gate.explanation}
              </p>
              {lifecycle.gate.passed && portiaPromptRevisionCount > 0 ? (
                <p>
                  Portia’s {portiaPromptRevisionCount} required prompt amendment{portiaPromptRevisionCount === 1 ? '' : 's'} will be applied during Answer generation.
                </p>
              ) : null}
              <dl className="gate-metrics">
                <div><dt>Usable</dt><dd>{lifecycle.gate.usableCandidateCount}</dd></div>
                <div><dt>Independent</dt><dd>{lifecycle.gate.independentClusterCount}</dd></div>
                <div><dt>Fatal conflicts</dt><dd>{lifecycle.gate.contradictionResults.fatalUnaddressedIds.length}</dd></div>
              </dl>
              {!lifecycle.gate.passed ? (
                <>
                  <ul>{lifecycle.gate.missingRequirements.map((item) => <li key={item}>{item}</li>)}</ul>
                  {canRetry ? (
                    <button
                      className="primary-button"
                      type="button"
                      disabled={retryPending}
                      aria-busy={retryPending}
                      onClick={onRetry}
                    >
                      {retryPending
                        ? 'Starting next bounded path…'
                        : recoverableInsufficientBasis
                          ? 'Try a bounded evidence repair'
                          : 'Try another bounded path'}
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          {lifecycle?.gate?.passed && lifecycle.answerUserPrompt ? (
            <details className="lifecycle-card answer-prompt-disclosure">
              <summary>
                <span aria-hidden="true"><Eye size={17} /></span>
                <span>
                  <small>Portia → Answer · exact handoff</small>
                  <strong>Inspect player-visible Answer input</strong>
                </span>
                <ChevronDown
                  className="answer-prompt-disclosure__chevron"
                  size={17}
                  aria-hidden="true"
                />
              </summary>
              <div className="answer-prompt-disclosure__body">
                <p className="answer-prompt-disclosure__boundary">
                  This is the exact player-visible prompt WebChess sent to compute the
                  board-derived Answer after Portia’s review. Provider system and developer
                  instructions, credentials, and private model reasoning are excluded.
                </p>
                {lifecycle.answerUserPromptSha256 ? (
                  <p className="answer-prompt-disclosure__digest">
                    <span>Prompt SHA-256</span>
                    <code>{lifecycle.answerUserPromptSha256}</code>
                  </p>
                ) : null}
                <p className="answer-prompt-disclosure__label">
                  <strong>Exact persisted Answer input</strong>
                  <span>The JSON below is shown byte-for-byte as it was saved for this run.</span>
                </p>
                <div
                  className="answer-prompt-disclosure__prompt"
                  role="region"
                  aria-label="Exact player-visible prompt sent to Answer"
                >
                  <pre><code>{lifecycle.answerUserPrompt}</code></pre>
                </div>
                {portablePrompt ? (
                  <div className="answer-prompt-disclosure__portable">
                    <div>
                      <strong>Portable prompt</strong>
                      <p id={`portable-answer-prompt-description-${lifecycle.id}`}>
                        The copy includes the original question, all 64 mapped squares, the
                        final board, the full replay with moves and captures, Portia’s final
                        analysis, Gate and visible research context, and the exact approved
                        input. It excludes hidden provider controls, credentials, system and
                        developer prompts, and response schemas.
                      </p>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={portableCopyStatus === 'copying'}
                      aria-describedby={`portable-answer-prompt-description-${lifecycle.id}`}
                      onClick={() => void copyPortablePrompt()}
                    >
                      <Copy size={14} aria-hidden="true" />
                      {portableCopyStatus === 'copying'
                        ? 'Copying portable prompt…'
                        : 'Copy portable prompt'}
                    </button>
                    <p
                      className={`answer-prompt-disclosure__copy-status${
                        portableCopyStatus ? ` is-${portableCopyStatus}` : ''
                      }`}
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {portableCopyStatus === 'success'
                        ? 'Portable prompt copied to the clipboard.'
                        : portableCopyStatus === 'error'
                          ? 'The portable prompt could not be copied. Check clipboard permission and try again.'
                          : ''}
                    </p>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}

          {lifecycle?.gate?.passed && fullModelPromptArtifact ? (
            <details className="lifecycle-card answer-prompt-disclosure answer-prompt-disclosure--full">
              <summary>
                <span aria-hidden="true"><Eye size={17} /></span>
                <span>
                  <small>Answer · exact model request</small>
                  <strong>Inspect full model prompt sent to Answer</strong>
                </span>
                <ChevronDown
                  className="answer-prompt-disclosure__chevron"
                  size={17}
                  aria-hidden="true"
                />
              </summary>
              <div className="answer-prompt-disclosure__body">
                <p className="answer-prompt-disclosure__boundary">
                  {fullModelPromptArtifact.kind === 'openclaw' ? (
                    fullModelPromptArtifact.upgradedLegacyOpenClawPrompt
                      ? 'This completed run predates role-envelope persistence. WebChess has combined its exact saved OpenClaw user prompt with the fixed system role used by this installed local runtime, without changing either role’s content. The result includes the leading system/application instructions and template, completed player, board, Portia, and Gate context, and output-format contract.'
                      : 'This is the exact role-separated prompt content persisted from the local OpenClaw Answer turn: OpenClaw’s system role plus WebChess’s complete user role containing the application instructions and template, completed player, board, Portia, and Gate context, and output-format contract.'
                  ) : (
                    'This is the exact secret-free projection of the hosted Answer request’s separate instructions, input, and structured-output format fields, preserved without flattening them into a portable approximation.'
                  )}{' '}
                  Credentials, tokens, request headers, unrelated runtime metadata, and
                  private model reasoning are not part of this disclosure.
                </p>
                <p className="answer-prompt-disclosure__label">
                  <strong>
                    {fullModelPromptArtifact.upgradedLegacyOpenClawPrompt
                      ? 'Exact full model prompt assembled from preserved roles'
                      : 'Exact persisted full model prompt'}
                  </strong>
                  <span>{fullModelPromptArtifact.prompt.length.toLocaleString()} characters, shown byte-for-byte.</span>
                </p>
                <div
                  className="answer-prompt-disclosure__prompt"
                  role="region"
                  aria-label="Full model prompt sent to Answer"
                >
                  <pre><code>{fullModelPromptArtifact.prompt}</code></pre>
                </div>
                <div className="answer-prompt-disclosure__copy">
                  <div>
                    <strong>Copy the exact model prompt</strong>
                    <p id={`full-answer-model-prompt-description-${lifecycle.id}`}>
                      Copies the same complete, secret-free prompt shown above without
                      converting it into the separate portable prompt.
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={fullPromptCopyStatus === 'copying'}
                    aria-describedby={`full-answer-model-prompt-description-${lifecycle.id}`}
                    onClick={() => void copyFullModelPrompt()}
                  >
                    <Copy size={14} aria-hidden="true" />
                    {fullPromptCopyStatus === 'copying'
                      ? 'Copying full model prompt…'
                      : 'Copy full model prompt'}
                  </button>
                  <p
                    className={`answer-prompt-disclosure__copy-status${
                      fullPromptCopyStatus ? ` is-${fullPromptCopyStatus}` : ''
                    }`}
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {fullPromptCopyStatus === 'success'
                      ? 'Full model prompt copied to the clipboard.'
                      : fullPromptCopyStatus === 'error'
                        ? 'The full model prompt could not be copied. Check clipboard permission and try again.'
                        : ''}
                  </p>
                </div>
              </div>
            </details>
          ) : null}

          {boardAnswer ? (
            <section className="lifecycle-card board-answer-card">
              <div className="lifecycle-card__title">
                <span><FlaskConical size={17} /></span>
                <div>
                  <small>Answer · generated from approved board weights</small>
                  <h2>The substantive board-derived answer</h2>
                </div>
              </div>
              <p className="board-answer-provenance">
                Generated only after Portia reviewed the candidate prompt and the Gate permitted it.
              </p>
              <div className="charlotte-answer">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {boardAnswer.answer}
                </ReactMarkdown>
              </div>
            </section>
          ) : null}

          {charlotteQualificationUnavailable ? (
            <section
              className="lifecycle-card charlotte-unavailable-card"
              role="status"
              aria-labelledby="charlotte-unavailable-heading"
            >
              <div className="lifecycle-card__title">
                <span><CircleAlert size={17} /></span>
                <div>
                  <small>Charlotte · bounded operational stop</small>
                  <h2 id="charlotte-unavailable-heading">
                    Charlotte qualification is unavailable
                  </h2>
                </div>
              </div>
              <p>
                Charlotte could not complete the audience and truthfulness review after{' '}
                {lifecycle?.charlotteFailedAttemptCount ?? 3} of{' '}
                {lifecycle?.charlotteFailureLimit ?? 3} bounded provider attempts.
              </p>
              <p>
                The substantive board-derived Answer above remains available exactly as
                generated from Portia’s approved prompt, but it is not Charlotte-qualified.
                No Wilbur actions were issued from an unqualified answer.
              </p>
              <dl
                className="charlotte-unavailable-summary"
                aria-label="Charlotte qualification status"
              >
                <div>
                  <dt>Attempt budget</dt>
                  <dd>
                    {lifecycle?.charlotteFailedAttemptCount ?? 3} /{' '}
                    {lifecycle?.charlotteFailureLimit ?? 3} used
                  </dd>
                </div>
                <div><dt>Answer status</dt><dd>Generated · not qualified</dd></div>
              </dl>
            </section>
          ) : null}

          {charlotteComplete && lifecycle?.charlotte && lifecycle.charlotteRenderedAnswer ? (
            <section
              className="lifecycle-card charlotte-card"
              aria-labelledby="charlotte-qualified-heading"
            >
              <div className="lifecycle-card__title">
                <span><ShieldCheck size={17} /></span>
                <div>
                  <small>Charlotte · truthfulness and audience review</small>
                  <h2 id="charlotte-qualified-heading">
                    The answer, qualified for people and action
                  </h2>
                </div>
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

          {lifecycle?.charlotte && !charlotteQualificationUnavailable ? (
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

          {portiaTerminalStop ? (
            <section
              className="lifecycle-card insufficient-card"
              role="status"
              aria-labelledby="insufficient-basis-heading"
            >
              <ShieldCheck size={24} aria-hidden="true" />
              <small>Complete outcome · safety preserved</small>
              <h2 id="insufficient-basis-heading">
                {portiaValidationUnavailable
                  ? 'Inquiry complete: prompt validation unavailable'
                  : 'Inquiry complete: insufficient basis'}
              </h2>
              {portiaValidationUnavailable ? (
                <p>
                  This is a bounded technical stop, not a stalled game. Portia preserved each
                  completed signal check but could not finish validating the candidate prompt
                  after {lifecycle?.portiaFailedAttemptCount ?? 3} of its{' '}
                  {lifecycle?.portiaFailureLimit ?? 3} provider attempts. No prompt was
                  permitted and no substantive answer was generated.
                </p>
              ) : (
                <p>
                  This is a valid WebChess conclusion, not a stalled game. The candidate prompt
                  did not meet Portia and the Gate’s floor across the permitted root-wide paths,
                  so no substantive answer was generated.
                </p>
              )}
              <dl
                className="insufficient-budget"
                aria-label={portiaValidationUnavailable
                  ? 'Further paths authorized after the Portia validation stop'
                  : 'Further paths authorized after the Gate stop'}
              >
                <div>
                  <dt>Further same-field paths</dt>
                  <dd>
                    {authorizedSameFieldPaths} authorized · {portiaValidationUnavailable
                      ? 'Portia stop'
                      : 'Gate stop'}
                  </dd>
                </div>
                <div>
                  <dt>Further field rebuilds</dt>
                  <dd>
                    {authorizedFieldRebuilds} authorized · {portiaValidationUnavailable
                      ? 'Portia stop'
                      : 'Gate stop'}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}

          {lifecycle && (lifecycle.activities.length > 0 || researchRecords.length > 0) ? (
            <details className="lifecycle-card lifecycle-provenance-card">
              <summary>
                <span><History size={17} /></span>
                <span><small>The Web · durable provenance</small><strong>Inspect the saved activity thread</strong></span>
                <em>
                  {lifecycle.activities.length} events · {researchRecords.length} research
                </em>
              </summary>
              {lifecycle.activities.length > 0 ? (
                <ol aria-label="Lifecycle events">
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
              ) : null}
              <ResearchProvenanceDetails records={researchRecords} />
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
