import { describe, expect, it } from 'vitest'

import {
  LOCAL_OPENCLAW_AUTH_HEADER,
  LOCAL_OPENCLAW_AUTH_VALUE,
  resolveLocalOpenClawUser,
} from './openclaw'

const environment = {
  WEBCHESS_OPENCLAW_ENABLED: 'true',
  WEBCHESS_OPENCLAW_OWNER_ID: 'openclaw_worktree_2',
} as const

function request(
  pathname = '/api/games/current',
  origin = 'http://127.0.0.1:3210',
): Request {
  return new Request(`${origin}${pathname}`, {
    headers: {
      host: new URL(origin).host,
      [LOCAL_OPENCLAW_AUTH_HEADER]: LOCAL_OPENCLAW_AUTH_VALUE,
    },
  })
}

describe('resolveLocalOpenClawUser', () => {
  it.each([
    '/api/divide',
    '/api/division-intents/intent-1',
    '/api/games/current',
    '/api/games/game-1/lifecycle',
  ])('establishes the installation-owned identity for %s', (pathname) => {
    expect(resolveLocalOpenClawUser(request(pathname), environment)).toEqual({
      userId: 'openclaw_worktree_2',
      source: 'local-openclaw',
    })
  })

  it.each([
    '/api/account',
    '/api/account/usage',
    '/api/openclaw/status',
    '/api/webhooks/clerk',
  ])('does not grant the local principal access to %s', (pathname) => {
    expect(resolveLocalOpenClawUser(request(pathname), environment)).toBeNull()
  })

  it('rejects missing mode tags, invalid owners, and non-loopback hosts', () => {
    const missingTag = new Request(
      'http://127.0.0.1:3210/api/games/current',
      { headers: { host: '127.0.0.1:3210' } },
    )
    expect(resolveLocalOpenClawUser(missingTag, environment)).toBeNull()
    expect(resolveLocalOpenClawUser(request(), {
      ...environment,
      WEBCHESS_OPENCLAW_OWNER_ID: 'shared',
    })).toBeNull()
    expect(resolveLocalOpenClawUser(
      request('/api/games/current', 'https://webchess.example'),
      environment,
    )).toBeNull()
  })

  it.each([
    { VERCEL: '1' },
    { VERCEL: '' },
    { VERCEL_ENV: 'production' },
    { VERCEL_ENV: '' },
    { VERCEL_TARGET_ENV: 'preview' },
    { VERCEL_TARGET_ENV: '' },
    { VERCEL_URL: 'webchess-preview.vercel.app' },
    { VERCEL_URL: '' },
  ])('is impossible when a Vercel marker is present: %o', (marker) => {
    expect(resolveLocalOpenClawUser(request(), {
      ...environment,
      ...marker,
    })).toBeNull()
  })
})
