import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

import { RadialBoard } from './RadialBoard'

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
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('defaults to 3D when WebGL is available and keeps the full 2D board one click away', async () => {
    installWebGL(true)
    installMotionPreference(false)
    const { container } = render(
      <RadialBoard parts={[]} pieces={[]} stage="reading" disabled />,
    )

    await waitFor(() => {
      expect(container.querySelector('[data-board-dimension="3d"]')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '3D world' }))
      .toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '2D board' }))

    expect(container.querySelector('.radial-board__svg')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(64)
    expect(screen.getByRole('button', { name: '2D board' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status'))
      .toHaveTextContent('Accessible two-dimensional board enabled.')
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

    fireEvent.click(await screen.findByRole('button', { name: 'Simulate context loss' }))

    await waitFor(() => {
      expect(container.querySelector('.radial-board__svg')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: '3D world' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'The three-dimensional scene became unavailable. The complete two-dimensional board is still playable.',
    )
  })
})
