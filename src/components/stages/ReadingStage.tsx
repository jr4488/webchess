import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowRight, CircleAlert, FileText, RefreshCw, RotateCcw, Shield, Sparkles } from 'lucide-react'

import { PIECE_GLYPHS } from '../../constants'
import { cellKey } from '../../lib/board'
import type { HostedProvider } from '../../lib/hosted-provider'
import { PIECE_METAPHORS } from '../../lib/reading'
import type {
  CaptureRecord,
  AnswerStatus,
  FinalReading,
  GameOutcome,
  LastMove,
  ModelActivityState,
  Piece,
  ProblemPart,
} from '../../types'
import { ProcessGraphic } from '../ProcessGraphic'
import { RadialBoard } from '../RadialBoard'
import { ModelActivityPanel } from '../ModelActivityPanel'

const EMPTY_SET = new Set<string>()

type AnimationStyle = CSSProperties & { '--delay'?: string }

interface AnswerHeadingBlock {
  kind: 'heading'
  text: string
}

interface AnswerParagraphBlock {
  kind: 'paragraph'
  text: string
}

interface AnswerStep {
  number: number
  text: string
}

interface AnswerStepsBlock {
  kind: 'steps'
  items: AnswerStep[]
}

type AnswerBlock = AnswerHeadingBlock | AnswerParagraphBlock | AnswerStepsBlock

const ANSWER_HEADINGS = [
  'Answer',
  'What the conflicts emphasized',
  'The tension to hold',
  'Three next moves',
  'What could change the answer',
] as const

const ANSWER_HEADING_BY_KEY = new Map(
  ANSWER_HEADINGS.map((heading) => [heading.toLocaleLowerCase(), heading]),
)

function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split('\n').flatMap((line, lineIndex) => {
    const lineNodes = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((segment, segmentIndex) => {
      if (segment.startsWith('**') && segment.endsWith('**')) {
        return <strong key={`${lineIndex}-${segmentIndex}`}>{segment.slice(2, -2)}</strong>
      }
      return segment
    })

    return lineIndex === 0
      ? lineNodes
      : [<br key={`line-break-${lineIndex}`} />, ...lineNodes]
  })
}

function parseContractHeading(line: string): string | null {
  let candidate = line.trim().replace(/^#{1,6}\s+/, '').trim()
  if (candidate.startsWith('**') && candidate.endsWith('**')) {
    candidate = candidate.slice(2, -2).trim()
  }
  candidate = candidate.replace(/:$/, '').trim()
  return ANSWER_HEADING_BY_KEY.get(candidate.toLocaleLowerCase()) ?? null
}

function parseAnswerBlocks(answer: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = []
  let paragraphLines: string[] = []
  let stepItems: AnswerStep[] = []
  let currentHeading: string | null = null

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n') })
      paragraphLines = []
    }
  }
  const flushSteps = () => {
    if (stepItems.length > 0) {
      blocks.push({ kind: 'steps', items: stepItems })
      stepItems = []
    }
  }

  for (const rawLine of answer.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushSteps()
      continue
    }

    const heading = parseContractHeading(line)
    if (heading) {
      flushParagraph()
      flushSteps()
      blocks.push({ kind: 'heading', text: heading })
      currentHeading = heading
      continue
    }

    const step = currentHeading === 'Three next moves'
      ? line.match(/^(\d+)[.)]\s+(.+)$/)
      : null
    if (step) {
      flushParagraph()
      const number = Number(step[1])
      const previousNumber = stepItems.at(-1)?.number
      if (previousNumber !== undefined && number !== previousNumber + 1) {
        flushSteps()
      }
      stepItems.push({ number, text: step[2].trim() })
      continue
    }

    if (stepItems.length > 0) {
      const lastStep = stepItems.at(-1)
      if (lastStep) lastStep.text += `\n${line}`
      continue
    }

    paragraphLines.push(line)
  }

  flushParagraph()
  flushSteps()
  return blocks
}

