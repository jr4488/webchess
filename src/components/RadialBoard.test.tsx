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
  it('uses Portia the spider in the center instead of the former yin-yang mark', () => {
    const { container } = render(
      <RadialBoard
        parts={[]}
        pieces={[]}
      />,
    )

    expect(container.querySelector('.radial-board__hub-spider')).toBeInTheDocument()
    expect(container.querySelector('.radial-board__hub-web')).toBeInTheDocument()
    expect(container.querySelector('.radial-board__yin-yang')).not.toBeInTheDocument()
    expect(container.querySelector('.radial-board__yin-dot')).not.toBeInTheDocument()
    expect(container.querySelector('.radial-board__yang-dot')).not.toBeInTheDocument()
  })

  it('moves Portia to the actual current signal and exposes reviewed progress', async () => {
    const { container } = render(
      <RadialBoard
        parts={[mappedPart]}
        pieces={[]}
        stage="reading"
        revealParts
        disabled
        portiaActivity={{
          status: 'running',
          currentCell: { ring: 0, sector: 0 },
          currentLabel: 'Strategic tension: Balance the options without forcing certainty.',
          reviewedCellKeys: ['0:1'],
          announcement: 'Portia is reviewing signal 2 of 7 with all 13 checks.',
        }}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('.radial-board__portia-spider'))
        .toHaveAttribute('data-portia-cell', '0:0')
    })
    expect(container.querySelector('.radial-board__portia-spider')).toHaveClass('is-running')
    expect(container.querySelector('.radial-board__hub-spider')).not.toBeInTheDocument()
    expect(
      screen.getByRole('listitem', {
        name: /ring 1, north.*Portia is currently reviewing this signal/i,
      }),
    ).toHaveClass('is-portia-current')
    expect(
      screen.getByRole('listitem', {
        name: /ring 1, north-east.*Portia review completed for this signal/i,
      }),
    ).toHaveClass('is-portia-reviewed')
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(
      /reviewing signal 2 of 7.*Current signal: Strategic tension/i,
    )
  })

  it('follows persisted Portia progress rather than choosing a decorative square', async () => {
    const activity = (
      currentCell: { ring: number; sector: number },
      reviewedCellKeys: readonly string[],
    ) => ({
      status: 'running' as const,
      currentCell,
      currentLabel: `Signal at ${currentCell.ring}:${currentCell.sector}`,
      reviewedCellKeys,
      announcement: `Portia advanced to ${currentCell.ring}:${currentCell.sector}.`,
    })
    const { container, rerender } = render(
      <RadialBoard
        parts={[]}
        pieces={[]}
        stage="reading"
        disabled
        portiaActivity={activity({ ring: 2, sector: 3 }, [])}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('.radial-board__portia-spider'))
        .toHaveAttribute('data-portia-cell', '2:3')
    })

    rerender(
      <RadialBoard
        parts={[]}
        pieces={[]}
        stage="reading"
        disabled
        portiaActivity={activity({ ring: 5, sector: 6 }, ['2:3'])}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('.radial-board__portia-spider'))
        .toHaveAttribute('data-portia-cell', '5:6')
    })
    expect(container.querySelector('[data-cell="2:3"]')).toHaveClass('is-portia-reviewed')
    expect(container.querySelector('[data-cell="5:6"]')).toHaveClass('is-portia-current')
  })

  it('returns Portia to a stable center state after all signal reviews complete', () => {
    const { container } = render(
      <RadialBoard
        parts={[]}
        pieces={[]}
        stage="reading"
        disabled
        portiaActivity={{
          status: 'complete',
          currentCell: null,
          currentLabel: null,
          reviewedCellKeys: ['0:0', '2:3'],
          announcement: 'Portia completed the review of 2 board signals.',
        }}
      />,
    )

    expect(container.querySelector('.radial-board__portia-spider'))
      .toHaveAttribute('data-portia-cell', 'center')
    expect(container.querySelector('.radial-board__portia-spider')).toHaveClass('is-complete')
    expect(container.querySelectorAll('.is-portia-current')).toHaveLength(0)
    expect(container.querySelectorAll('.is-portia-reviewed')).toHaveLength(2)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Portia completed the review of 2 board signals.',
    )
  })

  it('ignores a stale terminal candidate while preserving saved reviewed highlights', () => {
    const { container } = render(
      <RadialBoard
        parts={[]}
        pieces={[]}
        stage="reading"
        disabled
        portiaActivity={{
          status: 'unavailable',
          currentCell: { ring: 2, sector: 2 },
          currentLabel: 'Stale persisted candidate',
          reviewedCellKeys: ['0:0', '2:3'],
          announcement:
            'Portia could not complete prompt validation after 3 provider attempts. 2 of 3 board signals have saved reviews; no answer was generated.',
        }}
      />,
    )

    const spider = container.querySelector('.radial-board__portia-spider')
    expect(spider).toHaveAttribute('data-portia-cell', 'center')
    expect(spider).toHaveClass('is-unavailable')
    expect(spider).not.toHaveClass('is-running')
    expect((spider as HTMLElement | null)?.style.getPropertyValue('--portia-x'))
      .toBe('50%')
    expect((spider as HTMLElement | null)?.style.getPropertyValue('--portia-y'))
      .toBe('50%')
    expect(container.querySelectorAll('.is-portia-current')).toHaveLength(0)
    expect(container.querySelectorAll('.is-portia-reviewed')).toHaveLength(2)
    expect(screen.getByRole('listitem', {
      name: /ring 1, north.*Portia review completed for this signal/i,
    })).toHaveClass('is-portia-reviewed')
    expect(container.querySelector('[data-cell="2:2"]')?.getAttribute('aria-label'))
      .not.toMatch(/Portia is currently reviewing this signal/i)
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(
      /could not complete prompt validation after 3 provider attempts.*2 of 3 board signals have saved reviews.*no answer was generated/i,
    )
    expect(screen.getByRole('status')).not.toHaveTextContent(/Current signal:/i)
    expect(screen.getByRole('status')).not.toHaveTextContent(/Stale persisted candidate/i)
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
