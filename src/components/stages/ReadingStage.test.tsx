import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { makeProblemParts } from '../../test/fixtures'
import type { CaptureRecord, FinalReading, GameOutcome, Piece } from '../../types'
import { ReadingStage } from './ReadingStage'

const API_PROVIDER = {
  id: 'openai-api',
  label: 'OpenAI API',
  billing: 'platform-api',
  localOnly: false,
  dataControlsUrl: 'https://developers.openai.com/api/docs/guides/your-data',
  model: 'gpt-5.6-sol',
  webSearch: 'disabled',
} as const

vi.mock('../ProcessGraphic', () => ({
  ProcessGraphic: ({
    headline,
    metrics,
  }: {
    headline: string
    metrics: Array<{ label: string; value: number | string }>
  }) => (
    <div aria-label={headline}>
      {metrics.map((metric) => (
        <span key={metric.label}>{metric.label}: {metric.value}</span>
      ))}
    </div>
  ),
}))

vi.mock('../RadialBoard', () => ({
  RadialBoard: ({
    highlightedCellKeys,
  }: {
    highlightedCellKeys?: ReadonlySet<string>
  }) => (
    <div
      data-testid="radial-board"
      data-highlighted={[...(highlightedCellKeys ?? [])].join(',')}
    />
  ),
}))

const CONTRACT_ANSWER = [
  'Answer',
  'Move forward with a **reversible checkpoint** rather than treating the current plan as a final commitment.',
  'The captured signals consistently point toward testing the plan against present constraints while protecting the purpose that made the work matter in the first place. Set a short decision window, name the evidence that would justify continuing, and keep one low-cost route back if the first test reveals a hidden dependency.',
  'What the conflicts emphasized',
  'The strongest conflict joined the concrete question of timing with a lens about gradual development. That combination does not prove that waiting is correct; it highlights the cost of forcing a decision before the people and information needed to support it are ready. The active Queen represented broad coordination applying pressure, while the challenged Knight represented a promising but indirect experiment that still needs room to change direction.',
  '',
  'A second captured signal emphasized ownership. Here the Rook’s concern for stable structure pressed against a Pawn-sized commitment that can be tested cheaply. Read together, these conflicts suggest that the next useful move is neither a full launch nor indefinite analysis. It is a bounded trial with a named owner, a review date, and evidence that everyone can inspect without relying on optimism or symbolic meaning.',
  'The tension to hold',
  'Hold purpose and evidence together. The inside-out side of the board preserves the reason for acting: the team wants to solve a real customer problem and avoid losing momentum. The outside-in side asks whether current capacity, timing, and feedback support the chosen method. If purpose dominates, the team may reinterpret every warning as resistance. If evidence dominates, ordinary uncertainty may become an excuse to avoid any meaningful commitment.',
  '',
  'The practical tension is therefore between moving soon enough to learn and staying small enough to reverse. Treat the I Ching lenses as prompts for attention, not forecasts. The board is useful here because repeated conflict made the same trade-off visible from several angles; it did not turn that trade-off into objective proof.',
  'Three next moves',
  '1. Write a one-page trial agreement by Friday. Name the customer problem, the smallest deliverable, one accountable owner, the budget ceiling, and the result that would stop the trial. Keep the agreement visible so later enthusiasm cannot quietly expand the scope.',
  '2. Run two customer sessions before committing additional capacity. Ask the same core questions, record contradictory feedback as carefully as supportive feedback, and compare what people actually attempt with what they say they would use.',
  '3. Schedule a thirty-minute checkpoint after the sessions. Continue only if the agreed evidence threshold is met; otherwise revise the method or pause without treating the experiment as a failure. Record what changed so the next decision begins with evidence rather than memory.',
  'What could change the answer',
  'This direction should change if the trial cannot be made safe, reversible, and honest about its cost. A legal constraint, an unavailable owner, evidence that customers face a different problem, or a deadline that removes the learning window would all justify a different recommendation. Strong existing usage data could also support a larger commitment sooner, while repeated disconfirming interviews should move the team back toward problem discovery.',
  '',
  'Before acting, check whether any stakeholder bears a risk that the board did not represent. The captured facets are only selected attention signals; uncaptured concerns may still be decisive. Revisit the answer when new evidence changes the cost of delay, the feasibility of reversal, or the purpose the team is actually trying to serve.',
].join('\n')

const parts = makeProblemParts('reading-stage')
const whiteQueen: Piece = {
  id: 'white-queen',
  side: 'white',
  kind: 'queen',
  position: { ring: 2, sector: 3 },
  moved: true,
}
const blackKnight: Piece = {
  id: 'black-knight',
  side: 'black',
  kind: 'knight',
  position: { ring: 2, sector: 3 },
  moved: true,
}
const whiteRook: Piece = {
  id: 'white-rook',
  side: 'white',
  kind: 'rook',
  position: { ring: 1, sector: 5 },
  moved: true,
}
const blackKing: Piece = {
  id: 'black-king',
  side: 'black',
  kind: 'king',
  position: { ring: 1, sector: 5 },
  moved: true,
}

const captures: CaptureRecord[] = [
  {
    id: 'capture-12',
    turn: 12,
    attacker: whiteQueen,
    captured: blackKnight,
    cell: { ring: 2, sector: 3 },
    part: parts[19],
    resonance: 88,
    narration: 'The first selected tension.',
  },
  {
    id: 'capture-31',
    turn: 31,
    attacker: whiteRook,
    captured: blackKing,
    cell: { ring: 1, sector: 5 },
    part: parts[37],
    resonance: 94,
    narration: 'The terminal selected tension.',
  },
]

