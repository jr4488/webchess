import { BookOpen, RotateCcw } from 'lucide-react'

import type { Stage } from '../types'

const PHASES: ReadonlyArray<{ stage: Stage; number: string; label: string }> = [
  { stage: 'question', number: '01', label: 'Name it' },
  { stage: 'mapping', number: '02', label: 'Divide it' },
  { stage: 'playing', number: '03', label: 'Play it' },
  { stage: 'reading', number: '04', label: 'Read it' },
]

interface HeaderProps {
  stage: Stage
  onReset: () => void
}

export function Header({ stage, onReset }: HeaderProps) {
  const currentIndex = PHASES.findIndex((phase) => phase.stage === stage)

  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="WebChess home">
        <span className="brand-mark" aria-hidden="true">
          <span />
        </span>
        <span className="brand-word">WebChess</span>
      </a>

      <nav className="phase-nav" aria-label="Game progress">
        {PHASES.map((phase, index) => (
          <div
            className={`phase-item ${index === currentIndex ? 'is-current' : ''} ${index < currentIndex ? 'is-complete' : ''}`}
            key={phase.stage}
            aria-current={index === currentIndex ? 'step' : undefined}
          >
            <span>{phase.number}</span>
            <strong>{phase.label}</strong>
          </div>
        ))}
      </nav>

      <div className="header-actions">
        <a className="header-link" href="/" aria-label="How WebChess works">
          <BookOpen size={14} aria-hidden="true" />
          <span>How it works</span>
        </a>
        {stage !== 'question' ? (
          <button className="text-button" type="button" onClick={onReset}>
            <RotateCcw size={14} />
            New question
          </button>
        ) : (
          <span className="header-note">64 facets · one unfolding</span>
        )}
      </div>
    </header>
  )
}
