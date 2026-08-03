import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { beginModelActivity } from '../../lib/model-activity'
import { makeProblemParts } from '../../test/fixtures'
import type { CaptureRecord, FinalReading, GameOutcome, Piece } from '../../types'
import { ReadingStage } from './ReadingStage'

const API_PROVIDER = {
  id: 'openai-api',
  label: 'OpenAI API',
  billing: 'platform-api',
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
      replayError=""
      captureKeys={new Set(['2:3', '1:5'])}
      replayDisabled={false}
      resetDisabled={false}
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

  it('shows the original question before the outcome, generated answer, and captured-signal reading', () => {
    const { container } = renderReading()
    const question = container.querySelector('.reading-question')
    const outcomeBanner = container.querySelector('.outcome-banner')
    const answerCard = container.querySelector('.ai-answer-card')
    const readingHeader = container.querySelector('.reading-sheet__header')

    expect(question).toHaveTextContent('How should this plan move into its next useful phase?')
    expect(question?.compareDocumentPosition(outcomeBanner as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(question?.compareDocumentPosition(answerCard as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(question?.compareDocumentPosition(readingHeader as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
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

  it('identifies the model and hosted OpenAI provider together', () => {
    renderReading({
      provider: {
        label: 'OpenAI API',
        dataControlsUrl: 'https://developers.openai.com/api/docs/guides/your-data',
        model: 'gpt-5.6-sol',
      },
      answerModel: 'gpt-5.6-sol',
    })

    expect(screen.getByText(
      /gpt-5\.6-sol · OpenAI API · answer from 2 captured signals/i,
    )).toBeInTheDocument()
  })

  it('falls back to the strongest captured signal when the reading has no primary capture', () => {
    renderReading({
      reading: {
        ...reading,
        sections: [{
          ...reading.sections[0],
          captureId: undefined,
          partIds: [],
        }],
      },
    })

    expect(screen.getByTestId('radial-board')).toHaveAttribute('data-highlighted', '1:5')
  })

  it('renders an empty highlight safely when a completed game has no captures', () => {
    renderReading({
      captures: [],
      captureKeys: new Set(),
      reading: {
        ...reading,
        sections: [],
      },
      outcome: {
        winner: null,
        reason: 'no-moves',
        completedTurn: 12,
      },
    })

    expect(screen.getByTestId('radial-board')).toHaveAttribute('data-highlighted', '')
    expect(screen.getByText(/neither side had a legal move/i)).toBeInTheDocument()
    expect(screen.getByText(/answer from 0 captured signals/i)).toBeInTheDocument()
  })

  it.each([
    ['no-progress', /100 consecutive non-capturing plies/i],
    ['move-limit', /256-ply limit without a decisive king capture/i],
    ['no-moves', /neither side had a legal move/i],
  ] as const)('explains the %s terminal rule without implying a winner', (reason, detail) => {
    renderReading({
      outcome: {
        winner: null,
        reason,
        completedTurn: 100,
      },
    })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /board reached a standstill/i,
    )
    expect(screen.getByText(detail)).toBeInTheDocument()
  })

  it('describes a Black terminal capture from server-derived evidence', () => {
    const terminalCapture: CaptureRecord = {
      ...captures[1],
      attacker: {
        ...whiteRook,
        id: 'black-rook',
        side: 'black',
      },
      captured: {
        ...blackKing,
        id: 'white-king',
        side: 'white',
      },
    }

    renderReading({
      outcome: {
        winner: 'black',
        reason: 'king-captured',
        completedTurn: 41,
        terminalCapture,
      },
    })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /black reached white’s core purpose/i,
    )
    expect(screen.getByText(/black’s rook captured white’s king/i)).toBeInTheDocument()
  })

  it('keeps multiline and nonconsecutive numbered actions readable', () => {
    renderReading({
      answer: [
        '### **Answer**',
        'Begin with **one reversible test**.',
        'Three next moves:',
        '1) Name the owner.',
        'Add the review date on the same card.',
        '3. Stop if the evidence threshold is missed.',
      ].join('\n'),
    })

    const lists = screen.getAllByRole('list')
    expect(lists).toHaveLength(2)
    expect(within(lists[0]).getByRole('listitem')).toHaveTextContent(
      /name the owner\.\s*add the review date/i,
    )
    expect(within(lists[1]).getByRole('listitem')).toHaveAttribute('value', '3')
    expect(screen.getByText('one reversible test').tagName).toBe('STRONG')
  })

  it('exposes retry and navigation actions without retaining a failed prompt', () => {
    const onRetryAnswer = vi.fn()
    const onReplay = vi.fn()
    const onReset = vi.fn()
    renderReading({
      answerStatus: 'error',
      answer: '',
      answerPrompt: '',
      answerError: 'The provider timed out.',
      onRetryAnswer,
      onReplay,
      onReset,
    })

    fireEvent.click(screen.getByRole('button', { name: /try the answer again/i }))
    fireEvent.click(screen.getByRole('button', { name: /replay this board/i }))
    fireEvent.click(screen.getByRole('button', { name: /bring another problem/i }))

    expect(onRetryAnswer).toHaveBeenCalledOnce()
    expect(onReplay).toHaveBeenCalledOnce()
    expect(onReset).toHaveBeenCalledOnce()
    expect(screen.queryByText(/see the prompt used/i)).not.toBeInTheDocument()
  })

  it('shows durable answer activity while a pending response is restored', () => {
    renderReading({
      answerStatus: 'loading',
      answer: '',
      answerActivity: beginModelActivity('answer'),
    })

    expect(screen.getAllByText(/request in progress/i)).toHaveLength(2)
    expect(screen.getByText(/weighing 2 captured signals across 31 moves/i)).toBeInTheDocument()
  })

  it('disables the new-problem action while reset is pending', () => {
    renderReading({ replayDisabled: true, resetDisabled: true })

    expect(screen.getByRole('button', { name: /replay this board/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /bring another problem/i })).toBeDisabled()
  })

  it('shows replay recovery separately while leaving its same-intent retry enabled', () => {
    renderReading({
      replayError: 'The replay response was lost in transit.',
      replayDisabled: false,
      resetDisabled: true,
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      /replay response was lost in transit/i,
    )
    expect(screen.getByRole('button', { name: /replay this board/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /bring another problem/i })).toBeDisabled()
  })
})
