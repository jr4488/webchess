import {
  Bug,
  Check,
  CircleDot,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  Webhook,
} from 'lucide-react'
import type { CSSProperties, ElementType } from 'react'

import type {
  LifecycleAggregate,
  LifecycleState,
} from '../lib/lifecycle/contracts'

type StageStatus = 'waiting' | 'active' | 'complete' | 'failed' | 'skipped'

interface LifecycleStageDefinition {
  key: string
  label: string
  detail: string
  icon: ElementType
}

const STAGES: readonly LifecycleStageDefinition[] = [
  { key: 'anansi', label: 'Anansi', detail: 'weaves the field', icon: Sparkles },
  { key: 'chess', label: 'Chess', detail: 'plays the tensions', icon: Swords },
  { key: 'portia', label: 'Portia', detail: 'tests survivors', icon: Bug },
  { key: 'gate', label: 'Gate', detail: 'checks sufficiency', icon: ShieldCheck },
  { key: 'retry', label: 'Retry', detail: 'changes the path', icon: RotateCw },
  { key: 'charlotte', label: 'Charlotte', detail: 'synthesizes', icon: Webhook },
  { key: 'wilbur', label: 'Wilbur', detail: 'tracks action', icon: Target },
  { key: 'web', label: 'Web', detail: 'learns from reality', icon: CircleDot },
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
  portia_complete: 3,
  gate_passed: 5,
  gate_failed: 3,
  retry_ready: 4,
  retry_running: 4,
  charlotte_pending: 5,
  charlotte_running: 5,
  charlotte_complete: 6,
  wilbur_planning: 6,
  wilbur_in_progress: 6,
  wilbur_observed: 7,
  insufficient_basis: 4,
  abandoned: 7,
}

function stageStatus(
  lifecycle: LifecycleAggregate,
  index: number,
): StageStatus {
  const current = STATE_STAGE[lifecycle.state]
  if (index === 3 && lifecycle.state === 'gate_failed') return 'failed'
  if (
    index === 4
    && lifecycle.gate?.passed
    && lifecycle.sameFieldRetryCount === 0
    && lifecycle.fieldRegenerationCount === 0
  ) return 'skipped'
  if (index < current) return 'complete'
  if (index === current) {
    if (lifecycle.state === 'insufficient_basis' || lifecycle.state === 'abandoned') {
      return 'failed'
    }
    return 'active'
  }
  return 'waiting'
}

export function LifecycleRail({ lifecycle }: { lifecycle: LifecycleAggregate }) {
  const activeIndex = STATE_STAGE[lifecycle.state]

  return (
    <section
      className="lifecycle-rail"
      aria-label="WebChess lifecycle progress"
      data-lifecycle-state={lifecycle.state}
      tabIndex={0}
    >
      <div className="lifecycle-web" aria-hidden="true">
        <svg viewBox="0 0 1000 210" preserveAspectRatio="none">
          <path d="M40 105H960" />
          <path d="M115 105C260 8 395 8 500 105S745 202 885 105" />
          <path d="M115 105C260 202 395 202 500 105S745 8 885 105" />
          <path d="M115 105Q500 -30 885 105Q500 240 115 105" />
          {Array.from({ length: 8 }, (_, index) => (
            <path
              d={`M${115 + index * 110} 105L500 105`}
              key={index}
            />
          ))}
        </svg>
        <span
          className="lifecycle-spider"
          style={{
            '--lifecycle-position': `${7.25 + activeIndex * 12.2}%`,
          } as CSSProperties}
        >
          <i /><b /><i />
        </span>
        <span
          className="lifecycle-prey"
          style={{
            '--lifecycle-position': `${7.25 + Math.min(7, activeIndex + 1) * 12.2}%`,
          } as CSSProperties}
        ><i /><i /></span>
      </div>

      <ol className="lifecycle-steps">
        {STAGES.map((stage, index) => {
          const status = stageStatus(lifecycle, index)
          const Icon = stage.icon
          return (
            <li
              className={`lifecycle-step is-${status}`}
              key={stage.key}
              aria-current={status === 'active' ? 'step' : undefined}
            >
              <span className="lifecycle-step__icon" aria-hidden="true">
                {status === 'complete' ? <Check size={15} /> : <Icon size={15} />}
              </span>
              <strong>{stage.label}</strong>
              <small>{status === 'skipped' ? 'not needed' : stage.detail}</small>
              <span className="sr-only">{status}</span>
            </li>
          )
        })}
      </ol>

      <p className="sr-only" role="status" aria-live="polite">
        WebChess lifecycle is at {STAGES[activeIndex]?.label ?? 'Web'}: {lifecycle.state.replaceAll('_', ' ')}.
      </p>
    </section>
  )
}
