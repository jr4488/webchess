import { afterEach, describe, expect, it } from 'vitest'

import {
  LOCAL_OPENCLAW_AUTH_HEADER,
  LOCAL_OPENCLAW_AUTH_VALUE,
} from './openclaw'
import { verifySameOriginMutation } from './origin'

const openClawEnvironmentKeys = [
  'VERCEL',
  'VERCEL_ENV',
  'WEBCHESS_OPENCLAW_ENABLED',
  'WEBCHESS_OPENCLAW_OWNER_ID',
] as const
const originalOpenClawEnvironment = Object.fromEntries(
  openClawEnvironmentKeys.map((key) => [key, process.env[key]]),
)

afterEach(() => {
  for (const key of openClawEnvironmentKeys) {
    const value = originalOpenClawEnvironment[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const mutation = (
  origin: string | null,
  {
    url = 'https://webchess.anansiportia.com/api/games',
    fetchSite = 'same-origin',
    method = 'POST',
  }: {
    url?: string
    fetchSite?: string | null
    method?: string
  } = {},
) => {
  const headers = new Headers()
  if (origin !== null) headers.set('origin', origin)
  if (fetchSite !== null) headers.set('sec-fetch-site', fetchSite)
  return new Request(url, { method, headers })
}

describe('verifySameOriginMutation', () => {
  it('allows an exact same-origin browser mutation', () => {
    expect(
      verifySameOriginMutation(
        mutation('https://webchess.anansiportia.com'),
      ),
    ).toBeNull()
  })

  it('allows same-origin mutations when an older client omits fetch metadata', () => {
    expect(
      verifySameOriginMutation(
        mutation('https://webchess.anansiportia.com', { fetchSite: null }),
      ),
    ).toBeNull()
  })

  it('allows an Origin-less mutation only for the established local OpenClaw principal', () => {
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    process.env.WEBCHESS_OPENCLAW_ENABLED = 'true'
    process.env.WEBCHESS_OPENCLAW_OWNER_ID = 'openclaw_origin_test'
    const request = new Request('http://127.0.0.1:3210/api/divide', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3210',
        [LOCAL_OPENCLAW_AUTH_HEADER]: LOCAL_OPENCLAW_AUTH_VALUE,
      },
    })

    expect(verifySameOriginMutation(request)).toBeNull()
  })

  it('accepts loopback hostname normalization for the local OpenClaw principal', () => {
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    process.env.WEBCHESS_OPENCLAW_ENABLED = 'true'
    process.env.WEBCHESS_OPENCLAW_OWNER_ID = 'openclaw_origin_test'
    const request = new Request('http://localhost:3210/api/divide', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3210',
        origin: 'http://127.0.0.1:3210',
        'sec-fetch-site': 'same-origin',
        [LOCAL_OPENCLAW_AUTH_HEADER]: LOCAL_OPENCLAW_AUTH_VALUE,
      },
    })

    expect(verifySameOriginMutation(request)).toBeNull()
  })

  it.each([
    null,
    'null',
    'https://attacker.example',
    'https://webchess.anansiportia.com.evil.example',
    'https://webchess.anansiportia.com:444',
  ])('rejects the origin %j', async (origin) => {
    const response = verifySameOriginMutation(mutation(origin))
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: 'cross_origin_request' },
    })
  })

  it.each(['cross-site', 'same-site', 'none'])(
    'rejects fetch metadata that is not same-origin: %s',
    (fetchSite) => {
      expect(
        verifySameOriginMutation(
          mutation('https://webchess.anansiportia.com', { fetchSite }),
        )?.status,
      ).toBe(403)
    },
  )

  it('does not impose an Origin header on safe requests', () => {
    expect(
      verifySameOriginMutation(mutation(null, { method: 'GET' })),
    ).toBeNull()
  })
})
