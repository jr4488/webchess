import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getApiServicesMock,
  requireApiUserMock,
  verifySameOriginMutationMock,
  verifyWebhookMock,
} = vi.hoisted(() => ({
  getApiServicesMock: vi.fn(),
  requireApiUserMock: vi.fn(),
  verifySameOriginMutationMock: vi.fn(),
  verifyWebhookMock: vi.fn(),
}))

vi.mock('@/server/auth', () => ({
  requireApiUser: requireApiUserMock,
  verifySameOriginMutation: verifySameOriginMutationMock,
}))

vi.mock('./services', () => ({
  getApiServices: getApiServicesMock,
}))

vi.mock('@clerk/nextjs/webhooks', () => ({
  verifyWebhook: verifyWebhookMock,
}))

import { MAX_JSON_BODY_BYTES } from './contracts'
import {
  ApiError,
  isApiError,
  SafePromptApiError,
  serviceUnavailable,
} from './errors'
import {
  createRequestId,
  getClientIpAddress,
  parseStrictJson,
  requireGameId,
  requireIdempotencyKey,
} from './guards'
import {
  handleAbandonRequest,
  handleAccountUsageRequest,
  handleClerkWebhookRequest,
  handleCurrentGameRequest,
} from './handlers'
import type { DurableGameDto, WebChessApiServices } from './ports'
import {
  emptyResponse,
  errorResponse,
  jsonResponse,
  noStoreHeaders,
  withNoStore,
} from './responses'

const GAME_ID = '243af8b3-32f4-471c-a1f8-93a9d3f1501d'
const IDEMPOTENCY_KEY = '0dcfe214-2779-4476-85e6-12c4fab504ea'
const originalWebhookSigningSecret =
  process.env.CLERK_WEBHOOK_SIGNING_SECRET
const GAME: DurableGameDto = {
  id: GAME_ID,
  sourceGameId: null,
  revision: 3,
  status: 'playing',
  problem: 'Which project should I choose?',
  researchConsent: {
    version: 'webchess-research-consent-v1',
    decision: 'allow_search_and_page_fetch',
    recordedAt: '2026-07-26T20:00:00.000Z',
  },
  division: null,
  state: null,
  answer: null,
}

function createServices(): WebChessApiServices {
  return {
    divide: vi.fn(async () => GAME),
    getCurrentGame: vi.fn(async () => GAME),
    getWebMemory: vi.fn(async () => ({ cases: [], carriedObservationIds: [] })),
    getGame: vi.fn(async () => GAME),
    getDivisionIntent: vi.fn(async () => GAME),
    startGame: vi.fn(async () => GAME),
    move: vi.fn(async () => GAME),
    answer: vi.fn(async () => {
      throw new Error('not used')
    }),
    getLifecycle: vi.fn(async () => { throw new Error('not used') }),
    runPortia: vi.fn(async () => { throw new Error('not used') }),
    retryLifecycle: vi.fn(async () => { throw new Error('not used') }),
    runCharlotte: vi.fn(async () => { throw new Error('not used') }),
    getProvenance: vi.fn(async () => { throw new Error('not used') }),
    createWilburAction: vi.fn(async () => { throw new Error('not used') }),
    updateWilburAction: vi.fn(async () => { throw new Error('not used') }),
    appendWilburObservation: vi.fn(async () => { throw new Error('not used') }),
    replay: vi.fn(async () => GAME),
    abandon: vi.fn(async () => ({ ...GAME, status: 'abandoned' as const })),
    getAccountUsage: vi.fn(async () => ({
      period: {
        startsAt: '2026-07-26T00:00:00.000Z',
        endsAt: '2026-07-27T00:00:00.000Z',
      },
      modelOperations: { used: 1, reserved: 0, limit: 100, remaining: 99 },
      gameStarts: { used: 1, reserved: 0, limit: 2, remaining: 1 },
      activeModelRequests: 0,
    })),
    exportAccount: vi.fn(async () => ({})),
    exportCase: vi.fn(async () => ({
      format: 'webchess-case-bundle/1',
      profile: 'research-redacted-v1',
    })),
    deleteAccountData: vi.fn(async () => undefined),
    handleClerkUserDeleted: vi.fn(async () => undefined),
  }
}

