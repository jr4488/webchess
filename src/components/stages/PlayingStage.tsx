import type { CSSProperties } from 'react'
import { Pause, Play, Sparkles, StepForward, Target } from 'lucide-react'

import { PIECE_GLYPHS, PIECE_ORDER, READING_DEPTH_SIGNALS } from '../../constants'
import { PIECE_METAPHORS } from '../../lib/reading'
import type {
  CaptureRecord,
  CellCoord,
  LastMove,
  Piece,
  ProblemPart,
  Side,
} from '../../types'
import { ProcessGraphic } from '../ProcessGraphic'
import { RadialBoard } from '../RadialBoard'

type AnimationStyle = CSSProperties & { '--delay'?: string; '--progress'?: number }

interface PlayingStageProps {
  problem: string
  parts: readonly ProblemPart[]
  pieces: readonly Piece[]
  turn: Side
  turnNumber: number
  captures: readonly CaptureRecord[]
  selectedPiece: Piece | null
  selectedPieceId: string | null
  legalMoves: readonly CellCoord[]
  focusedPart: ProblemPart | null
  focusedKeys: ReadonlySet<string>
  captureKeys: ReadonlySet<string>
  lastMove: LastMove | null
  autoPlaying: boolean
  searchMode: 'manual' | 'autoplay' | null
  gameFinishing: boolean
  notice: string
  onPieceSelect: (pieceId: string) => void
  onCellSelect: (cell: CellCoord) => void
  onStep: () => void
  onToggleAuto: () => void
}