function AnswerText({ answer }: { answer: string }) {
  return (
    <div className="ai-answer-text">
      {parseAnswerBlocks(answer).map((block, index) => {
        const style = { '--delay': `${Math.min(index * 55, 440)}ms` } as AnimationStyle
        if (block.kind === 'heading') {
          return <h3 key={`${block.kind}-${index}`} style={style}>{renderInlineMarkdown(block.text)}</h3>
        }
        if (block.kind === 'steps') {
          return (
            <ol
              className="answer-markdown-list"
              key={`${block.kind}-${index}`}
              role="list"
              start={block.items[0]?.number}
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
              {block.items.map((item, itemIndex) => (
                <li
                  className="answer-markdown-step"
                  key={`${item.number}-${itemIndex}`}
                  role="listitem"
                  style={{ '--delay': `${Math.min((index + itemIndex) * 55, 440)}ms` } as AnimationStyle}
                  value={item.number}
                >
                  <span aria-hidden="true">{String(item.number).padStart(2, '0')}</span>
                  <p>{renderInlineMarkdown(item.text)}</p>
                </li>
              ))}
            </ol>
          )
        }
        return <p key={`${block.kind}-${index}`} style={style}>{renderInlineMarkdown(block.text)}</p>
      })}
    </div>
  )
}

