'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'

import { cellKey } from '../lib/board'
import type { CellCoord, LastMove, Piece, ProblemPart, Side, Stage } from '../types'

export interface RadialBoardProps {
  parts: readonly ProblemPart[]
  pieces: readonly Piece[]
  stage?: Stage
  mappingProgress?: number
  revealParts?: boolean
  activeSide?: Side
  selectedPieceId?: string | null
  legalMoves?: readonly CellCoord[]
  capturedCellKeys?: ReadonlySet<string> | readonly string[]
  highlightedCellKeys?: ReadonlySet<string> | readonly string[]
  lastMove?: LastMove | null
  disabled?: boolean
  onPieceSelect?: (pieceId: string) => void
  onCellSelect?: (cell: CellCoord) => void
  className?: string
}

const BOARD_SIZE = 800
const BOARD_CENTER = BOARD_SIZE / 2
const INNER_RADIUS = 82
const OUTER_RADIUS = 370
const RINGS = 8
const SECTORS = 8
const RING_WIDTH = (OUTER_RADIUS - INNER_RADIUS) / RINGS
const SECTOR_ANGLE = 360 / SECTORS
const SECTOR_GAP = 0.7
const RING_GAP = 1.2

const PIECE_GLYPHS = {
  white: {
    king: '\u2654',
    queen: '\u2655',
    rook: '\u2656',
    bishop: '\u2657',
    knight: '\u2658',
    pawn: '\u2659',
  },
  black: {
    king: '\u265A',
    queen: '\u265B',
    rook: '\u265C',
    bishop: '\u265D',
    knight: '\u265E',
    pawn: '\u265F',
  },
} as const

const SECTOR_LABELS = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west']

type BoardStyle = CSSProperties & Record<`--${string}`, string | number>

function polarPoint(radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180
  return {
    x: BOARD_CENTER + radius * Math.cos(radians),
    y: BOARD_CENTER + radius * Math.sin(radians),
  }
}

function annularSectorPath(ring: number, sector: number) {
  const innerRadius = INNER_RADIUS + ring * RING_WIDTH + RING_GAP / 2
  const outerRadius = INNER_RADIUS + (ring + 1) * RING_WIDTH - RING_GAP / 2
  const startAngle = sector * SECTOR_ANGLE - SECTOR_ANGLE / 2 + SECTOR_GAP / 2
  const endAngle = sector * SECTOR_ANGLE + SECTOR_ANGLE / 2 - SECTOR_GAP / 2
  const outerStart = polarPoint(outerRadius, startAngle)
  const outerEnd = polarPoint(outerRadius, endAngle)
  const innerEnd = polarPoint(innerRadius, endAngle)
  const innerStart = polarPoint(innerRadius, startAngle)

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 0 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ')
}

function cellCenter(cell: CellCoord) {
  const radius = INNER_RADIUS + (cell.ring + 0.5) * RING_WIDTH
  const angle = cell.sector * SECTOR_ANGLE
  return polarPoint(radius, angle)
}

/**
 * The board's geometry never changes, so the 64 sector paths and centres are
 * computed once at module load rather than on every render. Auto-play
 * re-renders this component on every ply, and the trigonometry was being
 * repeated in full each time.
 */
const BOARD_CELLS = Array.from({ length: RINGS * SECTORS }, (_, index) => {
  const coordinate: CellCoord = {
    ring: Math.floor(index / SECTORS),
    sector: index % SECTORS,
  }
  return {
    index,
    coordinate,
    key: cellKey(coordinate),
    path: annularSectorPath(coordinate.ring, coordinate.sector),
    center: cellCenter(coordinate),
    shade: (coordinate.ring + coordinate.sector) % 2 === 0 ? 'is-light' : 'is-dark',
  }
})

const SECTOR_LABEL_POINTS = SECTOR_LABELS.map((label, sector) => ({
  label,
  sector,
  point: polarPoint(OUTER_RADIUS + 14, sector * SECTOR_ANGLE),
}))

const RING_LABEL_POINTS = Array.from({ length: RINGS }, (_, ring) => ({
  ring,
  point: polarPoint(INNER_RADIUS + (ring + 0.5) * RING_WIDTH, -10),
}))

function toKeySet(keys: ReadonlySet<string> | readonly string[] | undefined) {
  if (!keys) return new Set<string>()
  return keys instanceof Set ? keys : new Set(keys)
}

