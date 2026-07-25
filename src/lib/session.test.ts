import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createWebChessSession,
  deleteWebChessSession,
  getWebChessSession,
  isSessionRequiredError,
} from './session'

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
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createWebChessSession('one-use-code')).resolves.toEqual({
      authenticated: true,
      csrfToken: 'csrf-token',
      expiresAt,
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ accessCode: 'one-use-code' }),
    }))
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
