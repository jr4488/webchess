import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createWebChessSession,
  deleteWebChessSession,
  getWebChessSession,
  isSessionRequiredError,
} from './session'

const API_PROVIDER = {
  id: 'openai-api',
  label: 'OpenAI API',
  billing: 'platform-api',
  localOnly: false,
  dataControlsUrl: 'https://developers.openai.com/api/docs/guides/your-data',
  model: 'gpt-5.6-sol',
  webSearch: 'disabled',
} as const

const OLLAMA_PROVIDER = {
  id: 'ollama',
  label: 'Ollama',
  billing: 'local-compute',
  localOnly: true,
  dataControlsUrl: 'https://docs.ollama.com/faq',
  model: 'qwen3.6:27b',
  webSearch: 'disabled',
} as const

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('access sessions', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('checks the same-origin session without sending a secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ authenticated: false }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getWebChessSession()).resolves.toEqual({ authenticated: false })
    expect(fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
    }))
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('body')
  })

  it('exchanges an access code for an in-memory CSRF session', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      authenticated: true,
      csrfToken: 'csrf-token',
      expiresAt,
      provider: API_PROVIDER,
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createWebChessSession('one-use-code')).resolves.toEqual({
      authenticated: true,
      csrfToken: 'csrf-token',
      expiresAt,
      provider: API_PROVIDER,
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ accessCode: 'one-use-code' }),
    }))
  })

  it('requires complete, internally consistent provider provenance', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        authenticated: true,
        csrfToken: 'csrf-token',
        expiresAt,
      }))
      .mockResolvedValueOnce(jsonResponse({
        authenticated: true,
        csrfToken: 'csrf-token',
        expiresAt,
        provider: {
          id: 'codex-chatgpt',
          label: 'ChatGPT Codex',
          billing: 'platform-api',
          localOnly: false,
          dataControlsUrl: 'javascript:alert(1)',
          model: 'gpt-5.6-sol',
          webSearch: 'live',
        },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getWebChessSession()).rejects.toThrow(/incomplete session/i)
    await expect(getWebChessSession()).rejects.toThrow(/incomplete session/i)
  })

  it('parses local ChatGPT Codex provenance without account details', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    const provider = {
      id: 'codex-chatgpt',
      label: 'ChatGPT Codex',
      billing: 'chatgpt-workspace',
      localOnly: true,
      dataControlsUrl: 'https://help.openai.com/en/articles/7730893-data-controls-faq',
      model: 'gpt-5.6-sol',
      webSearch: 'live',
    } as const
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      authenticated: true,
      csrfToken: 'csrf-token',
      expiresAt,
      provider,
    })))

    await expect(getWebChessSession()).resolves.toEqual({
      authenticated: true,
      csrfToken: 'csrf-token',
      expiresAt,
      provider,
    })
  })

  it('parses loopback-only Ollama provenance without API billing', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      authenticated: true,
      csrfToken: 'csrf-token',
      expiresAt,
      provider: OLLAMA_PROVIDER,
    })))

    await expect(getWebChessSession()).resolves.toEqual({
      authenticated: true,
      csrfToken: 'csrf-token',
      expiresAt,
      provider: OLLAMA_PROVIDER,
    })
  })

  it('rejects unsupported or inconsistent web-search metadata', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        authenticated: true,
        csrfToken: 'csrf-token',
        expiresAt,
        provider: {
          ...API_PROVIDER,
          webSearch: 'automatic',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        authenticated: true,
        csrfToken: 'csrf-token',
        expiresAt,
        provider: {
          ...API_PROVIDER,
          webSearch: 'live',
        },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getWebChessSession()).rejects.toThrow(/incomplete session/i)
    await expect(getWebChessSession()).rejects.toThrow(/incomplete session/i)
  })

  it('recognizes an invalid or expired session without retaining the code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: 'That access code is not valid.',
    }, 401)))

    const failure = await createWebChessSession('do-not-retain').catch((error: unknown) => error)
    expect(isSessionRequiredError(failure)).toBe(true)
    expect(failure).toMatchObject({ message: 'That access code is not valid.', status: 401 })
  })

  it('uses the CSRF token when ending a session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ authenticated: false }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(deleteWebChessSession('csrf-token')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({
      method: 'DELETE',
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-WebChess-CSRF': 'csrf-token' }),
    }))
  })
})
