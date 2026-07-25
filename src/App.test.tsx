import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { makeDivisionAnalysis } from './test/fixtures'

const ACTIVE_SESSION = {
  authenticated: true,
  csrfToken: 'test-csrf-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function submitProblem(problem: string): Promise<void> {
  await act(async () => {})
  fireEvent.change(screen.getByLabelText(/what are you trying to understand/i), {
    target: { value: problem },
  })
  fireEvent.click(screen.getByRole('button', { name: /divide the problem/i }))
  await act(async () => {})
}

async function finishMapping(): Promise<void> {
  for (let phase = 0; phase < 5; phase += 1) {
    await act(() => vi.advanceTimersByTimeAsync(850))
  }
  await act(() => vi.advanceTimersByTimeAsync(6_500))
}

describe('WebChess flow', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('gates paid play until an access code starts a server session', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input === '/api/session' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(ACTIVE_SESSION))
      }
      if (input === '/api/session') {
        return Promise.resolve(jsonResponse({ authenticated: false }))
      }
      throw new Error(`Unexpected paid request before authentication: ${input}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await act(async () => {})

    fireEvent.change(screen.getByLabelText(/access code/i), {
      target: { value: 'private-access-code' },
    })
    fireEvent.click(screen.getByRole('button', { name: /enter webchess/i }))
    await act(async () => {})

    expect(fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ accessCode: 'private-access-code' }),
    }))
    expect(screen.getByLabelText(/what are you trying to understand/i)).toBeInTheDocument()
    expect(screen.queryByDisplayValue('private-access-code')).not.toBeInTheDocument()
  })

  it('shows the semantic pipeline, maps 64 server facets, and asks GPT after the game', async () => {
    vi.useFakeTimers()
    const division = makeDivisionAnalysis('full-flow-seed')
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input === '/api/session') return Promise.resolve(jsonResponse(ACTIVE_SESSION))
      if (input === '/api/divide') return Promise.resolve(jsonResponse(division))
      if (input === '/api/answer') {
        return Promise.resolve(jsonResponse({
          answer: 'Protect the purpose, then test the smallest reversible next step.',
          model: 'gpt-5.6-sol',
          prompt: 'Canonical WebChess prompt made from the complete conflict trail.',
        }))
      }
      throw new Error(`Unexpected request: ${input}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await submitProblem('How should thoughtful plan 0 move into its next useful phase?')
    expect(screen.getAllByText(/64 sol facets received/i).length).toBeGreaterThan(0)

    await act(() => vi.advanceTimersByTimeAsync(800))
    expect(screen.getAllByText(/problem facets independently shuffled/i).length).toBeGreaterThan(0)
    await act(() => vi.advanceTimersByTimeAsync(800))
    expect(screen.getAllByText(/i ching lenses independently shuffled/i).length).toBeGreaterThan(0)
    await act(() => vi.advanceTimersByTimeAsync(800))
    expect(screen.getAllByText(/facets paired with hexagrams/i).length).toBeGreaterThan(0)
    await finishMapping()

    expect(screen.getByRole('progressbar', { name: /facets cast onto the board/i })).toHaveAttribute(
      'aria-valuenow',
      '64',
    )
    expect(screen.getByLabelText(/64-part board is complete/i)).not.toHaveAttribute('aria-busy')
    expect(document.querySelectorAll('.division-pipeline li.is-complete')).toHaveLength(6)
    expect(screen.getAllByText(/sol facet/i).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /set the pieces in motion/i }))
    fireEvent.click(screen.getByRole('button', { name: /auto-play to the end/i }))

    for (let turn = 0; turn < 60; turn += 1) {
      await act(() => vi.advanceTimersByTimeAsync(700))
      const depth = screen.queryByRole('progressbar', { name: /captured signal depth/i })
      if (depth?.getAttribute('aria-valuenow') === '7') break
    }

    expect(screen.getByRole('region', { name: /play the problem/i })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /captured signal depth/i })).toHaveAttribute('aria-valuenow', '7')
    expect(screen.queryByRole('region', { name: /final webchess answer/i })).not.toBeInTheDocument()

    let terminalMove = 0
    for (let turn = 0; turn < 300; turn += 1) {
      await act(() => vi.advanceTimersByTimeAsync(700))
      if (screen.queryByText(/game complete · weaving the final answer/i)) {
        terminalMove = Number.parseInt(
          document.querySelector('.turn-header .eyebrow')?.textContent?.match(/\d+/)?.[0] ?? '0',
          10,
        )
        break
      }
    }
    expect(terminalMove).toBeGreaterThan(0)
    await act(() => vi.advanceTimersByTimeAsync(1_200))
    await act(async () => {})

    expect(screen.getByRole('region', { name: /final webchess answer/i })).toBeInTheDocument()
    expect(screen.getByText(/protect the purpose, then test/i)).toBeInTheDocument()
    expect(screen.getByText(/gpt-5\.6-sol · answer from \d+ captured signals/i)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const answerRequest = fetchMock.mock.calls.find(([url]) => url === '/api/answer')
    expect(answerRequest).toBeDefined()
    expect(answerRequest?.[1]).toMatchObject({
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-WebChess-CSRF': 'test-csrf-token' }),
    })
    const body = JSON.parse(String(answerRequest?.[1]?.body)) as {
      captures: Array<{ part: { title: string; focus: string } }>
      outcome: { reason: string; completedTurn: number }
    }
    expect(body.captures.length).toBeGreaterThanOrEqual(7)
    expect(body.captures[0].part.title).toMatch(/Sol facet/i)
    expect(body.captures[0].part.focus).toMatch(/Concrete focus/i)
    expect(['king-captured', 'no-progress', 'move-limit']).toContain(body.outcome.reason)
    expect(body.outcome.completedTurn).toBe(terminalMove)
  })

  it('does not reveal a local fallback while semantic analysis is pending or failed', async () => {
    vi.useFakeTimers()
    let resolveDivision: ((response: Response) => void) | undefined
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input === '/api/session') return Promise.resolve(jsonResponse(ACTIVE_SESSION))
      return new Promise<Response>((resolve) => {
      resolveDivision = resolve
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await submitProblem('What is the clearest next step for this difficult decision?')
    expect(screen.getAllByText(/sol analyzing 64 candidate facets/i).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText(/facets mapped/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /set the pieces in motion/i })).toBeDisabled()

    await act(() => vi.advanceTimersByTimeAsync(8_000))
    expect(screen.queryByLabelText(/facets mapped/i)).not.toBeInTheDocument()
    expect(document.querySelector('.current-lens')).not.toBeInTheDocument()
    expect(screen.queryByText(/sol facet \d/i)).not.toBeInTheDocument()

    await act(async () => {
      resolveDivision?.(jsonResponse({
        error: 'Semantic analysis is unavailable right now.',
        prompt: 'Canonical division prompt waiting for Sol.',
      }, 503))
    })

    expect(screen.getByText(/semantic analysis is unavailable/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try the division again/i })).toBeInTheDocument()
    expect(screen.getByText(/see the analysis prompt/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /set the pieces in motion/i })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the completed-game prompt visible when the answer service is not configured', async () => {
    vi.useFakeTimers()
    const division = makeDivisionAnalysis('answer-error-seed')
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: string) => {
      if (input === '/api/session') return Promise.resolve(jsonResponse(ACTIVE_SESSION))
      if (input === '/api/divide') return Promise.resolve(jsonResponse(division))
      return Promise.resolve(jsonResponse({
        error: 'Set OPENAI_API_KEY on the WebChess server, then try again.',
        prompt: 'The complete prompt is ready for gpt-5.6-sol.',
      }, 503))
    }))
    render(<App />)

    await submitProblem('What is the clearest next step for this difficult decision?')
    await finishMapping()
    fireEvent.click(screen.getByRole('button', { name: /set the pieces in motion/i }))
    fireEvent.click(screen.getByRole('button', { name: /auto-play to the end/i }))

    for (let turn = 0; turn < 300; turn += 1) {
      await act(() => vi.advanceTimersByTimeAsync(700))
      if (screen.queryByRole('region', { name: /final webchess answer/i })) break
    }
    await act(() => vi.advanceTimersByTimeAsync(1_200))
    await act(async () => {})

    expect(screen.getByText(/set openai_api_key/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try the answer again/i })).toBeInTheDocument()
    expect(screen.getByText(/see the prompt waiting to be sent/i)).toBeInTheDocument()
  })

  it('returns to the access gate when a paid request reports an expired session', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input === '/api/session') return Promise.resolve(jsonResponse(ACTIVE_SESSION))
      if (input === '/api/divide') {
        return Promise.resolve(jsonResponse({
          error: 'Your access session has expired.',
        }, 401))
      }
      throw new Error(`Unexpected request: ${input}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await submitProblem('How should this plan change without losing its purpose?')

    expect(screen.getByLabelText(/access code/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/session has expired/i)
    expect(fetchMock).toHaveBeenCalledWith('/api/divide', expect.objectContaining({
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-WebChess-CSRF': 'test-csrf-token' }),
    }))
  })

  it('ends the server session with CSRF protection before clearing the client', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input === '/api/session' && init?.method === 'DELETE') {
        return Promise.resolve(jsonResponse({ authenticated: false }))
      }
      if (input === '/api/session') return Promise.resolve(jsonResponse(ACTIVE_SESSION))
      throw new Error(`Unexpected request: ${input}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: /end session/i }))
    await act(async () => {})

    expect(fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({
      method: 'DELETE',
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-WebChess-CSRF': 'test-csrf-token' }),
    }))
    expect(screen.getByLabelText(/access code/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/session has ended/i)
  })
})
