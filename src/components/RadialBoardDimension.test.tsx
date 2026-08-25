import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./board3d/WebChessBoard3D', () => ({
  WebChessBoard3D: ({
    reducedMotion,
    onContextLost,
  }: {
    reducedMotion: boolean
    onContextLost: () => void
  }) => (
    <div
      data-board-dimension="3d"
      data-reduced-motion={String(reducedMotion)}
    >
      Three-dimensional scene
      <button type="button" onClick={onContextLost}>Simulate context loss</button>
    </div>
  ),
}))

import {
  BoardViewSessionProvider,
  RadialBoard,
  type BoardViewMode,
} from './RadialBoard'

function BoardViewSessionHarness() {
  const [viewMode, setViewMode] = useState<BoardViewMode>('2d')
  const [stage, setStage] = useState<'mapping' | 'playing'>('mapping')

  return (
    <BoardViewSessionProvider viewMode={viewMode} setViewMode={setViewMode}>
      <button type="button" onClick={() => setStage('playing')}>
        Begin play
      </button>
      <button type="button" onClick={() => setViewMode('2d')}>
        Begin bounded retry
      </button>
      <RadialBoard
        key={stage}
        parts={[]}
        pieces={[]}
        stage={stage}
        disabled
      />
    </BoardViewSessionProvider>
  )
}

function installWebGL(available: boolean) {
  if (available) {
    vi.stubGlobal('WebGLRenderingContext', class WebGLRenderingContext {})
  } else {
    vi.stubGlobal('WebGLRenderingContext', undefined)
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => (
    available && (contextId === 'webgl' || contextId === 'webgl2')
      ? {} as WebGLRenderingContext
      : null
  ))
}

function installMotionPreference(initial: boolean) {
  let listener: EventListenerOrEventListenerObject | null = null
  const query = {
    matches: initial,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: (_type: string, callback: EventListenerOrEventListenerObject) => {
      listener = callback
    },
    removeEventListener: (_type: string, callback: EventListenerOrEventListenerObject) => {
      if (listener === callback) listener = null
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } satisfies MediaQueryList
  vi.stubGlobal('matchMedia', vi.fn(() => query))
  return {
    change(matches: boolean) {
      query.matches = matches
      const event = { matches } as MediaQueryListEvent
      act(() => {
        if (typeof listener === 'function') listener(event)
        else listener?.handleEvent(event)
      })
    },
  }
}

describe('RadialBoard dimension switch', () => {
  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('defaults to the complete 2D board and makes 3D an explicit reversible choice', async () => {
    installWebGL(true)
    installMotionPreference(false)
    const { container } = render(
      <RadialBoard parts={[]} pieces={[]} stage="reading" disabled />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '3D world' })).toBeVisible()
    })
    expect(container.querySelector('.radial-board__svg')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(64)
    expect(screen.getByRole('button', { name: '2D board' }))
      .toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '3D world' }))

    await waitFor(() => {
      expect(container.querySelector('[data-board-dimension="3d"]')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '3D world' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status'))
      .toHaveTextContent('Three-dimensional board enabled.')

    fireEvent.click(screen.getByRole('button', { name: '2D board' }))

    expect(container.querySelector('.radial-board__svg')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(64)
    expect(screen.getByRole('button', { name: '2D board' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status'))
      .toHaveTextContent('Accessible two-dimensional board enabled.')
  })

  it('ignores stale stored 3D preferences at every fresh board boundary', async () => {
    installWebGL(true)
    installMotionPreference(false)
    window.localStorage.setItem('webchess:board-view', '3d')
    window.sessionStorage.setItem('webchess:board-view', '3d')

    const boundaries = [
      'initial-load',
      'new-game',
      'bounded-retry',
      'restored-session',
      'imported-case',
      'same-field-replay',
    ]
    const { container, rerender } = render(
      <RadialBoard
        key={boundaries[0]}
        parts={[]}
        pieces={[]}
        stage="question"
        disabled
      />,
    )

    for (const [index, boundary] of boundaries.entries()) {
      if (index > 0) {
        rerender(
          <RadialBoard
            key={boundary}
            parts={[]}
            pieces={[]}
            stage={boundary === 'new-game' || boundary === 'bounded-retry'
              ? 'mapping'
              : 'reading'}
            disabled
          />,
        )
      }

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '3D world' })).toBeVisible()
      })
      expect(container.querySelector('.radial-board__svg')).toBeInTheDocument()
      expect(container.querySelector('.board-dimension-shell'))
        .toHaveAttribute('data-board-view', '2d')
      expect(screen.getByRole('button', { name: '2D board' }))
        .toHaveAttribute('aria-pressed', 'true')
    }

    expect(window.localStorage.getItem('webchess:board-view')).toBe('3d')
    expect(window.sessionStorage.getItem('webchess:board-view')).toBe('3d')
  })

  it('keeps an explicit 3D choice across a same-game stage remount and resets it at a boundary', async () => {
    installWebGL(true)
    installMotionPreference(false)
    const { container } = render(<BoardViewSessionHarness />)

    fireEvent.click(await screen.findByRole('button', { name: '3D world' }))
    await waitFor(() => {
      expect(container.querySelector('[data-board-dimension="3d"]')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Begin play' }))
    await waitFor(() => {
      expect(container.querySelector('[data-board-dimension="3d"]')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '3D world' }))
      .toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Begin bounded retry' }))
    expect(container.querySelector('.radial-board__svg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2D board' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('stays on the complete 2D board when WebGL is unavailable', async () => {
    installWebGL(false)
    installMotionPreference(false)
    render(<RadialBoard parts={[]} pieces={[]} stage="reading" disabled />)

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(64)
    })
    expect(screen.queryByRole('button', { name: '3D world' })).not.toBeInTheDocument()
  })

  it('starts in 2D for reduced motion and keeps an explicitly chosen 3D scene static', async () => {
    installWebGL(true)
    installMotionPreference(true)
    const { container } = render(
      <RadialBoard parts={[]} pieces={[]} stage="reading" disabled />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '3D world' })).toBeVisible()
    })
    expect(container.querySelector('.radial-board__svg')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '3D world' }))
    await waitFor(() => {
      expect(container.querySelector('[data-board-dimension="3d"]'))
        .toHaveAttribute('data-reduced-motion', 'true')
    })
  })

  it('returns a live 3D scene to 2D when reduced motion turns on', async () => {
    installWebGL(true)
    const motion = installMotionPreference(false)
    const { container } = render(
      <RadialBoard parts={[]} pieces={[]} stage="reading" disabled />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '3D world' })).toBeVisible()
    })
    fireEvent.click(screen.getByRole('button', { name: '3D world' }))
    await waitFor(() => {
      expect(container.querySelector('[data-board-dimension="3d"]')).toBeInTheDocument()
    })

    motion.change(true)

    expect(container.querySelector('.radial-board__svg')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reduced motion is on, so WebChess changed to the stable two-dimensional board.',
    )
  })

  it('fails closed to 2D after WebGL context loss', async () => {
    installWebGL(true)
    installMotionPreference(false)
    const { container } = render(
      <RadialBoard parts={[]} pieces={[]} stage="reading" disabled />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '3D world' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simulate context loss' }))

    await waitFor(() => {
      expect(container.querySelector('.radial-board__svg')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: '3D world' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'The three-dimensional scene became unavailable. The complete two-dimensional board is still playable.',
    )
  })
})