function mutationRequest(path: string): Request {
  return new Request(`https://webchess.example${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': IDEMPOTENCY_KEY,
      origin: 'https://webchess.example',
    },
    body: JSON.stringify({ expectedRevision: 3 }),
  })
}

function webhookRequest(svixId?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (svixId !== undefined) {
    headers.set('svix-id', svixId)
  }
  return new Request('https://webchess.example/api/webhooks/clerk', {
    method: 'POST',
    headers,
    body: '{}',
  })
}

async function expectApiError(
  promise: Promise<unknown>,
  code: string,
): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code })
    return error as ApiError
  }
  throw new Error(`Expected ${code}`)
}

beforeEach(() => {
  const services = createServices()
  requireApiUserMock.mockReset()
  requireApiUserMock.mockResolvedValue({
    userId: 'user_default',
    source: 'clerk',
  })
  verifySameOriginMutationMock.mockReset()
  verifySameOriginMutationMock.mockReturnValue(null)
  getApiServicesMock.mockReset()
  getApiServicesMock.mockResolvedValue(services)
  verifyWebhookMock.mockReset()
  delete process.env.CLERK_WEBHOOK_SIGNING_SECRET
})

afterEach(() => {
  if (originalWebhookSigningSecret === undefined) {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET
  } else {
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = originalWebhookSigningSecret
  }
})

describe('strict JSON and identifier guards', () => {
  const schema = z.object({ value: z.string().min(2) }).strict()

  it('accepts JSON without content-length and returns transformed schema data', async () => {
    const request = new Request('https://webchess.example/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: '{"value":"ok"}',
    })
    request.headers.delete('content-length')

    await expect(parseStrictJson(request, schema)).resolves.toEqual({ value: 'ok' })
  })

  it('treats an invalid or negative content-length as unknown', async () => {
    for (const contentLength of ['not-a-number', '-1']) {
      const request = new Request('https://webchess.example/api/test', {
        method: 'POST',
        headers: {
          'content-length': contentLength,
          'content-type': 'application/json',
        },
        body: '{"value":"ok"}',
      })

      await expect(parseStrictJson(request, schema)).resolves.toEqual({
        value: 'ok',
      })
    }
  })

  it('rejects missing media type and an oversized declared body', async () => {
    await expectApiError(
      parseStrictJson(
        new Request('https://webchess.example/api/test', {
          method: 'POST',
          body: '{}',
        }),
        schema,
      ),
      'UNSUPPORTED_MEDIA_TYPE',
    )

    await expectApiError(
      parseStrictJson(
        new Request('https://webchess.example/api/test', {
          method: 'POST',
          headers: {
            'content-length': String(MAX_JSON_BODY_BYTES + 1),
            'content-type': 'application/json',
          },
          body: '{}',
        }),
        schema,
      ),
      'PAYLOAD_TOO_LARGE',
    )
  })

  it('wraps body-read failures without leaking the cause', async () => {
    const request = {
      headers: new Headers({ 'content-type': 'application/json' }),
      text: vi.fn(async () => {
        throw new Error('sensitive transport detail')
      }),
    } as unknown as Request

    const error = await expectApiError(
      parseStrictJson(request, schema),
      'BAD_REQUEST',
    )
    expect(error.message).toBe('The request body could not be read.')
    expect(error.cause).toBeInstanceOf(Error)
  })

  it('rejects actual UTF-8 byte overflow, malformed JSON, and schema failures', async () => {
    const actualOverflow = new Request('https://webchess.example/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'é'.repeat(MAX_JSON_BODY_BYTES) }),
    })
    actualOverflow.headers.delete('content-length')
    await expectApiError(
      parseStrictJson(actualOverflow, schema),
      'PAYLOAD_TOO_LARGE',
    )

    const malformed = new Request('https://webchess.example/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })
    await expectApiError(parseStrictJson(malformed, schema), 'BAD_REQUEST')

    const invalid = new Request('https://webchess.example/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"value":"x","extra":true}',
    })
    const error = await expectApiError(parseStrictJson(invalid, schema), 'BAD_REQUEST')
    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.any(String) }),
      ]),
    )
  })

  it('normalizes valid UUID guards and rejects malformed identifiers', () => {
    const upperGameId = GAME_ID.toUpperCase()
    const request = new Request('https://webchess.example/api/test', {
      headers: { 'idempotency-key': IDEMPOTENCY_KEY.toUpperCase() },
    })

    expect(requireGameId(upperGameId)).toBe(GAME_ID)
    expect(requireIdempotencyKey(request)).toBe(IDEMPOTENCY_KEY)
    expect(() => requireGameId('not-a-game')).toThrowError(
      expect.objectContaining({ code: 'GAME_NOT_FOUND' }),
    )
    expect(() =>
      requireIdempotencyKey(
        new Request('https://webchess.example/api/test'),
      ),
    ).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }))
    expect(createRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    )
  })

  it.each([
    [undefined, 'unknown'],
    ['', 'unknown'],
    [`203.0.113.1\u007f`, 'unknown'],
    ['x'.repeat(129), 'unknown'],
    ['203.0.113.17, 10.0.0.1', '203.0.113.17, 10.0.0.1'],
  ])('normalizes forwarded address %j to %j', (value, expected) => {
    const request = new Request('https://webchess.example/api/test', {
      headers: value === undefined ? undefined : { 'x-forwarded-for': value },
    })
    expect(getClientIpAddress(request)).toBe(expected)
  })
})

describe('private response helpers and errors', () => {
  it('merges no-store headers and preserves explicit status defaults', async () => {
    const headers = noStoreHeaders({ 'x-custom': 'yes' })
    expect(headers.get('cache-control')).toContain('no-store')
    expect(headers.get('x-custom')).toBe('yes')
    expect(noStoreHeaders().get('pragma')).toBe('no-cache')

    const json = jsonResponse({ ok: true })
    expect(json.status).toBe(200)
    await expect(json.json()).resolves.toEqual({ ok: true })
    expect(emptyResponse().status).toBe(204)
    expect(emptyResponse(202, { 'x-custom': 'accepted' }).status).toBe(202)
  })

  it('adds a request ID only when supplied', () => {
    const original = new Response('ok', {
      status: 202,
      statusText: 'Accepted',
      headers: { 'x-original': 'yes' },
    })

    const withoutId = withNoStore(original.clone())
    const withId = withNoStore(original, 'request_branch')
    expect(withoutId.headers.get('x-request-id')).toBeNull()
    expect(withId.headers.get('x-request-id')).toBe('request_branch')
    expect(withId.statusText).toBe('Accepted')
  })

  it('renders public API errors, retry timing, issues, and safe unknown failures', async () => {
    const publicResponse = errorResponse(
      new ApiError('RATE_LIMITED', 429, 'Slow down.', {
        issues: [{ path: 'value', message: 'Invalid value.' }],
        retryAfterSeconds: 0.1,
      }),
      'request_rate',
    )
    expect(publicResponse.status).toBe(429)
    expect(publicResponse.headers.get('retry-after')).toBe('1')
    await expect(publicResponse.json()).resolves.toMatchObject({
      error: {
        code: 'RATE_LIMITED',
        issues: [{ path: 'value', message: 'Invalid value.' }],
      },
    })

    const promptResponse = errorResponse(
      new SafePromptApiError(
        'The corrective Answer contract failed.',
        'Safe application-authored prompt.',
      ),
      'request_prompt',
    )
    await expect(promptResponse.json()).resolves.toEqual({
      error: {
        code: 'UPSTREAM_FAILURE',
        message: 'The corrective Answer contract failed.',
        prompt: 'Safe application-authored prompt.',
        requestId: 'request_prompt',
      },
    })

    const internalResponse = errorResponse(
      new Error('secret database detail'),
      'request_internal',
    )
    expect(internalResponse.status).toBe(500)
    await expect(internalResponse.json()).resolves.toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'WebChess could not complete this request.',
        requestId: 'request_internal',
      },
    })
  })

  it('uses the default service-unavailable message and recognizes API errors', () => {
    const error = serviceUnavailable()
    expect(error.message).toBe('The WebChess service is not configured.')
    expect(isApiError(error)).toBe(true)
    expect(isApiError(new Error('ordinary'))).toBe(false)
  })
})

describe('handler default dependency and webhook branches', () => {
  it('uses default authentication and service resolution for a read', async () => {
    const response = await handleCurrentGameRequest(
      new Request('https://webchess.example/api/games/current'),
    )

    expect(response.status).toBe(200)
    expect(requireApiUserMock).toHaveBeenCalledOnce()
    expect(getApiServicesMock).toHaveBeenCalledOnce()
  })

  it('uses default origin verification and the previously resolved service', async () => {
    const services = createServices()
    getApiServicesMock.mockResolvedValue(services)

    const response = await handleAbandonRequest(
      mutationRequest(`/api/games/${GAME_ID}/abandon`),
      GAME_ID,
    )

    expect(response.status).toBe(200)
    expect(verifySameOriginMutationMock).toHaveBeenCalledOnce()
    expect(services.abandon).toHaveBeenCalledOnce()
  })

  it('covers the account usage handler and sanitizes unexpected service errors', async () => {
    const services = createServices()
    const ok = await handleAccountUsageRequest(
      new Request('https://webchess.example/api/account/usage'),
      {
        authenticate: requireApiUserMock,
        verifySameOrigin: verifySameOriginMutationMock,
        services,
      },
    )
    expect(ok.status).toBe(200)

    services.getAccountUsage = vi.fn(async () => {
      throw new Error('private database failure')
    })
    const failed = await handleAccountUsageRequest(
      new Request('https://webchess.example/api/account/usage'),
      {
        authenticate: requireApiUserMock,
        verifySameOrigin: verifySameOriginMutationMock,
        services,
      },
    )
    expect(failed.status).toBe(500)
    await expect(failed.text()).resolves.not.toContain('private database failure')
  })

  it('rejects the default verifier when the webhook secret is absent', async () => {
    const response = await handleClerkWebhookRequest(webhookRequest())
    expect(response.status).toBe(503)
    expect(verifyWebhookMock).not.toHaveBeenCalled()
  })

  it('uses the default verifier and acknowledges non-deletion events', async () => {
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = 'whsec_test_only'
    verifyWebhookMock.mockResolvedValue({
      type: 'session.created',
      data: {},
    })

    const response = await handleClerkWebhookRequest(webhookRequest())
    expect(response.status).toBe(200)
    expect(verifyWebhookMock).toHaveBeenCalledOnce()
    expect(getApiServicesMock).not.toHaveBeenCalled()
  })

  it.each([
    ['missing data', undefined],
    ['null data', null],
    ['array data', []],
    ['missing user ID', {}],
    ['short user ID', { id: 'u' }],
    ['non-string user ID', { id: 42 }],
    ['long user ID', { id: 'u'.repeat(256) }],
  ])('rejects deletion event with %s', async (_label, data) => {
    const response = await handleClerkWebhookRequest(webhookRequest('msg_invalid'), {
      verify: vi.fn(async () => ({
        type: 'user.deleted',
        data,
      })),
      services: createServices(),
    })
    expect(response.status).toBe(400)
  })

  it.each([undefined, '', 'x'.repeat(257)])(
    'rejects deletion event identifier %j',
    async (svixId) => {
      const response = await handleClerkWebhookRequest(webhookRequest(svixId), {
        verify: vi.fn(async () => ({
          type: 'user.deleted',
          data: { id: 'user_deleted' },
        })),
        services: createServices(),
      })
      expect(response.status).toBe(400)
    },
  )

  it('resolves default services for a valid deletion event', async () => {
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = 'whsec_test_only'
    verifyWebhookMock.mockResolvedValue({
      type: 'user.deleted',
      data: { id: 'user_deleted' },
    })
    const services = createServices()
    getApiServicesMock.mockResolvedValue(services)

    const response = await handleClerkWebhookRequest(
      webhookRequest('msg_default_service'),
    )
    expect(response.status).toBe(200)
    expect(services.handleClerkUserDeleted).toHaveBeenCalledOnce()
  })
})