function sameCell(left: CellCoord | undefined, right: CellCoord) {
  return Boolean(left && left.ring === right.ring && left.sector === right.sector)
}

function isValidCell(cell: CellCoord) {
  return (
    Number.isInteger(cell.ring) &&
    Number.isInteger(cell.sector) &&
    cell.ring >= 0 &&
    cell.ring < RINGS &&
    cell.sector >= 0 &&
    cell.sector < SECTORS
  )
}

function keyboardDestination(
  coordinate: CellCoord,
  event: KeyboardEvent<SVGGElement>,
): CellCoord | null {
  switch (event.key) {
    case 'ArrowUp':
      return { ring: Math.max(0, coordinate.ring - 1), sector: coordinate.sector }
    case 'ArrowDown':
      return { ring: Math.min(RINGS - 1, coordinate.ring + 1), sector: coordinate.sector }
    case 'ArrowLeft':
      return { ring: coordinate.ring, sector: (coordinate.sector + SECTORS - 1) % SECTORS }
    case 'ArrowRight':
      return { ring: coordinate.ring, sector: (coordinate.sector + 1) % SECTORS }
    case 'Home':
      return event.ctrlKey ? { ring: 0, sector: 0 } : { ring: coordinate.ring, sector: 0 }
    case 'End':
      return event.ctrlKey
        ? { ring: RINGS - 1, sector: SECTORS - 1 }
        : { ring: coordinate.ring, sector: SECTORS - 1 }
    default:
      return null
  }
}

