import type { CSSProperties } from 'react'
import { ArrowRight, Bot, CircleAlert, RefreshCw } from 'lucide-react'

import type { HostedProvider } from '../../lib/hosted-provider'
import { PROBLEM_DIMENSIONS } from '../../lib/problem'
import type {
  DivisionPhase,
  DivisionStatus,
  ModelActivityState,
  ProblemPart,
} from '../../types'
import { ModelActivityPanel } from '../ModelActivityPanel'
import { ProcessGraphic } from '../ProcessGraphic'
import { RadialBoard } from '../RadialBoard'

type AnimationStyle = CSSProperties & { '--delay'?: string; '--progress'?: number }

interface MappingStageProps {
  problem: string
  provider: HostedProvider
  parts: readonly ProblemPart[]
  progress: number
  divisionStatus: DivisionStatus
  divisionPhase: DivisionPhase
  divisionModel: string
  divisionPrompt: string
  divisionError: string
  divisionActivity: ModelActivityState | null
  beginDisabled: boolean
  onBegin: () => void
  onRetry: () => void
}

const PIPELINE_PHASES: ReadonlyArray<{ id: DivisionPhase; label: string }> = [
  { id: 'analyzing', label: 'Model analyzing 64 candidate facets' },
  { id: 'facets-received', label: '64 model facets received' },
  { id: 'facets-permuted', label: 'Problem facets independently shuffled' },
  { id: 'hexagrams-permuted', label: 'I Ching lenses independently shuffled' },
  { id: 'paired', label: 'Facets paired with hexagrams' },
  { id: 'casting', label: 'Casting pairs onto 64 board cells' },
]

