import { auth } from '@clerk/nextjs/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LOCAL_E2E_AUTH_HEADER } from './e2e'
import {
  LOCAL_HOSTED_AUTH_FLAG,
  LOCAL_SESSION_SECRET_NAME,
  createLocalHostedSessionCookie,
} from './local-session'
import {
  LOCAL_OPENCLAW_AUTH_HEADER,
  LOCAL_OPENCLAW_AUTH_VALUE,
} from './openclaw'
import { getRequestAuth, requireApiUser } from './session'

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}))

const authMock = vi.mocked(auth)

const clerkKeys = [
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'WEBCHESS_E2E_AUTH',
  'WEBCHESS_E2E_USER_ID',
  'WEBCHESS_HMAC_SECRET',
  LOCAL_HOSTED_AUTH_FLAG,
  LOCAL_SESSION_SECRET_NAME,
  'VERCEL',
  'VERCEL_ENV',
  'WEBCHESS_OPENCLAW_ENABLED',
  'WEBCHESS_OPENCLAW_OWNER_ID',
] as const

const originalValues = Object.fromEntries(
  clerkKeys.map((key) => [key, process.env[key]]),
)

afterEach(() => {
  authMock.mockReset()
  for (const key of clerkKeys) {
    const value = originalValues[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('request auth facade', () => {
  it('is build-safe and explicit when Clerk is not configured', async () => {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    delete process.env.CLERK_SECRET_KEY
    delete process.env.WEBCHESS_HMAC_SECRET
    delete process.env[LOCAL_HOSTED_AUTH_FLAG]
    delete process.env[LOCAL_SESSION_SECRET_NAME]

    const request = new Request('http://localhost:3000/api/games')
    await expect(getRequestAuth(request)).resolves.toEqual({
      status: 'unavailable',
    })

    const response = await requireApiUser(request)
    expect(response).toBeInstanceOf(Response)
    if (response instanceof Response) {
      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'authentication_unavailable' },
      })
    }
  })

  it('returns the loopback fixture through the same route facade', async () => {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    delete process.env.CLERK_SECRET_KEY
    process.env.WEBCHESS_E2E_AUTH = 'playwright'
    process.env.WEBCHESS_E2E_USER_ID = 'e2e_route_user'

    const request = new Request('http://localhost:3000/api/games', {
      headers: {
        [LOCAL_E2E_AUTH_HEADER]: 'playwright',
      },
    })

    await expect(requireApiUser(request)).resolves.toEqual({
      userId: 'e2e_route_user',
      source: 'local-e2e',
    })
  })

  it('returns the signed loopback machine session through the same facade', async () => {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    delete process.env.CLERK_SECRET_KEY
    process.env[LOCAL_HOSTED_AUTH_FLAG] = 'true'
    process.env[LOCAL_SESSION_SECRET_NAME] =
      'local-session-secret-material-that-is-stable-32b'
    const requestUrl = 'http://127.0.0.1:3005/api/games'
    const unsigned = new Request(requestUrl, {
      headers: { host: '127.0.0.1:3005' },
    })
    await expect(getRequestAuth(unsigned)).resolves.toEqual({
      status: 'signed-out',
    })

    const cookie = createLocalHostedSessionCookie(unsigned)
    const signed = new Request(requestUrl, {
      headers: {
        host: '127.0.0.1:3005',
        cookie: `${cookie?.name}=${cookie?.value}`,
      },
    })
    await expect(requireApiUser(signed)).resolves.toEqual({
      userId: expect.stringMatching(/^local_[a-f0-9]{32}$/u),
      source: 'local-hosted',
    })
  })

  it('returns a JSON 401 for a configured but signed-out request', async () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_example'
    process.env.CLERK_SECRET_KEY = 'sk_test_example'
    authMock.mockResolvedValue({
      userId: null,
    } as Awaited<ReturnType<typeof auth>>)

    const response = await requireApiUser(
      new Request('https://webchess.example/api/games'),
    )
    expect(response).toBeInstanceOf(Response)
    if (response instanceof Response) {
      expect(response.status).toBe(401)
      expect(response.headers.get('cache-control')).toBe('no-store')
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'authentication_required' },
      })
    }
  })

  it('returns the authenticated Clerk user without exposing session details', async () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_example'
    process.env.CLERK_SECRET_KEY = 'sk_test_example'
    authMock.mockResolvedValue({
      userId: 'user_clerk_123',
    } as Awaited<ReturnType<typeof auth>>)

    await expect(
      getRequestAuth(new Request('https://webchess.example/api/games')),
    ).resolves.toEqual({
      status: 'authenticated',
      user: {
        userId: 'user_clerk_123',
        source: 'clerk',
      },
    })
  })

  it('never falls through from an OpenClaw-marked request to Clerk', async () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_example'
    process.env.CLERK_SECRET_KEY = 'sk_test_example'
    process.env.WEBCHESS_OPENCLAW_ENABLED = 'true'
    process.env.WEBCHESS_OPENCLAW_OWNER_ID = 'openclaw_session_test'
    authMock.mockResolvedValue({
      userId: 'user_clerk_must_not_be_used',
    } as Awaited<ReturnType<typeof auth>>)

    for (const [path, value] of [
      ['/api/games/current', 'malformed'],
      ['/api/account/usage', LOCAL_OPENCLAW_AUTH_VALUE],
    ] as const) {
      const request = new Request(`http://127.0.0.1:3210${path}`, {
        headers: {
          host: '127.0.0.1:3210',
          [LOCAL_OPENCLAW_AUTH_HEADER]: value,
        },
      })
      await expect(getRequestAuth(request)).resolves.toEqual({
        status: 'unavailable',
      })
    }
    expect(authMock).not.toHaveBeenCalled()
  })

  it('returns only the bound OpenClaw principal for a valid marked API request', async () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_example'
    process.env.CLERK_SECRET_KEY = 'sk_test_example'
    process.env.WEBCHESS_OPENCLAW_ENABLED = 'true'
    process.env.WEBCHESS_OPENCLAW_OWNER_ID = 'openclaw_session_test'
    authMock.mockResolvedValue({
      userId: 'user_clerk_must_not_be_used',
    } as Awaited<ReturnType<typeof auth>>)

    await expect(getRequestAuth(new Request(
      'http://127.0.0.1:3210/api/games/current',
      {
        headers: {
          host: '127.0.0.1:3210',
          [LOCAL_OPENCLAW_AUTH_HEADER]: LOCAL_OPENCLAW_AUTH_VALUE,
        },
      },
    ))).resolves.toEqual({
      status: 'authenticated',
      user: {
        source: 'local-openclaw',
        userId: 'openclaw_session_test',
      },
    })
    expect(authMock).not.toHaveBeenCalled()
  })
})
