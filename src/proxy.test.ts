import type { NextFetchEvent } from 'next/server'
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import proxy from './proxy'
import { LOCAL_E2E_AUTH_HEADER } from './server/auth/e2e'
import {
  LOCAL_HOSTED_AUTH_FLAG,
  LOCAL_SESSION_SECRET_NAME,
  createLocalHostedSessionCookie,
} from './server/auth/local-session'

const environmentKeys = [
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'WEBCHESS_E2E_AUTH',
  'WEBCHESS_E2E_USER_ID',
  'WEBCHESS_HMAC_SECRET',
  LOCAL_HOSTED_AUTH_FLAG,
  LOCAL_SESSION_SECRET_NAME,
  'VERCEL',
  'VERCEL_ENV',
] as const
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
)
const event = {} as NextFetchEvent

const clearAuthEnvironment = () => {
  for (const key of environmentKeys) {
    delete process.env[key]
  }
}

const runProxy = async (request: NextRequest): Promise<Response> => {
  const response = await proxy(request, event)
  if (!response) {
    throw new Error('Expected the auth proxy to return a response.')
  }
  return response
}

afterEach(() => {
  for (const key of environmentKeys) {
    const value = originalEnvironment[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('auth proxy', () => {
  it('redirects an unconfigured protected page to the local sign-in route', async () => {
    clearAuthEnvironment()
    const response = await runProxy(
      new NextRequest('http://localhost:3000/play?resume=game_42'),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/sign-in?return_url=%2Fplay%3Fresume%3Dgame_42',
    )
  })

  it('leaves public pages available when Clerk is not configured', async () => {
    clearAuthEnvironment()
    const response = await runProxy(
      new NextRequest('http://localhost:3000/white-paper'),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('emits Clerk strict CSP without unsafe-inline script execution', async () => {
    clearAuthEnvironment()
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY =
      'pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk'
    process.env.CLERK_SECRET_KEY = 'sk_test_example'
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'

    vi.resetModules()
    const { default: configuredProxy } = await import('./proxy')
    const response = await configuredProxy(
      new NextRequest('http://localhost:3000/white-paper'),
      event,
    )
    if (!response) {
      throw new Error('Expected configured Clerk proxy response.')
    }
    const policy = response.headers.get('content-security-policy')
    const forwardedPolicy = response.headers.get(
      'x-middleware-request-content-security-policy',
    )
    const scriptSource = policy
      ?.split(';')
      .find((directive) => directive.trim().startsWith('script-src '))

    expect(response.status).toBe(200)
    expect(policy).toContain("'strict-dynamic'")
    expect(policy).toMatch(/'nonce-[^']+'/)
    expect(scriptSource).not.toContain("'unsafe-inline'")
    expect(forwardedPolicy).toBe(policy)
  })

  it('allows the fixed local E2E principal through a protected page', async () => {
    clearAuthEnvironment()
    process.env.WEBCHESS_E2E_AUTH = 'playwright'
    process.env.WEBCHESS_E2E_USER_ID = 'e2e_proxy_user'
    const response = await runProxy(
      new NextRequest('http://localhost:3000/play', {
        headers: {
          [LOCAL_E2E_AUTH_HEADER]: 'playwright',
        },
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('disables the E2E bypass whenever a Vercel marker exists', async () => {
    clearAuthEnvironment()
    process.env.WEBCHESS_E2E_AUTH = 'playwright'
    process.env.WEBCHESS_E2E_USER_ID = 'e2e_proxy_user'
    process.env.VERCEL_ENV = 'preview'
    const response = await runProxy(
      new NextRequest('http://localhost:3000/play', {
        headers: {
          [LOCAL_E2E_AUTH_HEADER]: 'playwright',
        },
      }),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/sign-in?')
  })

  it('allows a signed loopback machine session through a protected page', async () => {
    clearAuthEnvironment()
    process.env[LOCAL_HOSTED_AUTH_FLAG] = 'true'
    process.env[LOCAL_SESSION_SECRET_NAME] =
      'local-session-secret-material-that-is-stable-32b'
    const unsigned = new NextRequest('http://127.0.0.1:3005/play', {
      headers: { host: '127.0.0.1:3005' },
    })
    const cookie = createLocalHostedSessionCookie(unsigned)
    const response = await runProxy(
      new NextRequest('http://127.0.0.1:3005/play', {
        headers: {
          host: '127.0.0.1:3005',
          cookie: `${cookie?.name}=${cookie?.value}`,
        },
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})
