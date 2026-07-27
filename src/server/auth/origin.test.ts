import { describe, expect, it } from 'vitest'

import { verifySameOriginMutation } from './origin'

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