function AnswerPromptDisclosure({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  return (
    <div className="answer-prompt">
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className="secondary-button answer-prompt-button"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <FileText size={15} aria-hidden="true" />
        {open ? 'Hide Answer prompt artifact' : 'Inspect Answer prompt artifact'}
      </button>
      {open ? (
        <div
          aria-label="Answer prompt artifact"
          className="answer-prompt-panel"
          id={panelId}
          role="region"
        >
          <p>
            This secret-free artifact records the WebChess instruction template
            and verified game-derived content supplied to the final model turn.
            When applicable, it also records the fixed OpenClaw system role. It
            excludes credentials, private model reasoning, invalid provider
            output, request headers, and runtime logs.
          </p>
          <pre>{prompt}</pre>
        </div>
      ) : null}
    </div>
  )
}

interface ReadingStageProps {
  problem: string
  provider: HostedProvider
  parts: readonly ProblemPart[]
  pieces: readonly Piece[]
  captures: readonly CaptureRecord[]
  lastMove: LastMove | null
  reading: FinalReading
  outcome: GameOutcome
  answerStatus: AnswerStatus
  answer: string
  answerModel: string
  answerPrompt: string
  answerError: string
  answerActivity: ModelActivityState | null
  replayError: string
  captureKeys: ReadonlySet<string>
  replayDisabled: boolean
  resetDisabled: boolean
  onRetryAnswer: () => void
  onReplay: () => void
  onReset: () => void
}

export function ReadingStage({
  problem,
  provider,
  parts,
  pieces,
  captures,
  lastMove,
  reading,
  outcome,
  answerStatus,
  answer,
  answerModel,
  answerPrompt,
  answerError,
  answerActivity,
  replayError,
  captureKeys,
  replayDisabled,
  resetDisabled,
  onRetryAnswer,
  onReplay,
  onReset,
}: ReadingStageProps) {
  const strongestCapture = captures.find(
    (capture) => capture.id === reading.sections[0]?.captureId,
  ) ?? [...captures].sort((a, b) => b.resonance - a.resonance)[0]
  const strongestKey = strongestCapture ? new Set([cellKey(strongestCapture.cell)]) : EMPTY_SET
  const uniqueCapturedFacetCount = new Set(captures.map((capture) => capture.part.id)).size
  const answerServiceName = answerModel.trim()
  const answerModelLabel = answerServiceName || provider.model
  const answerServiceLabel = `${answerModelLabel} via ${provider.label}`
  const winnerName = outcome.winner === 'white' ? 'White' : outcome.winner === 'black' ? 'Black' : null
  const capturedSideName = outcome.terminalCapture?.captured.side === 'white' ? 'White' : 'Black'
  const attackerName = outcome.terminalCapture?.attacker.side === 'white' ? 'White' : 'Black'
  const attackerKind = outcome.terminalCapture?.attacker.kind
  const endingPart = outcome.terminalCapture?.part
  const outcomeTitle = winnerName
    ? `${winnerName} reached ${capturedSideName}’s Core Purpose.`
    : 'The board reached a standstill.'
  const outcomeDetail = outcome.terminalCapture && endingPart
    ? `${attackerName}’s ${attackerKind} captured ${capturedSideName}’s King while the board held “${endingPart.title}”, paired with Hexagram ${endingPart.hexagram}: ${endingPart.hexagramName}.`
    : outcome.reason === 'no-progress'
      ? 'The game reached 100 consecutive non-capturing plies. The captured signals now become inputs to a candidate answer.'
      : outcome.reason === 'move-limit'
        ? 'The game reached its 256-ply limit without a decisive King capture. The captured signals now become inputs to a candidate answer.'
        : 'Neither side had a legal move. The captured signals now become inputs to a candidate answer.'
  const activeCaptureIndices = captures.map((capture) => capture.cell.ring * 8 + capture.cell.sector)

  return (
    <section className={`reading-layout stage-enter${answerStatus === 'loading' ? ' is-answering' : ''}`} data-stage-root tabIndex={-1} aria-label="Final WebChess answer">
      <div className="reading-board-column">
        <p className="eyebrow"><span /> Game complete · Move {outcome.completedTurn}</p>
        <h2>The game reached<br /><em>its ending.</em></h2>
        <div className="board-card is-reading">
          <RadialBoard
            parts={parts}
            pieces={pieces}
            stage="reading"
            capturedCellKeys={captureKeys}
            highlightedCellKeys={strongestKey}
            latestCapture={captures.at(-1) ?? null}
            lastMove={lastMove}
            revealParts
            disabled
          />
        </div>
        <div className="reading-stat-row">
          <span><strong>{captures.length}</strong> captured signals sent</span>
          <span><strong>{uniqueCapturedFacetCount}</strong> unique facets</span>
          <span><strong>{outcome.completedTurn}</strong> moves completed</span>
        </div>
      </div>

      <article className="reading-sheet">
        <blockquote className="reading-question">“{problem}”</blockquote>

        <div className="outcome-banner">
          <small>How the board ended</small>
          <h1>{outcomeTitle}</h1>
          <p>{outcomeDetail}</p>
        </div>

        <section className={`ai-answer-card is-${answerStatus}`} aria-busy={answerStatus === 'loading'}>
          <p className="sr-only" role="status" aria-live="polite">
            {answerStatus === 'loading'
              ? `${answerServiceLabel} received the captured signals. The final answer is being composed.`
              : answerStatus === 'error'
                ? 'The final answer could not be reached.'
                : answerStatus === 'success'
                  ? 'The final answer is ready.'
                  : ''}
          </p>
          {answerActivity && answerStatus !== 'error' && (
            <ModelActivityPanel
              activity={answerActivity}
              modelLabel={answerModelLabel}
              providerLabel={provider.label}
              runtimeKind={provider.kind}
              summary={`Weighing ${captures.length} captured signals across ${outcome.completedTurn} moves, then composing the five checked answer sections.`}
              metrics={[
                { label: 'Captured signals', value: captures.length },
                { label: 'Unique facets', value: uniqueCapturedFacetCount },
                { label: 'Moves', value: outcome.completedTurn },
              ]}
            />
          )}
          {answerStatus === 'loading' && (
            <div className="answer-workspace">
              <div>
                <small>Asking {answerServiceLabel}</small>
                <h2>The captured signals have become a prompt.</h2>
                <p>The original question, outcome, game totals and polarities, plus the captured facets, I Ching lenses, recurrence, weights, piece metaphors, and trail were assembled and sent. Uncaptured facets were not. The model is composing a practical response.</p>
              </div>
              <ProcessGraphic
                mode="answering"
                headline={`${answerServiceLabel} is composing the final answer`}
                active
                activeIndices={activeCaptureIndices}
                metrics={[
                  { label: 'Captured signals', value: captures.length },
                  { label: 'Unique facets', value: uniqueCapturedFacetCount },
                  { label: 'Moves', value: outcome.completedTurn },
                  { label: 'Prompt', value: 'Sent' },
                ]}
              />
            </div>
          )}

          {answerStatus === 'error' && (
            <>
              <CircleAlert size={24} />
              <div>
                <small>The board reading is ready · {answerServiceLabel}</small>
                <h2>The model answer could not be reached.</h2>
                <p>{answerError}</p>
                <button className="secondary-button answer-retry" type="button" onClick={onRetryAnswer}>
                  <RefreshCw size={15} /> Try the answer again
                </button>
                {answerPrompt && (
                  <AnswerPromptDisclosure prompt={answerPrompt} />
                )}
              </div>
            </>
          )}

          {answerStatus === 'success' && (
            <div className="ai-answer-result">
              <small>{answerModelLabel} · {provider.label} · answer from {captures.length} captured signals</small>
              <h2>A direction from the captured signals</h2>
              <AnswerText answer={answer} />
              {answerPrompt && (
                <AnswerPromptDisclosure prompt={answerPrompt} />
              )}
            </div>
          )}
        </section>

        <header className="reading-sheet__header">
          <span className="reading-seal"><Sparkles size={20} /></span>
          <div>
            <p>HOW THE CAPTURED SIGNALS FORMED THE PROMPT · {String(captures.length).padStart(2, '0')} CONFLICTS</p>
            <h2>{reading.title}</h2>
          </div>
        </header>

        <p className="reading-summary">{reading.summary}</p>

        <div className="reading-sections">
          {reading.sections.map((section, index) => {
            const linkedCapture = captures.find((capture) =>
              section.captureId
                ? capture.id === section.captureId
                : section.partIds.includes(capture.part.id),
            )
            return (
              <section key={`${section.label}-${section.partIds.join('-')}`} style={{ '--delay': `${index * 110}ms` } as AnimationStyle}>
                <div className="reading-section__marker">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {linkedCapture && <i>{PIECE_GLYPHS[linkedCapture.attacker.kind]} → {PIECE_GLYPHS[linkedCapture.captured.kind]}</i>}
                </div>
                <div>
                  <small>{section.label}{linkedCapture ? ` · ${linkedCapture.part.dimension} / ${linkedCapture.part.movement}` : ''}</small>
                  <h3>{section.title}</h3>
                  {linkedCapture && (
                    <div className="reading-braid">
                      <span>{PIECE_GLYPHS[linkedCapture.attacker.kind]} {PIECE_METAPHORS[linkedCapture.attacker.kind].label} · {linkedCapture.part.title}</span>
                      <span>{PIECE_GLYPHS[linkedCapture.captured.kind]} {PIECE_METAPHORS[linkedCapture.captured.kind].label} under review · {linkedCapture.part.focus}</span>
                      <span>I Ching · Hexagram {linkedCapture.part.hexagram} · {linkedCapture.part.hexagramName}</span>
                    </div>
                  )}
                  <p>{section.body}</p>
                </div>
              </section>
            )
          })}
        </div>

        <div className="next-move">
          <Shield size={20} />
          <div><small>Your next move</small><p>{reading.closing}</p></div>
        </div>

        {replayError && (
          <div className="replay-error" role="alert">
            <CircleAlert size={20} />
            <div>
              <strong>The replay was not confirmed.</strong>
              <p>{replayError} Retry this board to reconcile the same saved replay request. Starting another problem stays locked until its durable target is known.</p>
            </div>
          </div>
        )}

        <div className="reading-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={replayDisabled}
            onClick={onReplay}
          >
            <RotateCcw size={16} /> Start another game on this field
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={resetDisabled}
            onClick={onReset}
          >
            Bring another problem <ArrowRight size={17} />
          </button>
        </div>
      </article>
    </section>
  )
}
