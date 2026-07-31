import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Piece, ProblemPart } from '../types'
import { RadialBoard } from './RadialBoard'

const pieces: Piece[] = [
  {
    id: 'black-pawn',
    side: 'black',
    kind: 'pawn',
    position: { ring: 3, sector: 2 },
    moved: true,
  },
  {
    id: 'white-rook',
    side: 'white',
    kind: 'rook',
    position: { ring: 3, sector: 0 },
    moved: true,
  },
]

const mappedPart: ProblemPart = {
  id: 1,
  title: 'Strategic tension',
  focus: 'Balance the options without forcing certainty.',
  hexagram: 1,
  hexagramName: 'The Creative',
  theme: 'Sustained initiative',
  dimension: 'Strategy',
  movement: 'Advance',
  prompt: 'What can move now?',
  keyword: 'balance',
}

describe('RadialBoard interaction', () => {
  it('places a dark dot in the white lobe and a light dot in the dark lobe', () => {
    const { container } = render(
      <RadialBoard
        parts={[]}
        pieces={[]}
      />,
    )

    const darkDot = container.querySelector('.radial-board__yin-dot')
    const lightDot = container.querySelector('.radial-board__yang-dot')

    expect(Number(darkDot?.getAttribute('cy'))).toBeLessThan(400)
    expect(Number(lightDot?.getAttribute('cy'))).toBeGreaterThan(400)
  })

  it('uses bold cameo silhouettes on contrasting side medallions', () => {
    render(
      <RadialBoard
        parts={[]}
        pieces={pieces}
      />,
    )

    const whiteRookPiece = screen.getByRole('button', { name: /^white rook,/i })
    const blackPawnPiece = screen.getByRole('button', { name: /^black pawn,/i })

    expect(whiteRookPiece).toHaveClass('radial-board__piece--white')
    expect(whiteRookPiece).toHaveTextContent('♜')
    expect(blackPawnPiece).toHaveClass('radial-board__piece--black')
    expect(blackPawnPiece).toHaveTextContent('♟')
  })

  it('routes a click on an occupied legal destination through the cell capture handler', () => {
    const onCellSelect = vi.fn()
    const onPieceSelect = vi.fn()
    render(
      <RadialBoard
        parts={[]}
        pieces={pieces}
        activeSide="white"
        selectedPieceId="white-rook"
        legalMoves={[{ ring: 3, sector: 2 }]}
        onCellSelect={onCellSelect}
        onPieceSelect={onPieceSelect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /capture black pawn/i }))

    expect(onCellSelect).toHaveBeenCalledWith({ ring: 3, sector: 2 })
    expect(onPieceSelect).not.toHaveBeenCalledWith('black-pawn')
  })

  it('hands keyboard focus to a legal destination after a keyboard piece selection', async () => {
    const board = (selectedPieceId: string | null) => (
      <RadialBoard
        parts={[]}
        pieces={pieces}
        selectedPieceId={selectedPieceId}
        legalMoves={selectedPieceId ? [{ ring: 3, sector: 2 }] : []}
        onCellSelect={vi.fn()}
        onPieceSelect={vi.fn()}
      />
    )
    const { rerender } = render(board(null))

    fireEvent.keyDown(screen.getByRole('button', { name: /^ring 1, north$/i }), {
      key: 'ArrowRight',
    })
    rerender(board('white-rook'))

    const destination = screen.getByRole('button', {
      name: /ring 4, east.*occupied by black pawn.*legal move/i,
    })
    await waitFor(() => expect(destination).toHaveFocus())
  })

  it('moves the tab stop but not focus when a piece is selected by pointer', async () => {
    const board = (selectedPieceId: string | null) => (
      <RadialBoard
        parts={[]}
        pieces={pieces}
        selectedPieceId={selectedPieceId}
        legalMoves={selectedPieceId ? [{ ring: 3, sector: 2 }] : []}
        onCellSelect={vi.fn()}
        onPieceSelect={vi.fn()}
      />
    )
    const { rerender } = render(board(null))

    fireEvent.pointerDown(
      screen.getByRole('button', { name: /^ring 4, north, occupied by white rook$/i }),
    )
    rerender(board('white-rook'))

    const destination = screen.getByRole('button', {
      name: /ring 4, east.*occupied by black pawn.*legal move/i,
    })
    // The tab stop follows the available move, so keyboard users can still
    // reach it, but a pointer user is not yanked into the board.
    await waitFor(() => expect(destination).toHaveAttribute('tabindex', '0'))
    expect(destination).not.toHaveFocus()
  })

  it('uses one roving cell tab stop with coordinate, Home, End, and activation keys', () => {
    const onCellSelect = vi.fn()
    render(
      <RadialBoard
        parts={[]}
        pieces={[]}
        onCellSelect={onCellSelect}
      />,
    )

    const north = screen.getByRole('button', { name: /^ring 1, north$/i })
    const northEast = screen.getByRole('button', { name: /^ring 1, north-east$/i })
    expect(north).toHaveAttribute('tabindex', '0')
    expect(northEast).toHaveAttribute('tabindex', '-1')

    north.focus()
    fireEvent.keyDown(north, { key: 'ArrowRight' })
    expect(northEast).toHaveFocus()
    expect(northEast).toHaveAttribute('tabindex', '0')
    expect(north).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(northEast, { key: 'ArrowDown' })
    const secondRingNorthEast = screen.getByRole('button', {
      name: /^ring 2, north-east$/i,
    })
    expect(secondRingNorthEast).toHaveFocus()

    fireEvent.keyDown(secondRingNorthEast, { key: 'End' })
    const secondRingNorthWest = screen.getByRole('button', {
      name: /^ring 2, north-west$/i,
    })
    expect(secondRingNorthWest).toHaveFocus()

    fireEvent.keyDown(secondRingNorthWest, { key: 'Home' })
    const secondRingNorth = screen.getByRole('button', { name: /^ring 2, north$/i })
    expect(secondRingNorth).toHaveFocus()

    fireEvent.keyDown(secondRingNorth, { key: 'Enter' })
    expect(onCellSelect).toHaveBeenLastCalledWith({ ring: 1, sector: 0 })

    fireEvent.keyDown(secondRingNorth, { key: ' ', code: 'Space' })
    expect(onCellSelect).toHaveBeenLastCalledWith({ ring: 1, sector: 0 })

    fireEvent.keyDown(secondRingNorth, { key: 'End', ctrlKey: true })
    expect(
      screen.getByRole('button', { name: /^ring 8, north-west$/i }),
    ).toHaveFocus()
  })

  it('keeps inactive-side pieces out of the tab order while retaining active pieces', () => {
    const { container } = render(
      <RadialBoard
        parts={[]}
        pieces={pieces}
        activeSide="white"
        onCellSelect={vi.fn()}
        onPieceSelect={vi.fn()}
      />,
    )

    const inactivePiece = screen.getByRole('button', { name: /^black pawn,/i })
    const activePiece = screen.getByRole('button', { name: /^white rook,/i })
    expect(inactivePiece).toBeDisabled()
    expect(activePiece).toBeEnabled()

    const tabStops = [
      ...container.querySelectorAll<HTMLElement>('[tabindex="0"], button:not(:disabled)'),
    ]
    expect(tabStops[0]).toHaveClass('radial-board__cell')
    expect(tabStops[1]).toBe(activePiece)
    expect(tabStops).not.toContain(inactivePiece)
  })

  it('exposes descriptive read-only cells without discarding the SVG board semantics', () => {
    render(
      <RadialBoard
        parts={[mappedPart]}
        pieces={pieces}
        stage="reading"
        revealParts
        disabled
      />,
    )

    const svgBoard = screen.getByRole('group', {
      name: /eight rings by eight sectors problem-solving chess board/i,
    })
    expect(svgBoard.tagName.toLowerCase()).toBe('svg')

    expect(screen.getByRole('list', { name: /board cells/i })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(64)
    expect(
      screen.getByRole('listitem', {
        name: /ring 1, north, strategic tension: balance the options.*paired with the creative/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('listitem', {
        name: /ring 4, east, occupied by black pawn/i,
      }),
    ).toBeInTheDocument()
  })

  it('announces unmapped cells on a read-only mapping board', () => {
    render(
      <RadialBoard
        parts={[mappedPart]}
        pieces={[]}
        stage="mapping"
        mappingProgress={1}
        revealParts
        disabled
      />,
    )

    expect(
      screen.getByRole('listitem', { name: /ring 1, north-east, not mapped yet/i }),
    ).toBeInTheDocument()
  })
})
