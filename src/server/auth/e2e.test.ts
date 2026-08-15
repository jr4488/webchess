import { describe, expect, it } from 'vitest'

import { LOCAL_E2E_AUTH_HEADER, resolveLocalE2EUser } from './e2e'

const environment = {
  WEBCHESS_E2E_AUTH: 'test-activation',
  WEBCHESS_E2E_USER_ID: 'e2e_playwright',
}

const request = (
  url = 'http://127.0.0.1:3000/play',
  activation = 'test-activation',
) =>
  new Request(url, {
    headers: {
      [LOCAL_E2E_AUTH_HEADER]: activation,
    },
  })

describe('resolveLocalE2EUser', () => {
  it('returns a fixed environment-owned identity on loopback', () => {
    expect(resolveLocalE2EUser(request(), environment)).toEqual({
      userId: 'e2e_playwright',
      source: 'local-e2e',
    })
  })

  it.each([
    'http://localhost:3000/play',
    'http://127.0.0.1:3000/play',
    'http://[::1]:3000/play',
  ])('accepts the exact loopback host %s', (url) => {
    expect(resolveLocalE2EUser(request(url), environment)?.userId).toBe(
      'e2e_playwright',
    )
  })

  it.each([
    'https://webchess.anansiportia.com/play',
    'http://localhost.example/play',
    'http://127.0.0.2/play',
  ])('refuses a non-loopback host %s', (url) => {
    expect(resolveLocalE2EUser(request(url), environment)).toBeNull()
  })

  it('never accepts a user ID from the request', () => {
    const forged = new Request('http://localhost:3000/play', {
      headers: {
        [LOCAL_E2E_AUTH_HEADER]: 'test-activation',
        'x-webchess-user-id': 'user_attacker_chose',
      },
    })

    expect(resolveLocalE2EUser(forged, environment)?.userId).toBe(
      'e2e_playwright',
    )
  })

  it('requires the activation header and a constrained test user ID', () => {
    expect(
      resolveLocalE2EUser(request(undefined, 'wrong'), environment),
    ).toBeNull()
    expect(
      resolveLocalE2EUser(request(), {
        ...environment,
        WEBCHESS_E2E_USER_ID: 'user_real',
      }),
    ).toBeNull()
  })

  it.each([
    { VERCEL: '1' },
    { VERCEL: '' },
    { VERCEL_ENV: 'preview' },
    { VERCEL_ENV: '' },
    { VERCEL_TARGET_ENV: 'preview' },
    { VERCEL_TARGET_ENV: '' },
    { VERCEL_URL: 'webchess-preview.vercel.app' },
    { VERCEL_URL: '' },
  ])('is impossible when a Vercel marker is present: %o', (marker) => {
    expect(
      resolveLocalE2EUser(request(), {
        ...environment,
        ...marker,
      }),
    ).toBeNull()
  })
})