export function RadialBoard({
  parts,
  pieces,
  stage = 'playing',
  mappingProgress = 64,
  revealParts = false,
  activeSide,
  selectedPieceId = null,
  legalMoves = [],
  capturedCellKeys,
  highlightedCellKeys,
  lastMove = null,
  disabled = false,
  onPieceSelect,
  onCellSelect,
  className = '',
}: RadialBoardProps) {
  const hubGlowId = useId().replaceAll(':', '')
  const instructionsId = useId()
  const boardRef = useRef<HTMLElement>(null)
  const cellsRef = useRef<SVGGElement>(null)
  // Whether the last interaction came from the keyboard. Selecting a piece with
  // a pointer must not pull focus into the board and scroll the page.
  const keyboardIntentRef = useRef(false)
  const [rovingCellKey, setRovingCellKey] = useState<string>(cellKey({ ring: 0, sector: 0 }))
  const legalMoveKeys = useMemo(
    () => new Set(legalMoves.filter(isValidCell).map(cellKey)),
    [legalMoves],
  )
  const capturedKeys = useMemo(() => toKeySet(capturedCellKeys), [capturedCellKeys])
  const highlightedKeys = useMemo(() => toKeySet(highlightedCellKeys), [highlightedCellKeys])
  // One pass over the pieces instead of a scan of every piece for all 64 cells.
  const pieceByCell = useMemo(() => {
    const occupants = new Map<string, Piece>()
    for (const piece of pieces) {
      if (isValidCell(piece.position)) occupants.set(cellKey(piece.position), piece)
    }
    return occupants
  }, [pieces])
  const mappedCount = Math.max(0, Math.min(64, Math.floor(mappingProgress)))
  const isInteractive = !disabled && Boolean(onCellSelect)
  const isReadOnlyBoard = disabled && stage !== 'question'

  const selectCell = (coordinate: CellCoord) => {
    if (!disabled) onCellSelect?.(coordinate)
  }

  const focusCell = (coordinate: CellCoord) => {
    const key = cellKey(coordinate)
    setRovingCellKey(key)
    cellsRef.current?.querySelector<SVGGElement>(`[data-cell="${key}"]`)?.focus()
  }

  const handleCellKeyDown = (
    event: KeyboardEvent<SVGGElement>,
    coordinate: CellCoord,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectCell(coordinate)
      return
    }

    const destination = keyboardDestination(coordinate, event)
    if (!destination) return

    event.preventDefault()
    focusCell(destination)
  }

  useEffect(() => {
    if (disabled || !selectedPieceId || legalMoveKeys.size === 0) return

    const frame = window.requestAnimationFrame(() => {
      const destination = cellsRef.current?.querySelector<SVGGElement>('.radial-board__cell.is-legal')
      if (!destination) return
      // Always move the tab stop, so tabbing into the board lands on a move
      // that is actually available.
      setRovingCellKey(destination.dataset.cell ?? cellKey({ ring: 0, sector: 0 }))
      // Only take focus for a player already navigating by keyboard. Doing it
      // after a click moved focus away from whatever the player was using.
      if (keyboardIntentRef.current) destination.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [disabled, legalMoveKeys, selectedPieceId])

  return (
    <section
      className={`radial-board ${className}`.trim()}
      data-stage={stage}
      data-interactive={isInteractive || undefined}
      aria-label="WebChess circular board"
      ref={boardRef}
      onKeyDownCapture={() => { keyboardIntentRef.current = true }}
      onPointerDownCapture={() => { keyboardIntentRef.current = false }}
    >
      {isInteractive && (
        <p className="sr-only" id={instructionsId}>
          Use the arrow keys to move between board cells, Home and End to move within a ring,
          and Enter or Space to choose a cell.
        </p>
      )}
      <div className="radial-board__canvas">
        <svg
          className="radial-board__svg"
          viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
          role="group"
          aria-label="Eight rings by eight sectors problem-solving chess board"
          aria-describedby={isInteractive ? instructionsId : undefined}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <radialGradient id={hubGlowId}>
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
          </defs>

          <circle
            className="radial-board__aura"
            cx={BOARD_CENTER}
            cy={BOARD_CENTER}
            r={OUTER_RADIUS + 18}
            fill={`url(#${hubGlowId})`}
            aria-hidden="true"
          />

          <g
            className="radial-board__cells"
            ref={cellsRef}
            role={isReadOnlyBoard ? 'list' : undefined}
            aria-label={isReadOnlyBoard ? 'Board cells' : undefined}
          >
            {BOARD_CELLS.map(({ coordinate, index, key, path, center, shade }) => {
              const part = parts[index]
              const isLegal = legalMoveKeys.has(key)
              const isCaptured = capturedKeys.has(key)
              const isHighlighted = highlightedKeys.has(key)
              const isLastMove = sameCell(lastMove?.from, coordinate) || sameCell(lastMove?.to, coordinate)
              const occupant = pieceByCell.get(key)
              const isMapped = stage !== 'question' && (stage !== 'mapping' || index < mappedCount)
              const showPart = isMapped && (revealParts || stage === 'reading')
              const label = [
                `Ring ${coordinate.ring + 1}, ${SECTOR_LABELS[coordinate.sector]}`,
                part && isMapped ? `${part.title}: ${part.focus}` : null,
                part && isMapped ? `paired with ${part.hexagramName}: ${part.theme}` : null,
                occupant ? `occupied by ${occupant.side} ${occupant.kind}` : null,
                isLegal ? 'legal move' : null,
                isCaptured ? 'capture focus' : null,
                isHighlighted ? 'highlighted focus' : null,
                isLastMove ? 'part of the last move' : null,
                stage === 'mapping' && !isMapped ? 'not mapped yet' : null,
              ]
                .filter(Boolean)
                .join(', ')

              const cellClasses = [
                'radial-board__cell',
                shade,
                isMapped ? 'is-mapped' : 'is-unmapped',
                isLegal ? 'is-legal' : '',
                isCaptured ? 'is-captured' : '',
                isHighlighted ? 'is-highlighted' : '',
                isLastMove ? 'is-last-move' : '',
              ]
                .filter(Boolean)
                .join(' ')

              return (
                <g
                  className={cellClasses}
                  data-cell={key}
                  data-ring={coordinate.ring}
                  data-sector={coordinate.sector}
                  data-part-id={part?.id}
                  key={key}
                  role={isInteractive ? 'button' : isReadOnlyBoard ? 'listitem' : undefined}
                  aria-label={isInteractive || isReadOnlyBoard ? label : undefined}
                  aria-hidden={disabled && !isReadOnlyBoard ? true : undefined}
                  tabIndex={isInteractive && key === rovingCellKey ? 0 : -1}
                  onClick={isInteractive ? () => selectCell(coordinate) : undefined}
                  onKeyDown={
                    isInteractive
                      ? (event) => handleCellKeyDown(event, coordinate)
                      : undefined
                  }
                  style={{ '--cell-index': index, '--mapping-order': index } as BoardStyle}
                >
                  <title>{label}</title>
                  <path className="radial-board__cell-shape" d={path} />
                  {isLegal && (
                    <circle
                      className="radial-board__move-marker"
                      cx={center.x}
                      cy={center.y}
                      r="7"
                      aria-hidden="true"
                    />
                  )}
                  {showPart && part && (
                    <text
                      className="radial-board__part-label"
                      x={center.x}
                      y={center.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      aria-hidden="true"
                    >
                      {part.hexagram}
                    </text>
                  )}
                </g>
              )
            })}
          </g>

          <g className="radial-board__hub" aria-hidden="true">
            <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={INNER_RADIUS - 8} className="radial-board__hub-disc" />
            <path
              className="radial-board__yin"
              d={`M ${BOARD_CENTER} ${BOARD_CENTER - INNER_RADIUS + 8}
                  A ${INNER_RADIUS - 8} ${INNER_RADIUS - 8} 0 0 1 ${BOARD_CENTER} ${BOARD_CENTER + INNER_RADIUS - 8}
                  A ${(INNER_RADIUS - 8) / 2} ${(INNER_RADIUS - 8) / 2} 0 0 1 ${BOARD_CENTER} ${BOARD_CENTER}
                  A ${(INNER_RADIUS - 8) / 2} ${(INNER_RADIUS - 8) / 2} 0 0 0 ${BOARD_CENTER} ${BOARD_CENTER - INNER_RADIUS + 8} Z`}
            />
            <circle cx={BOARD_CENTER} cy={BOARD_CENTER - (INNER_RADIUS - 8) / 2} r="8" className="radial-board__yang-dot" />
            <circle cx={BOARD_CENTER} cy={BOARD_CENTER + (INNER_RADIUS - 8) / 2} r="8" className="radial-board__yin-dot" />
          </g>

          <g className="radial-board__labels" aria-hidden="true">
            {SECTOR_LABEL_POINTS.map(({ label, sector, point }) => (
              <text key={label} x={point.x} y={point.y} textAnchor="middle" dominantBaseline="middle">
                {sector + 1}
              </text>
            ))}
            {RING_LABEL_POINTS.map(({ ring, point }) => (
              <text
                className="radial-board__ring-label"
                key={ring}
                x={point.x}
                y={point.y}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {ring + 1}
              </text>
            ))}
          </g>
        </svg>

        <div className="radial-board__pieces" role="group" aria-label="Chess pieces" aria-hidden={disabled || undefined}>
          {pieces.filter((piece) => isValidCell(piece.position)).map((piece) => {
            const point = cellCenter(piece.position)
            const isSelected = piece.id === selectedPieceId
            const isCaptureTarget = Boolean(selectedPieceId && legalMoveKeys.has(cellKey(piece.position)))
            const positionLabel = `${piece.side} ${piece.kind}, ring ${piece.position.ring + 1}, ${
              SECTOR_LABELS[piece.position.sector]
            }`
            const pieceLabel = isCaptureTarget ? `Capture ${positionLabel}` : positionLabel
            const canActivatePiece = isCaptureTarget
              ? Boolean(onCellSelect)
              : Boolean(onPieceSelect) && (!activeSide || piece.side === activeSide)
            const pieceClasses = [
              'radial-board__piece',
              `radial-board__piece--${piece.side}`,
              `radial-board__piece--${piece.kind}`,
              isSelected ? 'is-selected' : '',
              isCaptureTarget ? 'is-capture-target' : '',
            ]
              .filter(Boolean)
              .join(' ')
            const style = {
              '--piece-x': `${(point.x / BOARD_SIZE) * 100}%`,
              '--piece-y': `${(point.y / BOARD_SIZE) * 100}%`,
            } as BoardStyle

            return (
              <button
                className={pieceClasses}
                type="button"
                key={piece.id}
                style={style}
                aria-label={pieceLabel}
                aria-pressed={isSelected}
                title={pieceLabel}
                disabled={disabled || !canActivatePiece}
                onClick={() => {
                  if (isCaptureTarget) onCellSelect?.(piece.position)
                  else onPieceSelect?.(piece.id)
                }}
              >
                <span aria-hidden="true">{PIECE_GLYPHS[piece.side][piece.kind]}</span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
