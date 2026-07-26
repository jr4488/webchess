import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import type { EngineResult } from './lib/auto-play'
import { makeDivisionAnalysis } from './test/fixtures'

const engineMock = vi.hoisted(() => ({
  chooseMove: vi.fn(),
  reset: vi.fn(),
  dispose: vi.fn(),
}))

vi.mock('./lib/auto-play', () => ({
  createAutoPlayEngine: () => engineMock,
}))

const ACTIVE_SESSION = {
  authenticated: true,
  csrfToken: 'guided-play-csrf',
  expiresAt: '2099-01-01T00:00:00.000Z',
  provider: {
    id: 'openai-api',
    label: 'OpenAI API',
    billing: 'platform-api',
    localOnly: false,
    dataControlsUrl: 'https://developers.openai.com/api/docs/guides/your-data',
    model: 'gpt-5.6-sol',
    webSearch: 'disabled',
  },
} as const

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function enterGuidedPlay(session = ACTIVE_SESSION): Promise<void> {
  const division = makeDivisionAnalysis('guided-play-lifecycle')
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: string) => {
    if (input === '/api/session') return Promise.resolve(jsonResponse(session))
    if (input === '/api/divide') return Promise.resolve(jsonResponse(division))
    throw new Error(`Unexpected request: ${input}`)
  }))

  render(<App />)
  await act(async () => {})
  fireEvent.change(screen.getByLabelText(/what are you trying to understand/i), {
    target: { value: 'How should this plan move into its next useful phase?' },
  })
  fireEvent.click(screen.getByRole('button', { name: /divide the problem/i }))
  await act(async () => {})

  for (let phase = 0; phase < 5; phase += 1) {
    await act(() => vi.advanceTimersByTimeAsync(850))
  }
  await act(() => vi.advanceTimersByTimeAsync(6_500))
  fireEvent.click(screen.getByRole('button', { name: /set the pieces in motion/i }))
}

describe('guided-play search lifecycle', () => {
  let search: ReturnType<typeof deferred<EngineResult>>

  beforeEach(() => {
    vi.useFakeTimers()
    search = deferred<EngineResult>()
    engineMock.chooseMove.mockReset()
    engineMock.chooseMove.mockReturnValue(search.promise)
    engineMock.reset.mockReset()
    engineMock.reset.mockImplementation(() => {
      search.resolve({ status: 'superseded' })
    })
    engineMock.dispose.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('cancels an in-flight move when auto-play is paused and clears thinking', async () => {
    await enterGuidedPlay()
    fireEvent.click(screen.getByRole('button', { name: /auto-play to the end/i }))
    await act(() => vi.advanceTimersByTimeAsync(320))

    expect(engineMock.chooseMove).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /pause auto-play/i })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /pause auto-play/i }))
    await act(async () => {})

    expect(engineMock.reset).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /auto-play to the end/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /play one turn/i })).toBeEnabled()
    expect(document.querySelector('.turn-header .eyebrow')).toHaveTextContent('Move 01')
  })

  it('keeps showing a newer search when it supersedes a manual one', async () => {
    const manualSearch = deferred<EngineResult>()
    const autoSearch = deferred<EngineResult>()
    engineMock.chooseMove
      .mockReset()
      .mockReturnValueOnce(manualSearch.promise)
      .mockReturnValueOnce(autoSearch.promise)

    await enterGuidedPlay()
    fireEvent.click(screen.getByRole('button', { name: /play one turn/i }))
    fireEvent.click(screen.getByRole('button', { name: /auto-play to the end/i }))
    await act(() => vi.advanceTimersByTimeAsync(320))

    expect(engineMock.chooseMove).toHaveBeenCalledTimes(2)
    await act(async () => {
      manualSearch.resolve({ status: 'superseded' })
      await manualSearch.promise
    })

    expect(screen.getByRole('button', { name: /searching/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /pause auto-play/i })).toBeEnabled()

    await act(async () => {
      autoSearch.resolve({ status: 'failed', message: 'Test search complete.' })
      await autoSearch.promise
    })
  })

  it('cancels an in-flight move when the game is reset', async () => {
    await enterGuidedPlay()
    fireEvent.click(screen.getByRole('button', { name: /auto-play to the end/i }))
    await act(() => vi.advanceTimersByTimeAsync(320))

    fireEvent.click(screen.getByRole('button', { name: /new question/i }))
    await act(async () => {})

    expect(engineMock.reset).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText(/what are you trying to understand/i)).toHaveValue('')
  })

  it('cancels an in-flight move when the access session expires', async () => {
    const expiringSession = {
      ...ACTIVE_SESSION,
      expiresAt: new Date(Date.now() + 20_000).toISOString(),
    }
    const renewedSession = {
      ...ACTIVE_SESSION,
      csrfToken: 'renewed-guided-play-csrf',
    }
    const division = makeDivisionAnalysis('guided-play-expiry')
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input === '/api/session' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(renewedSession))
      }
      if (input === '/api/session') return Promise.resolve(jsonResponse(expiringSession))
      if (input === '/api/divide') return Promise.resolve(jsonResponse(division))
      throw new Error(`Unexpected request: ${input}`)
    }))

    render(<App />)
    await act(async () => {})
    fireEvent.change(screen.getByLabelText(/what are you trying to understand/i), {
      target: { value: 'How should this plan move into its next useful phase?' },
    })
    fireEvent.click(screen.getByRole('button', { name: /divide the problem/i }))
    await act(async () => {})
    for (let phase = 0; phase < 5; phase += 1) {
      await act(() => vi.advanceTimersByTimeAsync(850))
    }
    await act(() => vi.advanceTimersByTimeAsync(6_500))
    fireEvent.click(screen.getByRole('button', { name: /set the pieces in motion/i }))
    fireEvent.click(screen.getByRole('button', { name: /auto-play to the end/i }))
    await act(() => vi.advanceTimersByTimeAsync(320))

    expect(engineMock.chooseMove).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(9_000))

    expect(engineMock.reset).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText(/access code/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/access code/i), {
      target: { value: 'renew-access' },
    })
    fireEvent.click(screen.getByRole('button', { name: /enter webchess/i }))
    await act(async () => {})

    expect(document.querySelector('.turn-header .eyebrow')).toHaveTextContent('Move 01')
    expect(screen.getByRole('button', { name: /play one turn/i })).toBeEnabled()
  })
})