export function PlayingStage({
  problem,
  parts,
  pieces,
  turn,
  turnNumber,
  captures,
  selectedPiece,
  selectedPieceId,
  legalMoves,
  focusedPart,
  focusedKeys,
  captureKeys,
  lastMove,
  autoPlaying,
  searchMode,
  gameFinishing,
  notice,
  onPieceSelect,
  onCellSelect,
  onStep,
  onToggleAuto,
}: PlayingStageProps) {
  const thinking = searchMode !== null
  const manualSearchInFlight = searchMode === 'manual'
  const latestCaptures = [...captures].reverse().slice(0, 4)
  const activeCaptureIndices = captures.map((capture) => capture.cell.ring * 8 + capture.cell.sector)
  const processMode = gameFinishing ? 'finishing' : autoPlaying ? 'autoplay' : 'paused'
  const processHeadline = gameFinishing
    ? 'The conflict trail is becoming a reading'
    : thinking
      ? `${turn === 'white' ? 'Outside evidence' : 'Inside intent'} is searching for move ${turnNumber}`
      : autoPlaying
        ? `${turn === 'white' ? 'Outside evidence' : 'Inside intent'} is choosing move ${turnNumber}`
        : 'The board is ready for your move'
  const autoplayStatus = gameFinishing
    ? 'Game complete. The captured signals and ending are becoming an answer.'
    : autoPlaying
      ? turnNumber < 5
        ? 'Auto-play started.'
        : `Auto-play has reached move ${Math.floor(turnNumber / 5) * 5}.`
      : ''

  return (
    <section className="board-layout playing-layout stage-enter" data-stage-root tabIndex={-1} aria-label="Play the problem on the circular board">
      <div className="board-column">
        <a className="skip-board" href="#game-controls">Skip the circular board</a>
        <div className="mobile-turn mobile-only">
          <span className={`turn-stone turn-stone--${turn}`} />
          <strong>{turn === 'white' ? 'Outside → in' : 'Inside → out'}</strong>
          <small>Move {turnNumber}</small>
        </div>
        <div className="mobile-board-feedback mobile-only" aria-hidden="true">
          <Sparkles size={15} />
          <p>{notice}</p>
        </div>
        <div className={`board-card is-live ${autoPlaying ? 'is-auto' : ''}`}>
          <RadialBoard
            parts={parts}
            pieces={pieces}
            stage="playing"
            activeSide={turn}
            selectedPieceId={selectedPieceId}
            legalMoves={legalMoves}
            capturedCellKeys={captureKeys}
            highlightedCellKeys={focusedKeys}
            lastMove={lastMove}
            revealParts
            disabled={autoPlaying || gameFinishing || thinking}
            onPieceSelect={onPieceSelect}
            onCellSelect={onCellSelect}
          />
          {(autoPlaying || gameFinishing || thinking) && (
            <div className={`auto-indicator ${thinking && !gameFinishing ? 'is-thinking' : ''}`} aria-hidden="true">
              <span aria-hidden="true" />{' '}
              {gameFinishing
                ? 'Game complete · weaving the final answer'
                : thinking
                  ? `${turn === 'white' ? 'White' : 'Black'} is reading the position · Move ${turnNumber}`
                  : `Playing to the end · Move ${turnNumber}`}
            </div>
          )}
        </div>
        <div className="board-caption play-caption">
          <span><i className="white-dot" /> White reads outside evidence inward</span>
          <span><i className="black-dot" /> Black carries inner intent outward</span>
        </div>
      </div>

      <aside className="side-panel play-panel" id="game-controls" tabIndex={-1}>
        <div className="turn-header">
          <div>
            <p className="eyebrow"><span /> Move {String(turnNumber).padStart(2, '0')}</p>
            <h2>{turn === 'white' ? 'Outside moves in.' : 'Inside moves out.'}</h2>
          </div>
          <span className={`turn-stone turn-stone--${turn}`} aria-label={`${turn} to move`} />
        </div>
        <p className="problem-reminder">{problem}</p>

        <div className="board-message" aria-live={autoPlaying ? 'off' : 'polite'} aria-atomic="true">
          <Sparkles size={17} />
          <p>{notice}</p>
        </div>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {autoplayStatus}
        </p>

        <ProcessGraphic
          key={processMode}
          mode={processMode}
          headline={processHeadline}
          active={autoPlaying || gameFinishing}
          progress={Math.min(captures.length, READING_DEPTH_SIGNALS)}
          max={READING_DEPTH_SIGNALS}
          progressLabel="Captured signal depth"
          progressText={captures.length >= READING_DEPTH_SIGNALS ? `${captures.length} signals` : `${captures.length}/${READING_DEPTH_SIGNALS}`}
          progressValueText={`${captures.length} signals gathered; ${READING_DEPTH_SIGNALS} marks reflection depth but does not end the game.`}
          activeIndices={activeCaptureIndices}
          metrics={[
            { label: 'Move', value: turnNumber },
            { label: 'Signals', value: captures.length },
            { label: 'Pieces', value: pieces.length },
            { label: 'Direction', value: turn === 'white' ? 'Outside in' : 'Inside out' },
          ]}
          compact
        />

        <div className="control-row">
          <button
            className={`auto-button ${autoPlaying ? 'is-active' : ''}`}
            type="button"
            onClick={onToggleAuto}
            disabled={gameFinishing || (!autoPlaying && manualSearchInFlight)}
            aria-pressed={autoPlaying}
          >
            {autoPlaying ? <Pause size={17} /> : <Play size={17} />}
            {autoPlaying ? 'Pause auto-play' : 'Auto-play to the end'}
          </button>
          <button className="step-button" type="button" onClick={onStep} disabled={autoPlaying || gameFinishing || thinking}>
            <StepForward size={17} /> {thinking ? 'Searching…' : 'Play one turn'}
          </button>
        </div>
        <p className="play-help">Choose a piece yourself, play one turn, or let WebChess continue to the end.</p>

        <small className="end-rule">Seven captured signals mark reflection depth; they are not evidence and do not end the game. A Core Purpose capture or a full-board stopping rule ends play.</small>

        {focusedPart ? (
          <article className="focus-card">
            <header>
              <span>{focusedPart.hexagram}</span>
              <div><small>{focusedPart.dimension} · {focusedPart.movement}</small><h3>{focusedPart.title}</h3></div>
            </header>
            <p>{focusedPart.focus}</p>
            <div className="focus-pairing">
              <small>I Ching pairing · Hexagram {focusedPart.hexagram}</small>
              <strong>{focusedPart.hexagramName}</strong>
              <p>{focusedPart.theme}</p>
            </div>
            <blockquote>{focusedPart.prompt}</blockquote>
          </article>
        ) : (
          <article className="focus-card is-empty">
            <Target size={20} />
            <p>Select any space to inspect its part of the question.</p>
          </article>
        )}

        <div className="piece-legend">
          <div className="section-label"><span>Piece metaphors</span><small>{selectedPiece ? PIECE_METAPHORS[selectedPiece.kind].label : 'Select a piece'}</small></div>
          <div className="piece-row">
            {PIECE_ORDER.map((kind) => (
              <span className={selectedPiece?.kind === kind ? 'is-active' : ''} key={kind} title={`${PIECE_METAPHORS[kind].label}: ${PIECE_METAPHORS[kind].role}`}>
                {PIECE_GLYPHS[kind]}<small>{PIECE_METAPHORS[kind].label}</small>
              </span>
            ))}
          </div>
        </div>

        {latestCaptures.length > 0 && (
          <div className="capture-log">
            <div className="section-label"><span>Conflict trail</span><small>Newest first</small></div>
            {latestCaptures.map((capture, index) => (
              <article key={capture.id} style={{ '--delay': `${index * 50}ms` } as AnimationStyle}>
                <span className="capture-glyph">{PIECE_GLYPHS[capture.attacker.kind]}×{PIECE_GLYPHS[capture.captured.kind]}</span>
                <div>
                  <strong>{capture.part.title}</strong>
                  <small>{PIECE_METAPHORS[capture.attacker.kind].label} challenges {PIECE_METAPHORS[capture.captured.kind].label} · {capture.part.hexagramName}</small>
                </div>
                <b title="Attention weight from the captured piece, active piece, and where they met on the board" aria-label={`Attention weight ${capture.resonance}`}>{capture.resonance}</b>
              </article>
            ))}
          </div>
        )}
      </aside>
    </section>
  )
}
