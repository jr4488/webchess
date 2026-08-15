// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest'

import {
  LOCAL_HOSTED_AUTH_FLAG,
  LOCAL_SESSION_SECRET_NAME,
} from '@/server/auth/local-session'

import { GET, POST } from './route'

const environmentKeys = [
  'CLERK_SECRET_KEY',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'VERCEL',
  'VERCEL_ENV',
  'WEBCHESS_OPENCLAW_ENABLED',
  LOCAL_HOSTED_AUTH_FLAG,
  LOCAL_SESSION_SECRET_NAME,
] as const
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
)

afterEach(() => {
  for (const key of environmentKeys) {
    const value = originalEnvironment[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('local hosted sign-in route', () => {
  it('sets the signed host-only cookie and sanitizes the return path', async () => {
    delete process.env.CLERK_SECRET_KEY
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    delete process.env.WEBCHESS_OPENCLAW_ENABLED
    process.env[LOCAL_HOSTED_AUTH_FLAG] = 'true'
    process.env[LOCAL_SESSION_SECRET_NAME] =
      'local-session-secret-material-that-is-stable-32b'

    const response = await POST(
      new Request('http://localhost:3005/api/auth/local/sign-in', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3005',
          origin: 'http://127.0.0.1:3005',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'return_url=https%3A%2F%2Fattacker.example%2Fsteal',
      }),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'http://127.0.0.1:3005/play',
    )
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('webchess_local_session=v1.local_')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Max-Age=604800')
    expect(cookie).toContain('Path=/')
    expect(cookie.toLowerCase()).toContain('samesite=lax')
    expect(cookie).not.toContain('Secure')
  })

  it('sends GET visitors back to the sign-in page', async () => {
    const response = await GET(
      new Request('http://localhost:3005/api/auth/local/sign-in', {
        headers: { host: '127.0.0.1:3005' },
      }),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'http://127.0.0.1:3005/sign-in',
    )
  })

  it('sends rejected HTML form posts back to sign-in instead of JSON', async () => {
    const response = await POST(
      new Request('http://localhost:3005/api/auth/local/sign-in', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3005',
          origin: 'https://attacker.example',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'return_url=%2Fplay',
      }),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'http://127.0.0.1:3005/sign-in',
    )
  })

  it('keeps JSON 403 for non-form cross-origin mutations', async () => {
    const response = await POST(
      new Request('http://localhost:3005/api/auth/local/sign-in', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3005',
          origin: 'https://attacker.example',
          'content-type': 'application/json',
        },
        body: '{}',
      }),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'cross_origin_request' },
    })
  })
})
