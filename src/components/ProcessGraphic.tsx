import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Blend,
  Bot,
  BrainCircuit,
  CircleCheckBig,
  Combine,
  Grid3X3,
  MessageSquareText,
  Orbit,
  Pause,
  Shuffle,
  Sparkles,
  Swords,
} from 'lucide-react'

import type { DivisionPhase } from '../types'

export type ProcessGraphicMode = DivisionPhase | 'complete' | 'paused' | 'autoplay' | 'finishing' | 'answering'

export interface ProcessMetric {
  label: string
  value: string | number
}

interface ProcessGraphicProps {
  mode: ProcessGraphicMode
  headline: string
  active: boolean
  metrics: readonly ProcessMetric[]
  progress?: number
  max?: number
  progressLabel?: string
  progressText?: string
  progressValueText?: string
  activeIndices?: readonly number[]
  compact?: boolean
}

type ProcessStyle = CSSProperties & {
  '--index'?: number
  '--ring'?: number
  '--sector'?: number
  '--progress'?: number
}

const MODE_ICONS: Record<ProcessGraphicMode, LucideIcon> = {
  analyzing: BrainCircuit,
  'facets-received': Sparkles,
  'facets-permuted': Shuffle,
  'hexagrams-permuted': Orbit,
  paired: Combine,
  casting: Grid3X3,
  complete: CircleCheckBig,
  paused: Pause,
  autoplay: Swords,
  finishing: Blend,
  answering: MessageSquareText,
}

function useElapsedSeconds(active: boolean): number {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setElapsedSeconds((current) => current + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [active])

  return active ? elapsedSeconds : 0
}

export function ProcessGraphic({
  mode,
  headline,
  active,
  metrics,
  progress,
  max,
  progressLabel = 'Progress',
  progressText,
  progressValueText,
  activeIndices = [],
  compact = false,
}: ProcessGraphicProps) {
  const Icon = MODE_ICONS[mode]
  const elapsedSeconds = useElapsedSeconds(active)
  const hasMeasuredProgress = typeof progress === 'number' && typeof max === 'number' && max > 0
  const safeProgress = hasMeasuredProgress ? Math.max(0, Math.min(max, progress)) : 0
  const percent = hasMeasuredProgress ? Math.round((safeProgress / max) * 100) : 0
  const heatByNode = activeIndices.reduce<Map<number, number>>((counts, index) => {
    if (index < 0 || index >= 64) return counts
    counts.set(index, (counts.get(index) ?? 0) + 1)
    return counts
  }, new Map())
  const filledNodes = mode === 'analyzing'
    ? 0
    : mode === 'casting' && hasMeasuredProgress
      ? Math.round((safeProgress / max) * 64)
      : 64

  return (
    <section
      className={`process-graphic process-graphic--${mode}${active ? ' is-active' : ' is-idle'}${compact ? ' is-compact' : ''}`}
      aria-label={headline}
      aria-busy={active || undefined}
      data-process-mode={mode}
    >
      <div className="process-graphic__visual" aria-hidden="true">
        <span className="process-graphic__ring process-graphic__ring--outer" />
        <span className="process-graphic__ring process-graphic__ring--middle" />
        <span className="process-graphic__ring process-graphic__ring--inner" />
        <span className="process-graphic__sweep" />
        <div className="process-graphic__strands"><span /><span /><span /></div>
        <div className="process-graphic__nodes">
          {Array.from({ length: 64 }, (_, index) => {
            const isFilled = index < filledNodes
            const heat = Math.min(4, heatByNode.get(index) ?? 0)
            const isHot = heat > 0
            const isCurrent = mode === 'casting' && index === Math.min(63, filledNodes)
            return (
              <span
                className={`${isFilled ? 'is-filled' : ''}${isHot ? ' is-hot' : ''}${isCurrent ? ' is-current' : ''}`}
                key={index}
                data-heat={heat || undefined}
                style={{
                  '--index': index,
                  '--ring': Math.floor(index / 8),
                  '--sector': index % 8,
                } as ProcessStyle}
              />
            )
          })}
        </div>
        <div className="process-graphic__runners"><span /><span /></div>
        <div className="process-graphic__core"><Icon size={22} /><Bot className="process-graphic__bot" size={13} /></div>
      </div>

      <div className="process-graphic__readout">
        <div>
          <small>{active ? 'Live process' : 'Process ready'}</small>
          <strong>{headline}</strong>
        </div>
        <span>
          <small>{hasMeasuredProgress ? progressLabel : active ? 'Elapsed' : 'State'}</small>
          <b>{hasMeasuredProgress ? progressText ?? `${progress}/${max}` : active ? `${elapsedSeconds}s` : 'Ready'}</b>
        </span>
      </div>

      {hasMeasuredProgress ? (
        <div
          className="process-graphic__meter"
          role="progressbar"
          aria-label={progressLabel}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={safeProgress}
          aria-valuetext={progressValueText ?? `${progress} of ${max}`}
        >
          <span style={{ '--progress': percent } as ProcessStyle} />
        </div>
      ) : (
        <div className="process-graphic__meter is-indeterminate" aria-hidden="true"><span /></div>
      )}

      <dl className="process-graphic__metrics">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
