import { describe, expect, it } from 'vitest'

import {
  authenticationUnavailableJson,
  forbiddenOriginJson,
  unauthorizedJson,
} from './responses'

describe.each([
  [unauthorizedJson, 401, 'authentication_required'],
  [forbiddenOriginJson, 403, 'cross_origin_request'],
  [authenticationUnavailableJson, 503, 'authentication_unavailable'],
] as const)('%s', (factory, status, code) => {
  it('returns a non-cacheable JSON error', async () => {
    const response = factory()

    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toContain('application/json')
    await expect(response.json()).resolves.toMatchObject({
      error: { code },
    })
  })
})