const outcome: GameOutcome = {
  winner: 'white',
  reason: 'king-captured',
  completedTurn: 31,
  terminalCapture: captures[1],
}

const reading: FinalReading = {
  title: 'Test the commitment without losing the purpose',
  summary: 'The captured conflicts favor a bounded experiment and an explicit review.',
  sections: [{
    label: 'Strongest signal',
    title: 'Coordination meets a reversible experiment',
    body: 'Use the signal as a question to test, not as proof.',
    partIds: [captures[0].part.id],
    captureId: captures[0].id,
  }],
  closing: 'Write the trial agreement and schedule its review.',
}

function renderReading(overrides: Partial<React.ComponentProps<typeof ReadingStage>> = {}) {
  return render(
    <ReadingStage
      problem="How should this plan move into its next useful phase?"
      provider={API_PROVIDER}
      parts={parts}
      pieces={[whiteQueen, blackKnight, whiteRook, blackKing]}
      captures={captures}
      lastMove={{ from: { ring: 2, sector: 5 }, to: { ring: 1, sector: 5 } }}
      reading={reading}
      outcome={outcome}
      answerStatus="success"
      answer={CONTRACT_ANSWER}
      answerModel="gpt-5.6-sol"
      answerPrompt="Canonical answer prompt containing only captured signals."
      answerError=""
      answerActivity={null}
      captureKeys={new Set(['2:3', '1:5'])}
      onRetryAnswer={vi.fn()}
      onReplay={vi.fn()}
      onReset={vi.fn()}
      {...overrides}
    />,
  )
}

describe('ReadingStage final answer', () => {
  it('highlights the primary synthesized conflict instead of the raw highest resonance', () => {
    renderReading()

    expect(screen.getByTestId('radial-board')).toHaveAttribute('data-highlighted', '2:3')
  })

  it('renders the five-section contract and consecutive actions without blank-line dependencies', () => {
    const { container } = renderReading()
    const answerText = container.querySelector('.ai-answer-text')

    expect(answerText).not.toBeNull()
    const answer = within(answerText as HTMLElement)
    expect(answer.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Answer',
      'What the conflicts emphasized',
      'The tension to hold',
      'Three next moves',
      'What could change the answer',
    ])

    const actionList = answer.getByRole('list')
    const actions = within(actionList).getAllByRole('listitem')
    expect(actionList.tagName).toBe('OL')
    expect(actions).toHaveLength(3)
    expect(actions.map((action) => action.getAttribute('value'))).toEqual(['1', '2', '3'])
    expect(actions[0]).toHaveTextContent(/write a one-page trial agreement/i)
    expect(actions[1]).toHaveTextContent(/run two customer sessions/i)
    expect(actions[2]).toHaveTextContent(/schedule a thirty-minute checkpoint/i)

    expect(answer.getByText('reversible checkpoint').tagName).toBe('STRONG')
    expect(answerText?.querySelector('br')).toBeInTheDocument()
    expect(screen.getByText(/gpt-5\.6-sol · OpenAI API · answer from 2 captured signals/i)).toBeInTheDocument()
  })

  it('describes the complete final payload and uses configured model provenance while loading', () => {
    renderReading({
      answerStatus: 'loading',
      answer: '',
      answerModel: '',
    })

    expect(screen.getByText('Asking gpt-5.6-sol via OpenAI API')).toBeInTheDocument()
    expect(screen.getByText(/original question, outcome, game totals and polarities/i)).toBeInTheDocument()
    expect(screen.getByText(/uncaptured facets were not/i)).toBeInTheDocument()
    expect(screen.getByText((_, element) => (
      element?.tagName === 'SPAN' && element.textContent === '2 captured signals sent'
    ))).toBeInTheDocument()
    expect(screen.getByText((_, element) => (
      element?.tagName === 'SPAN' && element.textContent === '2 unique facets'
    ))).toBeInTheDocument()
    expect(screen.getByText('Captured signals: 2')).toBeInTheDocument()
    expect(screen.queryByText(/sol is composing/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/whole board|complete game/i)).not.toBeInTheDocument()
  })

  it('labels a returned failure prompt as the prompt used for that attempt', () => {
    renderReading({
      answerStatus: 'error',
      answer: '',
      answerPrompt: 'Canonical prompt returned with the failed attempt.',
      answerError: 'The model provider could not complete this answer.',
    })

    expect(screen.getByText(/see the prompt used for this attempt/i)).toBeInTheDocument()
    expect(screen.queryByText(/waiting to be sent/i)).not.toBeInTheDocument()
  })

  it('identifies the model and local ChatGPT Codex provider together', () => {
    renderReading({
      provider: {
        id: 'codex-chatgpt',
        label: 'ChatGPT Codex',
        billing: 'chatgpt-workspace',
        localOnly: true,
        dataControlsUrl: 'https://help.openai.com/en/articles/7730893-data-controls-faq',
        model: 'gpt-5.6-sol',
        webSearch: 'live',
      },
      answerModel: 'gpt-5.6-sol',
    })

    expect(screen.getByText(
      /gpt-5\.6-sol · ChatGPT Codex · answer from 2 captured signals/i,
    )).toBeInTheDocument()
  })
})
