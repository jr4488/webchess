// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('local hosted sign-out route', () => {
  it('always expires the local cookie on a validated loopback request', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_example')
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_example')
    const response = await POST(
      new Request('http://localhost:3005/api/auth/local/sign-out', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3005',
          origin: 'http://127.0.0.1:3005',
          'sec-fetch-site': 'same-origin',
        },
      }),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3005/')
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('webchess_local_session=')
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).toContain('HttpOnly')
    expect(cookie.toLowerCase()).toContain('samesite=lax')
  })

  it('does not clear a cookie for a cross-origin request', async () => {
    const response = await POST(
      new Request('http://127.0.0.1:3005/api/auth/local/sign-out', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3005',
          origin: 'https://attacker.example',
          'sec-fetch-site': 'cross-site',
        },
      }),
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
