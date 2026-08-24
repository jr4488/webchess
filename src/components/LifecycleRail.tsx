import {
  Bug,
  Check,
  CircleDot,
  FileText,
  Sparkles,
  Swords,
  Target,
  Webhook,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

import type {
  LifecycleAggregate,
  LifecycleState,
} from '../lib/lifecycle/contracts'
import { canReopenInsufficientBasis } from '../lib/lifecycle/retry'

type StageStatus = 'waiting' | 'active' | 'complete' | 'failed' | 'terminal'
type AnswerGameStatus = 'completed' | 'answering' | 'answer_failed' | 'answered'

interface LifecycleStageDefinition {
  key: string
  label: string
  detail: string
  icon: LucideIcon
}

const STAGES: readonly LifecycleStageDefinition[] = [
  { key: 'anansi', label: 'Anansi', detail: 'weaves 64 signals', icon: Sparkles },
  { key: 'chess', label: 'Chess', detail: 'weights the board', icon: Swords },
  { key: 'portia', label: 'Portia', detail: 'validates the prompt', icon: Bug },
  { key: 'answer', label: 'Answer', detail: 'generates from the board', icon: FileText },
  { key: 'charlotte', label: 'Charlotte', detail: 'qualifies for people', icon: Webhook },
  { key: 'wilbur', label: 'Wilbur', detail: 'records action', icon: Target },
  { key: 'web', label: 'Web', detail: 'preserves outcomes', icon: CircleDot },
]

const STATE_STAGE: Record<LifecycleState, number> = {
  anansi_pending: 0,
  anansi_running: 0,
  field_ready: 1,
  chess_ready: 1,
  chess_playing: 1,
  chess_terminal: 2,
  portia_pending: 2,
  portia_running: 2,
  portia_unavailable: 2,
  portia_complete: 2,
  gate_passed: 3,
  gate_failed: 2,
  retry_ready: 2,
  retry_running: 2,
  charlotte_pending: 4,
  charlotte_running: 4,
  charlotte_unavailable: 4,
  charlotte_complete: 5,
  wilbur_planning: 5,
  wilbur_in_progress: 5,
  wilbur_observed: 6,
  insufficient_basis: 2,
  abandoned: 6,
}

function activeIndex(
  lifecycle: LifecycleAggregate,
  gameStatus: AnswerGameStatus,
): number {
  if (lifecycle.state === 'gate_passed' && gameStatus === 'answered') return 4
  return STATE_STAGE[lifecycle.state]
}

function stageStatus(
  lifecycle: LifecycleAggregate,
  gameStatus: AnswerGameStatus,
  index: number,
  terminalIndex: number | null,
): StageStatus {
  if (terminalIndex !== null) {
    if (index < terminalIndex) return 'complete'
    if (index === terminalIndex) return 'terminal'
    return 'waiting'
  }

  const current = activeIndex(lifecycle, gameStatus)
  if (index === 2 && lifecycle.state === 'gate_failed') return 'failed'
  if (index < current) return 'complete'
  if (index === current) {
    if (lifecycle.state === 'abandoned') return 'failed'
    return 'active'
  }
  return 'waiting'
}

function answerStageDetail(gameStatus: AnswerGameStatus): string {
  switch (gameStatus) {
    case 'completed':
      return 'ready to generate'
    case 'answering':
      return 'generation in progress'
    case 'answer_failed':
      return 'generation failed'
    case 'answered':
      return 'generated from the board'
  }
}

function lifecycleStatusText(
  lifecycle: LifecycleAggregate,
  gameStatus: AnswerGameStatus,
  currentIndex: number,
): string {
  if (canReopenInsufficientBasis(lifecycle)) {
    return 'WebChess is ready to repair Portia’s evidence path: one bounded field rebuild remains before Answer.'
  }
  if (lifecycle.state === 'portia_unavailable') {
    return 'WebChess lifecycle stopped at Portia: prompt validation was unavailable after the bounded provider-attempt budget. No answer was generated.'
  }
  if (lifecycle.state === 'charlotte_unavailable') {
    return 'WebChess lifecycle stopped at Charlotte: audience qualification was unavailable after the bounded provider-attempt budget. The board-derived Answer remains available, but it is not Charlotte-qualified. Wilbur and Web are waiting.'
  }
  if (lifecycle.state === 'gate_passed' && gameStatus === 'answered') {
    return 'WebChess lifecycle is at Charlotte: the generated board answer is ready for qualification.'
  }

  if (currentIndex === 3) {
    switch (gameStatus) {
      case 'completed':
        return 'WebChess lifecycle is at Answer: the approved board prompt is ready. Answer generation has not started.'
      case 'answering':
        return 'WebChess lifecycle is at Answer: board-derived answer generation is in progress.'
      case 'answer_failed':
        return 'WebChess lifecycle is at Answer: board-derived answer generation failed and is ready to retry.'
      case 'answered':
        break
    }
  }

  return `WebChess lifecycle is at ${STAGES[currentIndex]?.label ?? 'Web'}: ${
    lifecycle.state.replaceAll('_', ' ')
  }.`
}

export function LifecycleRail({
  lifecycle,
  gameStatus = 'completed',
}: {
  lifecycle: LifecycleAggregate
  gameStatus?: AnswerGameStatus
}) {
  const insufficientBasis = lifecycle.state === 'insufficient_basis'
    || (
      lifecycle.gate?.passed === false
      && lifecycle.gate.recommendedNextTransition === 'insufficient_basis'
    )
  const portiaTerminal = (
    insufficientBasis && !canReopenInsufficientBasis(lifecycle)
  ) || lifecycle.state === 'portia_unavailable'
  const charlotteTerminal = lifecycle.state === 'charlotte_unavailable'
  const terminalIndex = portiaTerminal ? 2 : charlotteTerminal ? 4 : null
  const currentIndex = terminalIndex ?? activeIndex(lifecycle, gameStatus)
  const stepDistance = 14.15
  const spiderPosition = 7.6 + currentIndex * stepDistance
  const preyPosition = terminalIndex !== null
    ? spiderPosition
    : 7.6 + Math.min(STAGES.length - 1, currentIndex + 1) * stepDistance
  const railRef = useRef<HTMLElement>(null)
  const activeStepRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    const bringActiveStepIntoView = () => {
      const rail = railRef.current
      const activeStep = activeStepRef.current
      if (!rail || !activeStep || rail.scrollWidth <= rail.clientWidth) return

      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ?? false
      const targetLeft = Math.max(
        0,
        activeStep.offsetLeft - (rail.clientWidth - activeStep.clientWidth) / 2,
      )

      if (typeof rail.scrollTo === 'function') {
        rail.scrollTo({
          left: targetLeft,
          behavior: reducedMotion ? 'auto' : 'smooth',
        })
      } else {
        rail.scrollLeft = targetLeft
      }
    }

    bringActiveStepIntoView()
    window.addEventListener('resize', bringActiveStepIntoView, { passive: true })
    return () => window.removeEventListener('resize', bringActiveStepIntoView)
  }, [currentIndex])

  return (
    <section
      className="lifecycle-rail"
      aria-label="WebChess lifecycle progress"
      data-lifecycle-state={lifecycle.state}
      data-answer-status={gameStatus}
      data-lifecycle-terminal={terminalIndex !== null ? 'true' : 'false'}
      tabIndex={0}
      ref={railRef}
    >
      <div className="lifecycle-web" aria-hidden="true">
        <svg viewBox="0 0 1000 210" preserveAspectRatio="none">
          <path d="M40 105H960" />
          <path d="M115 105C260 8 395 8 500 105S745 202 885 105" />
          <path d="M115 105C260 202 395 202 500 105S745 8 885 105" />
          <path d="M115 105Q500 -30 885 105Q500 240 115 105" />
          {Array.from({ length: STAGES.length }, (_, index) => (
            <path d={`M${115 + index * 128} 105L500 105`} key={index} />
          ))}
        </svg>
        <span
          className="lifecycle-spider"
          style={{ '--lifecycle-position': `${spiderPosition}%` } as CSSProperties}
        >
          <i /><b /><i />
        </span>
        <span
          className="lifecycle-prey"
          style={{ '--lifecycle-position': `${preyPosition}%` } as CSSProperties}
        ><i /><i /></span>
      </div>

      <ol className="lifecycle-steps">
        {STAGES.map((stage, index) => {
          const status = stageStatus(
            lifecycle,
            gameStatus,
            index,
            terminalIndex,
          )
          const Icon = stage.icon
          return (
            <li
              className={`lifecycle-step is-${status}`}
              key={stage.key}
              aria-current={status === 'active' || status === 'terminal' ? 'step' : undefined}
              ref={index === currentIndex ? activeStepRef : undefined}
            >
              <span className="lifecycle-step__icon" aria-hidden="true">
                {status === 'complete' ? <Check size={15} /> : <Icon size={15} />}
              </span>
              <strong>{stage.label}</strong>
              <small>
                {status === 'terminal'
                  ? lifecycle.state === 'portia_unavailable'
                    ? 'validation unavailable'
                    : lifecycle.state === 'charlotte_unavailable'
                      ? 'qualification unavailable'
                    : 'bounded stop'
                  : stage.key === 'answer'
                    ? answerStageDetail(gameStatus)
                    : stage.detail}
              </small>
              <span className="sr-only">{status}</span>
            </li>
          )
        })}
      </ol>

      <p className="sr-only" role="status" aria-live="polite">
        {portiaTerminal && insufficientBasis
          ? 'WebChess ended after Portia and the Gate declined the candidate prompt: insufficient basis. No answer was generated.'
          : lifecycleStatusText(lifecycle, gameStatus, currentIndex)}
      </p>
    </section>
  )
}