export function MappingStage({
  problem,
  provider,
  parts,
  progress,
  divisionStatus,
  divisionPhase,
  divisionModel,
  divisionPrompt,
  divisionError,
  divisionActivity,
  beginDisabled,
  onBegin,
  onRetry,
}: MappingStageProps) {
  const isLoading = divisionStatus === 'loading'
  const isError = divisionStatus === 'error'
  const mappingReady = divisionStatus === 'success' && parts.length === 64 && progress === 64
  const isCasting = divisionStatus === 'success' && divisionPhase === 'casting'
  const isCastingActive = isCasting && !mappingReady
  const currentPart = isCastingActive && progress > 0 ? parts[Math.min(63, progress - 1)] : undefined
  const percent = Math.round((progress / 64) * 100)
  const currentPhaseIndex = isLoading
    ? 0
    : Math.max(0, PIPELINE_PHASES.findIndex((phase) => phase.id === divisionPhase))
  const activeLabel = isError
    ? 'The model could not complete the 64-facet analysis'
    : mappingReady
      ? 'The 64-part board is complete'
      : PIPELINE_PHASES[currentPhaseIndex].label
  const hexagramsReady = ['hexagrams-permuted', 'paired', 'casting'].includes(divisionPhase)
  const pairsReady = ['paired', 'casting'].includes(divisionPhase)
  const processMetrics = [
    { label: 'Facets', value: parts.length === 64 ? '64 ready' : 'Discovering' },
    { label: 'I Ching', value: hexagramsReady ? '64 shuffled' : 'Waiting' },
    { label: 'Pairs', value: pairsReady ? '64 joined' : 'Waiting' },
    { label: 'Board', value: mappingReady ? 'Complete' : isCasting ? `${progress}/64 cast` : 'Open' },
  ]
  const modelAndProvider = `${divisionModel || provider.model} · ${provider.label}`

  return (
    <section className="board-layout stage-enter" data-stage-root tabIndex={-1} aria-label="Dividing your problem into 64 facets">
      <div className="board-column">
        <div className="board-heading mobile-only">
          <p className="eyebrow"><span /> Dividing the question</p>
          <h2>One question.<br />Sixty-four ways in.</h2>
        </div>
        <div className={`board-card mapping-board-card is-${divisionStatus} phase-${divisionPhase}`}>
          <RadialBoard
            parts={parts}
            pieces={[]}
            stage="mapping"
            mappingProgress={progress}
            revealParts
            disabled
          />
          {isLoading && (
            <div className="division-board-status" aria-hidden="true">
              <div className="division-orbit"><span /><span /><Bot size={22} /></div>
              <strong>{provider.label} is finding the 64 facets</strong>
            </div>
          )}
        </div>
        <p className="board-caption">
          {mappingReady
            ? 'All 64 problem facets and I Ching lenses are placed. The board is ready to play.'
            : isCasting
              ? 'Each model-written facet is paired independently with an I Ching lens, then cast onto the board.'
              : 'The board stays open until all 64 problem-specific candidate facets have arrived.'}
        </p>
      </div>

      <aside className="side-panel mapping-panel">
        <p className="eyebrow"><span /> Dividing the question</p>
        <h2>One question.<br />Sixty-four ways in.</h2>
        <blockquote>“{problem}”</blockquote>

        <div className={`division-analysis is-${divisionStatus}`} aria-busy={!isError && !mappingReady}>
          <p className="sr-only" role="status" aria-live="polite">{activeLabel}</p>
          {isError ? (
            <div className="division-error">
              <CircleAlert size={24} />
              <div>
                <small>Analysis paused · {modelAndProvider}</small>
                <strong>The model could not divide this problem.</strong>
                <p>{divisionError}</p>
                <button className="secondary-button division-retry" type="button" onClick={onRetry}>
                  <RefreshCw size={15} /> Try the division again
                </button>
                {divisionPrompt && (
                  <details className="answer-prompt">
                    <summary>See the analysis prompt</summary>
                    <pre>{divisionPrompt}</pre>
                  </details>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="division-headline">
                <div className="division-orbit" aria-hidden="true"><span /><span /><Bot size={21} /></div>
                <div>
                  <small>{modelAndProvider} · semantic division</small>
                  <strong>{activeLabel}</strong>
                  <p>{isLoading
                    ? `The wait is intentionally indeterminate while ${provider.label} proposes concrete, problem-specific perspectives.`
                    : 'Server-side milestones are shown here; draft output remains hidden until it passes validation.'}</p>
                </div>
              </div>

              {divisionActivity && (
                <ModelActivityPanel
                  activity={divisionActivity}
                  modelLabel={divisionModel || provider.model}
                  providerLabel={provider.label}
                  summary="Looking across purpose, people, resources, timing, risks, values, evidence, and possibilities before arranging exactly 64 candidate facets."
                  metrics={[
                    { label: 'Facets', value: parts.length === 64 ? '64 ready' : '64 requested' },
                    { label: 'Output', value: 'Strict structure' },
                    { label: 'Runtime', value: 'Server route' },
                  ]}
                />
              )}

              <ProcessGraphic
                key={mappingReady ? 'complete' : divisionPhase}
                mode={mappingReady ? 'complete' : divisionPhase}
                headline={activeLabel}
                active={!mappingReady}
                metrics={processMetrics}
                progress={isCastingActive ? progress : undefined}
                max={isCastingActive ? 64 : undefined}
                progressLabel="Board cells cast"
              />

              <ol className="division-pipeline" aria-label="Problem division pipeline">
                {PIPELINE_PHASES.map((phase, index) => {
                  const state = mappingReady || index < currentPhaseIndex
                    ? 'complete'
                    : index === currentPhaseIndex
                      ? 'active'
                      : 'pending'
                  return (
                    <li className={`is-${state}`} key={phase.id}>
                      <span aria-hidden="true">{state === 'complete' ? '✓' : index + 1}</span>
                      <p>{phase.label}</p>
                    </li>
                  )
                })}
              </ol>
            </>
          )}
        </div>

        {isCasting && (
          <div
            className="mapping-meter"
            role="progressbar"
            aria-label="Facets cast onto the board"
            aria-valuemin={0}
            aria-valuemax={64}
            aria-valuenow={progress}
            aria-valuetext={`${progress} of 64 facets mapped`}
          >
            <div className="mapping-meter__labels"><span>{mappingReady ? 'Board complete' : 'Casting the board'}</span><strong>{progress}<small>/64</small></strong></div>
            <div className="mapping-meter__track"><span style={{ '--progress': percent } as AnimationStyle} /></div>
          </div>
        )}

        {currentPart && (
          <article className="current-lens">
            <span className="lens-number">{currentPart.hexagram}</span>
            <div>
              <small>{currentPart.dimension} · {currentPart.movement}</small>
              <strong>{currentPart.title}</strong>
              <p>{currentPart.focus}</p>
              <blockquote>{currentPart.prompt}</blockquote>
              <span className="paired-hexagram">Paired with {currentPart.hexagramName} · {currentPart.theme}</span>
            </div>
          </article>
        )}

        <div className="dimension-grid" aria-label="Eight dimensions">
          {PROBLEM_DIMENSIONS.map((dimension, index) => (
            <span key={dimension.name} style={{ '--delay': `${index * 45}ms` } as AnimationStyle}>
              {String(index + 1).padStart(2, '0')} · {dimension.name}
            </span>
          ))}
        </div>

        <button
          className="primary-button"
          type="button"
          disabled={!mappingReady || beginDisabled}
          onClick={onBegin}
        >
          Set the pieces in motion
          <ArrowRight size={18} />
        </button>
      </aside>
    </section>
  )
}
