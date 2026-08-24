// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LOCAL_OPENCLAW_AUTH_HEADER,
  LOCAL_OPENCLAW_AUTH_VALUE,
} from '@/server/auth/openclaw'
import { WEBCHESS_CASE_BUNDLE_MAX_BYTES } from '@/lib/case-bundle-contract'

import { POST } from './route'

const ORIGIN = 'http://127.0.0.1:3210'

function localRequest(
  body = '{}',
  options: {
    authenticated?: boolean
    contentLength?: number
  } = {},
): Request {
  return new Request(`${ORIGIN}/api/openclaw/case-verify`, {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3210',
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...(options.contentLength === undefined
        ? {}
        : { 'content-length': String(options.contentLength) }),
      ...(options.authenticated === false
        ? {}
        : { [LOCAL_OPENCLAW_AUTH_HEADER]: LOCAL_OPENCLAW_AUTH_VALUE }),
    },
    body,
  })
}

describe('POST /api/openclaw/case-verify', () => {
  beforeEach(() => {
    vi.stubEnv('WEBCHESS_OPENCLAW_ENABLED', 'true')
    vi.stubEnv('WEBCHESS_OPENCLAW_OWNER_ID', 'openclaw_case_verify_test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the structural and replay verifier result without source context', async () => {
    const response = await POST(localRequest())
    const payload = (await response.json()) as {
      verification: {
        ok: boolean
        errors: string[]
        warnings: string[]
        replay: { checked: boolean }
      }
    }

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(payload.verification.ok).toBe(false)
    expect(payload.verification.errors.length).toBeGreaterThan(0)
    expect(payload.verification.replay.checked).toBe(false)
  })

  it('fails closed without the local runtime identity or in a hosted process', async () => {
    const unauthenticated = await POST(
      localRequest('{}', {
        authenticated: false,
      }),
    )
    expect(unauthenticated.status).toBe(403)

    vi.stubEnv('VERCEL', '1')
    const hosted = await POST(localRequest())
    expect(hosted.status).toBe(404)
  })

  it('rejects a declared body beyond the local export bound before parsing it', async () => {
    const response = await POST(
      localRequest('{}', {
        contentLength: WEBCHESS_CASE_BUNDLE_MAX_BYTES + 1,
      }),
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    })
  })
})
