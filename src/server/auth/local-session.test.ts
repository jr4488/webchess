// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest'

import {
  LOCAL_HOSTED_AUTH_FLAG,
  LOCAL_HOSTED_SESSION_COOKIE,
  LOCAL_SESSION_SECRET_NAME,
  createLocalHostedSessionCookie,
  isLocalHostedSignInAvailable,
  localHostedRedirectUrl,
  localHostedUserId,
  resolveLocalHostedUser,
} from './local-session'

const SESSION_SECRET = 'local-session-secret-material-that-is-stable-32b'
const originalEnv = {
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  VERCEL: process.env.VERCEL,
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_TARGET_ENV: process.env.VERCEL_TARGET_ENV,
  VERCEL_URL: process.env.VERCEL_URL,
  [LOCAL_HOSTED_AUTH_FLAG]: process.env[LOCAL_HOSTED_AUTH_FLAG],
  [LOCAL_SESSION_SECRET_NAME]: process.env[LOCAL_SESSION_SECRET_NAME],
  WEBCHESS_HMAC_SECRET: process.env.WEBCHESS_HMAC_SECRET,
  WEBCHESS_OPENCLAW_ENABLED: process.env.WEBCHESS_OPENCLAW_ENABLED,
}

function loopbackRequest(cookie?: string) {
  const headers = new Headers({
    host: '127.0.0.1:3005',
  })
  if (cookie) {
    headers.set('cookie', cookie)
  }
  return new Request('http://127.0.0.1:3005/play', { headers })
}

describe('loopback local hosted session', () => {
  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  function enableLocalHosted() {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    delete process.env.CLERK_SECRET_KEY
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    delete process.env.VERCEL_TARGET_ENV
    delete process.env.VERCEL_URL
    delete process.env.WEBCHESS_OPENCLAW_ENABLED
    process.env[LOCAL_HOSTED_AUTH_FLAG] = 'true'
    process.env[LOCAL_SESSION_SECRET_NAME] = SESSION_SECRET
  }

  it('is available only on loopback when Clerk and OpenClaw are off', () => {
    enableLocalHosted()
    expect(isLocalHostedSignInAvailable(loopbackRequest())).toBe(true)
    expect(localHostedUserId()?.startsWith('local_')).toBe(true)

    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_example'
    process.env.CLERK_SECRET_KEY = 'sk_test_example'
    expect(isLocalHostedSignInAvailable(loopbackRequest())).toBe(false)
  })

  it('requires explicit activation, a strong dedicated secret, and both Clerk keys absent', () => {
    enableLocalHosted()
    delete process.env[LOCAL_HOSTED_AUTH_FLAG]
    expect(isLocalHostedSignInAvailable(loopbackRequest())).toBe(false)

    process.env[LOCAL_HOSTED_AUTH_FLAG] = 'true'
    process.env[LOCAL_SESSION_SECRET_NAME] = 'too-short'
    expect(isLocalHostedSignInAvailable(loopbackRequest())).toBe(false)

    process.env[LOCAL_SESSION_SECRET_NAME] = SESSION_SECRET
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_partial'
    expect(isLocalHostedSignInAvailable(loopbackRequest())).toBe(false)
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    process.env.CLERK_SECRET_KEY = 'sk_test_partial'
    expect(isLocalHostedSignInAvailable(loopbackRequest())).toBe(false)
  })

  it('keeps the durable owner independent from the rotatable general HMAC secret', () => {
    enableLocalHosted()
    process.env.WEBCHESS_HMAC_SECRET = 'a'.repeat(64)
    const before = localHostedUserId()
    process.env.WEBCHESS_HMAC_SECRET = 'b'.repeat(64)
    expect(localHostedUserId()).toBe(before)
  })

  it('never activates on Vercel or with OpenClaw enabled', () => {
    enableLocalHosted()
    for (const [name, value] of [
      ['VERCEL', '1'],
      ['VERCEL_ENV', 'preview'],
      ['VERCEL_TARGET_ENV', 'staging'],
      ['VERCEL_URL', 'webchess-preview.vercel.app'],
    ]) {
      process.env[name] = value
      expect(isLocalHostedSignInAvailable(loopbackRequest())).toBe(false)
      delete process.env[name]
    }
    process.env.WEBCHESS_OPENCLAW_ENABLED = 'true'
    expect(resolveLocalHostedUser(loopbackRequest())).toBeNull()
  })

  it('redirects to the Host hostname instead of a localhost request URL', () => {
    const request = new Request('http://localhost:3005/api/auth/local/sign-in', {
      headers: { host: '127.0.0.1:3005' },
    })
    expect(localHostedRedirectUrl(request, '/play').href).toBe(
      'http://127.0.0.1:3005/play',
    )
  })

  it('does not honor a loopback Host with a different port', () => {
    const request = new Request('http://localhost:3005/api/auth/local/sign-in', {
      headers: { host: '127.0.0.1:4000' },
    })
    expect(localHostedRedirectUrl(request, '/play').href).toBe(
      'http://localhost:3005/play',
    )
  })

  it('rejects a non-loopback host even with a well-formed cookie', () => {
    enableLocalHosted()
    const cookie = createLocalHostedSessionCookie(loopbackRequest())
    expect(cookie).not.toBeNull()
    const remote = new Request('https://webchess.anansiportia.com/play', {
      headers: {
        host: 'webchess.anansiportia.com',
        cookie: `${cookie?.name}=${cookie?.value}`,
      },
    })
    expect(resolveLocalHostedUser(remote)).toBeNull()
  })

  it('round-trips a signed cookie and rejects expiry or MAC tampering', () => {
    enableLocalHosted()
    const cookie = createLocalHostedSessionCookie(loopbackRequest())
    expect(cookie).toMatchObject({
      httpOnly: true,
      name: LOCAL_HOSTED_SESSION_COOKIE,
      path: '/',
      sameSite: 'lax',
    })
    const header = `${cookie?.name}=${cookie?.value}`
    const user = resolveLocalHostedUser(loopbackRequest(header))
    expect(user?.source).toBe('local-hosted')
    expect(user?.userId).toBe(localHostedUserId())

    const tampered = header.replace(/[a-f0-9]{8}$/u, 'deadbeef')
    expect(resolveLocalHostedUser(loopbackRequest(tampered))).toBeNull()

    const expired = createLocalHostedSessionCookie(
      loopbackRequest(),
      process.env,
      Date.now() - (8 * 24 * 60 * 60 * 1000),
    )
    expect(
      resolveLocalHostedUser(
        loopbackRequest(`${expired?.name}=${expired?.value}`),
      ),
    ).toBeNull()
  })
})
