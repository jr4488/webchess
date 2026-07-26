// @vitest-environment node

import http from 'node:http'
import { once } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DIVISION_QUALITY_FIXTURES } from '../evals/division-quality-fixtures.mjs'
import {
  createWebChessApp,
  resolveUpstreamTimeoutMs,
} from './app.mjs'

const ACCESS_CODE = 'correct horse battery staple'
const SESSION_SECRET = 'a-test-only-session-secret-with-at-least-32-bytes'
const HEALTHY_DIVISION = DIVISION_QUALITY_FIXTURES.find(
  ({ name }) => name === 'specific workshop map',
)
const PROBLEM = HEALTHY_DIVISION.problem

function facets() {
  return HEALTHY_DIVISION.facets.map((facet) => ({ ...facet }))
}

function divisionResult() {
  return {
    status: 'completed',
    incomplete_details: null,
    output_parsed: { facets: facets() },
    model: 'gpt-5.6-sol',
  }
}

const repeatedWords = (word, count = 70) =>
  Array.from({ length: count }, () => word).join(' ')

function answerResult() {
  const outputParsed = {
    answer: `Choose one reversible step now. Test the result before expanding further.\n\n${repeatedWords('context')}`,
    what_the_conflicts_emphasized: repeatedWords('evidence'),
    the_tension_to_hold: repeatedWords('balance'),
    three_next_moves: [
      repeatedWords('observe'),
      repeatedWords('compare'),
      repeatedWords('adjust'),
    ],
    what_could_change_the_answer: repeatedWords('condition'),
  }
  return {
    status: 'completed',
    incomplete_details: null,
    output: [{
      type: 'message',
      content: [{ type: 'output_text', parsed: outputParsed }],
    }],
    output_parsed: outputParsed,
    model: 'gpt-5.6-sol',
  }
}

function maximumMultibyteGamePayload() {
  const text = (length) => '界'.repeat(length)
  return {
    problem: text(240),
    turnCount: 32,
    outcome: {
      winner: null,
      reason: 'no-moves',
      completedTurn: 32,
    },
    captures: Array.from({ length: 32 }, (_, index) => {
      const turn = index + 1
      const attackerSide = turn % 2 === 1 ? 'white' : 'black'
      const capturedSide = attackerSide === 'white' ? 'black' : 'white'
      return {
        turn,
        resonance: 100,
        cell: { ring: index % 8, sector: Math.floor(index / 8) },
        attacker: { side: attackerSide, kind: 'queen' },
        captured: { side: capturedSide, kind: 'pawn' },
        part: {
          id: index + 1,
          title: text(120),
          focus: text(360),
          hexagram: index + 1,
          hexagramName: text(90),
          theme: text(220),
          dimension: text(60),
          movement: text(60),
          prompt: text(420),
          keyword: text(80),
        },
      }
    }),
  }
}

function clientWithParse(parse = vi.fn().mockResolvedValue(divisionResult())) {
  return {
    client: {
      responses: {
        create: vi.fn(),
        parse,
      },
    },
    parse,
  }
}

const runningServers = new Set()

async function serve(options = {}) {
  const app = createWebChessApp(options)
  const server = app.listen(0, '127.0.0.1')
  runningServers.add(server)
  await once(server, 'listening')
  const { port } = server.address()
  const origin = `http://127.0.0.1:${port}`
  return {
    app,
    origin,
    server,
    async request(path, init = {}) {
      return fetch(`${origin}${path}`, init)
    },
  }
}

function rawJsonRequest(service, path, headers, value) {
  const body = JSON.stringify(value)
  return new Promise((resolve, reject) => {
    const request = http.request(new URL(path, service.origin), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.once('end', () => resolve({
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        status: response.statusCode,
      }))
    })
    request.once('error', reject)
    request.end(body)
  })
}

async function stop(server) {
  runningServers.delete(server)
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

afterEach(async () => {
  await Promise.all([...runningServers].map(stop))
})

async function login(service, accessCode = ACCESS_CODE) {
  const response = await service.request('/api/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: service.origin,
    },
    body: JSON.stringify({ accessCode }),
  })
  const body = await response.json()
  const setCookie = response.headers.get('set-cookie')
  return {
    response,
    body,
    cookie: setCookie?.split(';', 1)[0],
    setCookie,
  }
}

function paidHeaders(service, session) {
  return {
    'Content-Type': 'application/json',
    Cookie: session.cookie,
    Origin: service.origin,
    'X-WebChess-CSRF': session.body.csrfToken,
  }
}

async function divide(service, session) {
  return service.request('/api/divide', {
    method: 'POST',
    headers: paidHeaders(service, session),
    body: JSON.stringify({ problem: PROBLEM }),
  })
}

function configuredOptions(overrides = {}) {
  const { client } = clientWithParse()
  return {
    accessCode: ACCESS_CODE,
    sessionSecret: SESSION_SECRET,
    secureCookies: false,
    environment: {},
    client,
    ...overrides,
  }
}

describe('WebChess API security boundary', () => {
  it('keeps liveness separate and fails readiness and paid access closed', async () => {
    const { client } = clientWithParse()
    const service = await serve({ client, accessCode: '', sessionSecret: '' })

    const health = await service.request('/api/health')
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true })
    expect(health.headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
    expect(health.headers.get('x-frame-options')).toBe('DENY')
    expect(health.headers.get('x-content-type-options')).toBe('nosniff')

    const ready = await service.request('/api/ready')
    expect(ready.status).toBe(503)
    expect(await ready.json()).toMatchObject({
      ok: false,
      configured: false,
      security: 'not-configured',
    })

    const signIn = await login(service)
    expect(signIn.response.status).toBe(503)
    expect(signIn.body.error).toMatch(/not configured/i)

    const paid = await service.request('/api/divide', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: service.origin,
      },
      body: JSON.stringify({ problem: PROBLEM }),
    })
    expect(paid.status).toBe(503)
    expect(paid.headers.get('content-type')).toMatch(/application\/json/)

    await stop(service.server)
    const configured = await serve(configuredOptions())
    const configuredReady = await configured.request('/api/ready')
    expect(configuredReady.status).toBe(200)
    expect(await configuredReady.json()).toMatchObject({
      ok: true,
      configured: true,
    })
  })

  it('issues signed HttpOnly sessions and enforces origin, authentication, and CSRF', async () => {
    const { client, parse } = clientWithParse()
    const service = await serve(configuredOptions({ client }))

    const crossOrigin = await service.request('/api/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example',
      },
      body: JSON.stringify({ accessCode: ACCESS_CODE }),
    })
    expect(crossOrigin.status).toBe(403)

    const wrongCode = await login(service, 'this code is definitely wrong')
    expect(wrongCode.response.status).toBe(401)
    expect(wrongCode.body).toEqual({ error: 'The access code is invalid.' })

    const session = await login(service)
    expect(session.response.status).toBe(200)
    expect(session.body).toMatchObject({
      authenticated: true,
      csrfToken: expect.any(String),
      expiresAt: expect.any(String),
    })
    expect(session.setCookie).toContain('HttpOnly')
    expect(session.setCookie).toContain('SameSite=Strict')
    expect(session.setCookie).toContain('Path=/api')
    expect(session.setCookie).not.toContain('Secure')

    const current = await service.request('/api/session', {
      headers: { Cookie: session.cookie },
    })
    expect(current.status).toBe(200)
    expect(await current.json()).toEqual(session.body)

    const tamperedCookie = `${session.cookie.slice(0, -1)}${
      session.cookie.endsWith('A') ? 'B' : 'A'
    }`
    const tampered = await service.request('/api/session', {
      headers: { Cookie: tamperedCookie },
    })
    expect(await tampered.json()).toEqual({ authenticated: false })

    const noOrigin = await service.request('/api/divide', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: session.cookie,
        'X-WebChess-CSRF': session.body.csrfToken,
      },
      body: JSON.stringify({ problem: PROBLEM }),
    })
    expect(noOrigin.status).toBe(403)

    const noSession = await service.request('/api/divide', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: service.origin,
      },
      body: JSON.stringify({ problem: PROBLEM }),
    })
    expect(noSession.status).toBe(401)

    const wrongCsrf = await service.request('/api/divide', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: session.cookie,
        Origin: service.origin,
        'X-WebChess-CSRF': 'wrong-token',
      },
      body: JSON.stringify({ problem: PROBLEM }),
    })
    expect(wrongCsrf.status).toBe(403)
    expect(await wrongCsrf.json()).toEqual({
      error: 'The request security token is invalid.',
      code: 'csrf',
    })

    const freshSession = await login(service)
    const crossedCsrf = await service.request('/api/divide', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: freshSession.cookie,
        Origin: service.origin,
        'X-WebChess-CSRF': session.body.csrfToken,
      },
      body: JSON.stringify({ problem: PROBLEM }),
    })
    expect(crossedCsrf.status).toBe(403)
    expect(await crossedCsrf.json()).toEqual({
      error: 'The request security token is invalid.',
      code: 'csrf',
    })

    const accepted = await divide(service, session)
    expect(accepted.status).toBe(200)
    expect(parse).toHaveBeenCalledOnce()
    expect(parse.mock.calls[0][1]).toMatchObject({
      signal: expect.any(AbortSignal),
      timeout: 120_000,
      maxRetries: 0,
    })

    const rejectedLogout = await service.request('/api/session', {
      method: 'DELETE',
      headers: {
        Cookie: session.cookie,
        Origin: service.origin,
        'X-WebChess-CSRF': 'wrong-token',
      },
    })
    expect(rejectedLogout.status).toBe(403)

    const logout = await service.request('/api/session', {
      method: 'DELETE',
      headers: {
        Cookie: session.cookie,
        Origin: service.origin,
        'X-WebChess-CSRF': session.body.csrfToken,
      },
    })
    expect(logout.status).toBe(200)
    expect(await logout.json()).toEqual({ authenticated: false })
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')

    const revoked = await service.request('/api/session', {
      headers: { Cookie: session.cookie },
    })
    expect(await revoked.json()).toEqual({ authenticated: false })
  })

  it('marks session cookies Secure when production cookie policy is enabled', async () => {
    const service = await serve(configuredOptions({ secureCookies: true }))
    const session = await login(service)

    expect(session.response.status).toBe(200)
    expect(session.setCookie).toContain('HttpOnly')
    expect(session.setCookie).toContain('SameSite=Strict')
    expect(session.setCookie).toContain('Secure')
  })

  it('keeps direct loopback Codex cookies usable in browsers during local production mode', async () => {
    const { client } = clientWithParse()
    const service = await serve({
      accessCode: ACCESS_CODE,
      sessionSecret: SESSION_SECRET,
      environment: {
        NODE_ENV: 'production',
        WEBCHESS_MODEL_PROVIDER: 'codex-chatgpt',
      },
      host: '127.0.0.1',
      client,
    })

    const session = await login(service)
    expect(session.response.status).toBe(200)
    expect(session.setCookie).toContain('HttpOnly')
    expect(session.setCookie).toContain('SameSite=Strict')
    expect(session.setCookie).not.toContain('Secure')
  })

  it('rate-limits access attempts and model calls with JSON retry metadata', async () => {
    const { client } = clientWithParse()
    const service = await serve(configuredOptions({
      client,
      loginRateLimit: { limit: 2, windowMs: 60_000 },
      apiRateLimit: { limit: 1, windowMs: 60_000 },
    }))

    expect((await login(service, 'wrong-access-code-1')).response.status).toBe(401)
    expect((await login(service, 'wrong-access-code-2')).response.status).toBe(401)
    const limitedLogin = await login(service, 'wrong-access-code-3')
    expect(limitedLogin.response.status).toBe(429)
    expect(limitedLogin.response.headers.get('retry-after')).toBe('60')
    expect(limitedLogin.body).toMatchObject({
      error: expect.any(String),
      retryAfter: 60,
    })

    await stop(service.server)
    const paidService = await serve(configuredOptions({
      apiRateLimit: { limit: 1, windowMs: 60_000 },
    }))
    const session = await login(paidService)
    expect((await divide(paidService, session)).status).toBe(200)
    const limited = await divide(paidService, session)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    expect(await limited.json()).toMatchObject({ retryAfter: 60 })
  })

  it('does not reserve model capacity for an unknown API subpath', async () => {
    const { client, parse } = clientWithParse()
    const service = await serve(configuredOptions({
      client,
      apiRateLimit: { limit: 1, windowMs: 60_000 },
      globalQuota: { limit: 1, windowMs: 60_000 },
      maxConcurrentRequests: 1,
    }))
    const session = await login(service)

    const unknown = await service.request('/api/divide/extra', {
      method: 'POST',
      headers: paidHeaders(service, session),
      body: JSON.stringify({ problem: PROBLEM }),
    })
    expect(unknown.status).toBe(404)
    expect(parse).not.toHaveBeenCalled()

    expect((await divide(service, session)).status).toBe(200)
    expect(parse).toHaveBeenCalledOnce()
  })

  it('applies division limits to the accepted trailing-slash route', async () => {
    const { client, parse } = clientWithParse()
    const service = await serve(configuredOptions({
      client,
      apiRateLimit: { limit: 1, windowMs: 60_000 },
    }))
    const session = await login(service)

    const first = await service.request('/api/divide/', {
      method: 'POST',
      headers: paidHeaders(service, session),
      body: JSON.stringify({ problem: PROBLEM }),
    })
    expect(first.status).toBe(200)

    expect((await divide(service, session)).status).toBe(429)
    expect(parse).toHaveBeenCalledOnce()
  })

  it('ignores forwarded client addresses unless a proxy source is trusted', async () => {
    const service = await serve(configuredOptions({
      loginRateLimit: { limit: 1, windowMs: 60_000 },
    }))

    const first = await rawJsonRequest(service, '/api/session', {
      Origin: service.origin,
      'X-Forwarded-For': '198.51.100.10',
    }, { accessCode: 'wrong-access-code-one' })
    const second = await rawJsonRequest(service, '/api/session', {
      Origin: service.origin,
      'X-Forwarded-For': '198.51.100.11',
    }, { accessCode: 'wrong-access-code-two' })

    expect(first.status).toBe(401)
    expect(second.status).toBe(429)
  })

  it('rate-limits by the first untrusted hop behind an allowlisted proxy', async () => {
    const service = await serve(configuredOptions({
      environment: {
        WEBCHESS_TRUST_PROXY: '127.0.0.1/32',
      },
      loginRateLimit: { limit: 1, windowMs: 60_000 },
    }))

    const first = await rawJsonRequest(service, '/api/session', {
      Origin: service.origin,
      'X-Forwarded-For': '198.51.100.10, 203.0.113.20',
    }, { accessCode: 'wrong-access-code-one' })
    const spoofedLeftmost = await rawJsonRequest(service, '/api/session', {
      Origin: service.origin,
      'X-Forwarded-For': '198.51.100.11, 203.0.113.20',
    }, { accessCode: 'wrong-access-code-two' })
    const differentClientHop = await rawJsonRequest(service, '/api/session', {
      Origin: service.origin,
      'X-Forwarded-For': '198.51.100.12, 203.0.113.21',
    }, { accessCode: 'wrong-access-code-three' })

    expect(first.status).toBe(401)
    expect(spoofedLeftmost.status).toBe(429)
    expect(differentClientHop.status).toBe(401)
  })

  it('does not let a fresh session reset the process-global inference quota', async () => {
    const { client, parse } = clientWithParse()
    const service = await serve(configuredOptions({
      client,
      globalQuota: { limit: 1, windowMs: 60_000 },
    }))

    const firstSession = await login(service)
    expect((await divide(service, firstSession)).status).toBe(200)

    const freshSession = await login(service)
    const exhausted = await divide(service, freshSession)
    expect(exhausted.status).toBe(429)
    expect(await exhausted.json()).toMatchObject({
      error: expect.stringMatching(/budget/i),
      retryAfter: 60,
    })
    expect(parse).toHaveBeenCalledOnce()
  })

  it('enforces one global concurrency cap and releases the slot exactly once', async () => {
    let finishFirst
    const parse = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishFirst = resolve
      }))
      .mockResolvedValue(divisionResult())
    const { client } = clientWithParse(parse)
    const service = await serve(configuredOptions({
      client,
      environment: { WEBCHESS_MODEL_PROVIDER: 'codex-chatgpt' },
      host: '127.0.0.1',
      maxConcurrentRequests: 9,
    }))
    const session = await login(service)

    const first = divide(service, session)
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1))

    const concurrent = await divide(service, session)
    expect(concurrent.status).toBe(503)
    expect(await concurrent.json()).toMatchObject({
      error: expect.stringMatching(/busy/i),
    })

    finishFirst(divisionResult())
    expect((await first).status).toBe(200)
    expect((await divide(service, session)).status).toBe(200)
    expect(parse).toHaveBeenCalledTimes(2)
  })

  it('bounds upstream time and propagates cancellation with retries disabled', async () => {
    let upstreamOptions
    const parse = vi.fn().mockImplementation((_input, options) => {
      upstreamOptions = options
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(options.signal.reason)
        }, { once: true })
      })
    })
    const { client } = clientWithParse(parse)
    const service = await serve(configuredOptions({
      client,
      timeoutMs: 25,
    }))
    const session = await login(service)

    const timedOut = await divide(service, session)
    expect(timedOut.status).toBe(504)
    expect(await timedOut.json()).toEqual({
      error: 'The model took too long to respond. Please try again.',
    })
    expect(upstreamOptions).toMatchObject({
      timeout: 25,
      maxRetries: 0,
      signal: expect.any(AbortSignal),
    })
    expect(upstreamOptions.signal.aborted).toBe(true)
    expect(parse).toHaveBeenCalledOnce()
  })

  it('aborts the upstream request when the HTTP client disconnects', async () => {
    let firstSignal
    const parse = vi.fn()
      .mockImplementationOnce((_input, options) => {
        firstSignal = options.signal
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          })
        })
      })
      .mockResolvedValue(divisionResult())
    const { client } = clientWithParse(parse)
    const service = await serve(configuredOptions({
      client,
      maxConcurrentRequests: 1,
    }))
    const session = await login(service)
    const url = new URL('/api/divide', service.origin)

    const disconnected = new Promise((resolve) => {
      const request = http.request(url, {
        method: 'POST',
        headers: {
          ...paidHeaders(service, session),
          Connection: 'close',
        },
      })
      request.on('error', resolve)
      request.end(JSON.stringify({ problem: PROBLEM }))
      vi.waitFor(() => expect(parse).toHaveBeenCalledOnce()).then(() => request.destroy())
    })

    await disconnected
    await vi.waitFor(() => expect(firstSignal?.aborted).toBe(true))
    await vi.waitFor(() => expect(parse).toHaveBeenCalledOnce())
    expect((await divide(service, session)).status).toBe(200)
    expect(parse).toHaveBeenCalledTimes(2)
  })

  it('accepts valid large JSON and returns JSON for malformed or oversized bodies', async () => {
    const service = await serve(configuredOptions())

    const largeButAllowed = await service.request('/api/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: service.origin,
      },
      body: JSON.stringify({
        accessCode: ACCESS_CODE,
        ignoredPadding: 'x'.repeat(150_000),
      }),
    })
    expect(largeButAllowed.status).toBe(200)

    const malformed = await service.request('/api/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: service.origin,
      },
      body: '{"accessCode":',
    })
    expect(malformed.status).toBe(400)
    expect(malformed.headers.get('content-type')).toMatch(/application\/json/)
    expect(await malformed.json()).toEqual({
      error: 'Request body must be valid JSON.',
    })

    const unsupportedCharset = await service.request('/api/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=koi8-r',
        Origin: service.origin,
      },
      body: JSON.stringify({ accessCode: ACCESS_CODE }),
    })
    expect(unsupportedCharset.status).toBe(415)
    expect(await unsupportedCharset.json()).toEqual({
      error: 'Request body encoding is not supported.',
    })

    const malformedCompression = await service.request('/api/session', {
      method: 'POST',
      headers: {
        'Content-Encoding': 'br',
        'Content-Type': 'application/json',
        Origin: service.origin,
      },
      body: JSON.stringify({ accessCode: ACCESS_CODE }),
    })
    expect(malformedCompression.status).toBe(400)
    expect(await malformedCompression.json()).toEqual({
      error: 'Compressed request body could not be read.',
    })

    const oversized = await service.request('/api/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: service.origin,
      },
      body: JSON.stringify({
        accessCode: ACCESS_CODE,
        ignoredPadding: 'x'.repeat(300_000),
      }),
    })
    expect(oversized.status).toBe(413)
    expect(oversized.headers.get('content-type')).toMatch(/application\/json/)
    expect(await oversized.json()).toEqual({
      error: 'Request body is too large. The maximum size is 256 KB.',
    })
  })

  it('accepts the maximum valid multibyte completed-game payload below the body limit', async () => {
    const parse = vi.fn().mockResolvedValue(answerResult())
    const { client } = clientWithParse(parse)
    const service = await serve(configuredOptions({ client }))
    const session = await login(service)
    const body = JSON.stringify(maximumMultibyteGamePayload())

    expect(Buffer.byteLength(body)).toBeGreaterThan(100_000)
    expect(Buffer.byteLength(body)).toBeLessThan(256 * 1024)

    const response = await service.request('/api/answer', {
      method: 'POST',
      headers: paidHeaders(service, session),
      body,
    })

    expect(response.status).toBe(200)
    expect(parse).toHaveBeenCalledOnce()
    expect(await response.json()).toMatchObject({
      answer: expect.stringContaining('Choose one reversible step now.'),
      model: 'gpt-5.6-sol',
    })
  })
})

describe('model provider selection', () => {
  it.each([
    [undefined, 120_000],
    ['600000', 600_000],
    [25, 25],
  ])('normalizes upstream timeout %j to %d ms', (value, expected) => {
    expect(resolveUpstreamTimeoutMs(value)).toBe(expected)
  })

  it.each(['', 'slow', '0', '-1', '3600001', 1.5])(
    'rejects invalid upstream timeout %j',
    (value) => {
      expect(() => resolveUpstreamTimeoutMs(value)).toThrow(
        /WEBCHESS_UPSTREAM_TIMEOUT_MS/u,
      )
    },
  )

  it('keeps OpenAI API as the default and publishes only public provider metadata', async () => {
    const service = await serve(configuredOptions())
    const ready = await service.request('/api/ready')
    const readyBody = await ready.json()

    expect(ready.status).toBe(200)
    expect(readyBody.provider).toMatchObject({
      id: 'openai-api',
      label: expect.any(String),
      billing: 'platform-api',
      localOnly: false,
      dataControlsUrl: expect.stringMatching(/^https:\/\//u),
      model: 'gpt-5.6-sol',
      webSearch: 'disabled',
    })
    expect(Object.keys(readyBody.provider).sort()).toEqual([
      'billing',
      'dataControlsUrl',
      'id',
      'label',
      'localOnly',
      'model',
      'webSearch',
    ])
    expect(service.app.locals.webChessProvider).toEqual(readyBody.provider)

    const session = await login(service)
    expect(session.body.provider).toEqual(readyBody.provider)
  })

  it('constructs the default OpenAI API client with bounded transport settings', async () => {
    const { client } = clientWithParse()
    const createOpenAIClient = vi.fn().mockReturnValue(client)
    const service = await serve({
      accessCode: ACCESS_CODE,
      sessionSecret: SESSION_SECRET,
      secureCookies: false,
      environment: { OPENAI_API_KEY: 'server-side-test-key' },
      createOpenAIClient,
    })

    expect(createOpenAIClient).toHaveBeenCalledOnce()
    expect(createOpenAIClient).toHaveBeenCalledWith({
      apiKey: 'server-side-test-key',
      maxRetries: 0,
      timeout: 120_000,
    })
    expect((await service.request('/api/ready')).status).toBe(200)
  })

  it('constructs a loopback Ollama client with local-only provenance', async () => {
    const { client } = clientWithParse()
    const createOllamaClient = vi.fn().mockReturnValue(client)
    const service = await serve({
      accessCode: ACCESS_CODE,
      sessionSecret: SESSION_SECRET,
      environment: {
        WEBCHESS_MODEL_PROVIDER: 'ollama',
        WEBCHESS_OLLAMA_BASE_URL: 'http://127.0.0.1:11434/v1',
        WEBCHESS_UPSTREAM_TIMEOUT_MS: '600000',
        OPENAI_MODEL: 'qwen3.6:27b',
      },
      host: '127.0.0.1',
      createOllamaClient,
    })

    expect(createOllamaClient).toHaveBeenCalledOnce()
    expect(createOllamaClient).toHaveBeenCalledWith({
      baseURL: 'http://127.0.0.1:11434/v1',
      maxRetries: 0,
      timeout: 600_000,
    })

    const ready = await service.request('/api/ready')
    const body = await ready.json()
    expect(ready.status).toBe(200)
    expect(body.provider).toMatchObject({
      id: 'ollama',
      label: 'Ollama',
      billing: 'local-compute',
      localOnly: true,
      model: 'qwen3.6:27b',
      webSearch: 'disabled',
    })

    const session = await login(service)
    expect(session.response.status).toBe(200)
    expect(session.setCookie).not.toMatch(/;\s*Secure(?:;|$)/iu)
    expect(session.body.provider).toEqual(body.provider)
  })

  it('uses an injected ChatGPT Codex client without probing or falling back', async () => {
    const { client } = clientWithParse()
    const probe = vi.fn(() => {
      throw new Error('The probe must not run for an injected client.')
    })
    const service = await serve(configuredOptions({
      client,
      environment: {
        WEBCHESS_MODEL_PROVIDER: 'codex-chatgpt',
        WEBCHESS_CODEX_WEB_SEARCH: 'live',
        OPENAI_API_KEY: 'must-be-ignored',
      },
      host: '127.0.0.1',
      probeCodexChatGpt: probe,
    }))

    const ready = await service.request('/api/ready')
    const body = await ready.json()
    expect(ready.status).toBe(200)
    expect(body.provider).toMatchObject({
      id: 'codex-chatgpt',
      billing: 'chatgpt-workspace',
      localOnly: true,
      model: 'gpt-5.6-sol',
      webSearch: 'live',
    })
    expect(probe).not.toHaveBeenCalled()

    const session = await login(service)
    expect(session.body.provider).toEqual(body.provider)
    expect(session.body.provider).not.toHaveProperty('identity')
    expect(session.body.provider).not.toHaveProperty('executable')
    expect(session.body.provider).not.toHaveProperty('version')
  })

  it('requires a new sign-in after the configured provider changes', async () => {
    const apiService = await serve(configuredOptions())
    const apiSession = await login(apiService)
    expect(apiSession.response.status).toBe(200)

    const codexService = await serve(configuredOptions({
      environment: { WEBCHESS_MODEL_PROVIDER: 'codex-chatgpt' },
      host: '127.0.0.1',
    }))
    const crossedSession = await codexService.request('/api/session', {
      headers: { Cookie: apiSession.cookie },
    })
    expect(crossedSession.status).toBe(200)
    expect(await crossedSession.json()).toEqual({ authenticated: false })

    const crossedPaidRoute = await codexService.request('/api/divide', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: apiSession.cookie,
        Origin: codexService.origin,
        'X-WebChess-CSRF': apiSession.body.csrfToken,
      },
      body: JSON.stringify({ problem: PROBLEM }),
    })
    expect(crossedPaidRoute.status).toBe(401)

    const codexSession = await login(codexService)
    expect(codexSession.response.status).toBe(200)
    expect(codexSession.body.provider).toMatchObject({ id: 'codex-chatgpt' })
  })

  it('probes and creates the ChatGPT adapter synchronously when it is ready', async () => {
    const { client } = clientWithParse()
    const environment = {
      WEBCHESS_MODEL_PROVIDER: 'codex-chatgpt',
      WEBCHESS_CODEX_WEB_SEARCH: 'live',
      WEBCHESS_BWRAP_PATH: '/configured/bwrap',
      WEBCHESS_CA_BUNDLE_PATH: '/configured/ca-bundle.crt',
      WEBCHESS_CODEX_PATH: '/configured/codex',
      WEBCHESS_CODEX_HOME: '/configured/codex-home',
      WEBCHESS_CODEX_SHA256: 'a'.repeat(64),
      OPENAI_API_KEY: 'must-not-be-used-as-a-fallback',
    }
    const probe = vi.fn().mockReturnValue({
      ok: true,
      bwrapPath: '/resolved/bwrap',
      caBundlePath: '/resolved/ca-bundle.crt',
      executable: '/resolved/codex',
      codexHome: '/resolved/codex-home',
      codexSha256: 'b'.repeat(64),
      hostsPath: '/resolved/hosts',
      resolverPath: '/resolved/resolv.conf',
      version: 'codex-cli test',
    })
    const createClient = vi.fn().mockReturnValue(client)
    const service = await serve({
      accessCode: ACCESS_CODE,
      sessionSecret: SESSION_SECRET,
      secureCookies: false,
      environment,
      host: 'localhost',
      hostsPath: '/configured/hosts',
      resolverPath: '/configured/resolv.conf',
      probeCodexChatGpt: probe,
      createCodexChatGptClient: createClient,
    })

    expect(probe).toHaveBeenCalledWith({
      environment,
      bwrapPath: '/configured/bwrap',
      caBundlePath: '/configured/ca-bundle.crt',
      codexPath: '/configured/codex',
      codexHome: '/configured/codex-home',
      codexSha256: 'a'.repeat(64),
      hostsPath: '/configured/hosts',
      resolverPath: '/configured/resolv.conf',
      timeoutMs: undefined,
      webSearchMode: 'live',
    })
    expect(createClient).toHaveBeenCalledWith({
      environment,
      bwrapPath: '/resolved/bwrap',
      caBundlePath: '/resolved/ca-bundle.crt',
      codexPath: '/resolved/codex',
      codexHome: '/resolved/codex-home',
      codexSha256: 'b'.repeat(64),
      hostsPath: '/resolved/hosts',
      resolverPath: '/resolved/resolv.conf',
      timeoutMs: 120_000,
      webSearchMode: 'live',
    })
    const ready = await service.request('/api/ready')
    expect(ready.status).toBe(200)
    expect(await ready.json()).toMatchObject({
      ok: true,
      provider: { id: 'codex-chatgpt', localOnly: true },
    })
  })

  it('does not use an available API key when the selected ChatGPT probe fails', async () => {
    const probe = vi.fn().mockReturnValue({
      ok: false,
      reason: 'Authentication failed for private@example.test in /home/operator.',
    })
    const createClient = vi.fn()
    const createOpenAIClient = vi.fn()
    const service = await serve({
      accessCode: ACCESS_CODE,
      sessionSecret: SESSION_SECRET,
      secureCookies: false,
      environment: {
        WEBCHESS_MODEL_PROVIDER: 'codex-chatgpt',
        OPENAI_API_KEY: 'available-but-forbidden',
      },
      host: '127.0.0.1',
      probeCodexChatGpt: probe,
      createCodexChatGptClient: createClient,
      createOpenAIClient,
    })

    const ready = await service.request('/api/ready')
    const body = await ready.json()
    expect(ready.status).toBe(503)
    expect(body).toMatchObject({
      ok: false,
      upstream: 'not-configured',
      provider: { id: 'codex-chatgpt', localOnly: true },
      reason: 'The selected model provider needs a local sign-in.',
    })
    expect(JSON.stringify(body)).not.toMatch(/private@|\/home\/|available-but-forbidden/u)
    expect(createClient).not.toHaveBeenCalled()
    expect(createOpenAIClient).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'non-loopback bind',
      host: '0.0.0.0',
      allowedOrigins: undefined,
      expected: /loopback host/i,
    },
    {
      label: 'non-loopback browser origin',
      host: '127.0.0.1',
      allowedOrigins: ['https://webchess.example'],
      expected: /non-loopback browser origins/i,
    },
    {
      label: 'trusted proxy configuration',
      host: '127.0.0.1',
      trustProxy: '127.0.0.1/32',
      expected: /trusted proxy/i,
    },
  ])('fails ChatGPT Codex readiness for a $label', async ({
    allowedOrigins,
    expected,
    host,
    trustProxy,
  }) => {
    const { client } = clientWithParse()
    const service = await serve(configuredOptions({
      client,
      environment: {
        WEBCHESS_MODEL_PROVIDER: 'codex-chatgpt',
        ...(allowedOrigins
          ? { WEBCHESS_ALLOWED_ORIGINS: allowedOrigins.join(',') }
          : {}),
        ...(trustProxy ? { WEBCHESS_TRUST_PROXY: trustProxy } : {}),
      },
      host,
    }))

    const ready = await service.request('/api/ready')
    const body = await ready.json()
    expect(ready.status).toBe(503)
    expect(body.reason).toMatch(expected)
    expect(body.provider).toMatchObject({
      id: 'codex-chatgpt',
      localOnly: true,
    })
  })

  it('rejects a reverse-proxied public origin even when same-origin headers agree', async () => {
    const { client } = clientWithParse()
    const service = await serve(configuredOptions({
      client,
      environment: { WEBCHESS_MODEL_PROVIDER: 'codex-chatgpt' },
      host: '127.0.0.1',
    }))

    const result = await rawJsonRequest(service, '/api/session', {
      Host: 'webchess.example',
      Origin: 'https://webchess.example',
    }, { accessCode: ACCESS_CODE })

    expect(result.status).toBe(403)
    expect(result.body).toEqual({
      error: 'The local model provider accepts only loopback requests.',
    })
  })

  it('blocks valid paid credentials when a public reverse proxy forwards them', async () => {
    const { client, parse } = clientWithParse()
    const service = await serve(configuredOptions({
      client,
      environment: { WEBCHESS_MODEL_PROVIDER: 'codex-chatgpt' },
      host: '127.0.0.1',
    }))
    const session = await login(service)

    const result = await rawJsonRequest(service, '/api/divide', {
      Cookie: session.cookie,
      Host: 'webchess.example',
      Origin: 'https://webchess.example',
      'X-WebChess-CSRF': session.body.csrfToken,
    }, { problem: PROBLEM })

    expect(result.status).toBe(403)
    expect(result.body).toEqual({
      error: 'The local model provider accepts only loopback requests.',
    })
    expect(parse).not.toHaveBeenCalled()
  })

  it('keeps Ollama requests on the loopback browser origin', async () => {
    const { client } = clientWithParse()
    const service = await serve(configuredOptions({
      client,
      environment: { WEBCHESS_MODEL_PROVIDER: 'ollama' },
      host: '127.0.0.1',
    }))

    const result = await rawJsonRequest(service, '/api/session', {
      Host: 'webchess.example',
      Origin: 'https://webchess.example',
    }, { accessCode: ACCESS_CODE })

    expect(result.status).toBe(403)
    expect(result.body).toEqual({
      error: 'The local model provider accepts only loopback requests.',
    })
  })

  it('streams the reasoning summary and no draft output before a validated division result', async () => {
    const reasoningSummary = 'Weighing capacity against the people who make the work good'
    const unvalidatedDraft = '{"private":"unfinished provider output"}'
    const finalResponse = vi.fn().mockResolvedValue(divisionResult())
    const stream = vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'response.reasoning_summary_text.delta',
          delta: reasoningSummary,
        }
        yield {
          type: 'response.output_text.delta',
          delta: unvalidatedDraft,
        }
        yield {
          type: 'response.completed',
          response: { reasoningSummary, unvalidatedDraft },
        }
      },
      finalResponse,
    }))
    const parse = vi.fn()
    const service = await serve(configuredOptions({
      client: { responses: { parse, stream } },
      modelActivityHeartbeatMs: 0,
    }))
    const session = await login(service)

    const unauthenticated = await service.request('/api/divide', {
      method: 'POST',
      headers: {
        Accept: 'application/x-ndjson, application/json',
        'Content-Type': 'application/json',
        Origin: service.origin,
      },
      body: JSON.stringify({ problem: PROBLEM }),
    })
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get('content-type')).toMatch(/application\/json/u)

    const response = await service.request('/api/divide', {
      method: 'POST',
      headers: {
        ...paidHeaders(service, session),
        Accept: 'application/x-ndjson, application/json',
      },
      body: JSON.stringify({ problem: PROBLEM }),
    })
    const text = await response.text()
    const events = text.trim().split('\n').map((line) => JSON.parse(line))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/application\/x-ndjson/u)
    expect(events.filter(({ type }) => type === 'phase').map(({ phase }) => phase))
      .toEqual([
        'request-accepted',
        'preparing-input',
        'awaiting-model',
        'thinking',
        'drafting',
        'validating-output',
        'complete',
      ])
    expect(events.filter(({ type }) => type === 'provider_activity')).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      data: {
        model: 'gpt-5.6-sol',
        facets: expect.arrayContaining([
          expect.objectContaining({ id: 1 }),
        ]),
      },
    })
    // Platform reasoning summaries are written for display, so they are shown.
    expect(events.filter(({ type }) => type === 'reasoning')).toEqual([
      { type: 'reasoning', source: 'summary', text: reasoningSummary },
    ])
    // Unvalidated draft output still never reaches the browser.
    expect(text).not.toContain(unvalidatedDraft)
    expect(stream).toHaveBeenCalledOnce()
    expect(parse).not.toHaveBeenCalled()
    expect(finalResponse).toHaveBeenCalledOnce()
  })

  it('streams only validated public Qwen rationale before the Ollama division', async () => {
    const privateReasoning = 'PRIVATE Qwen reasoning must never cross the boundary'
    const unfinishedDraft = '{"private":"unfinished primary output"}'
    const publicNote =
      'Check which standards make the work recognizably yours before expanding its reach.'
    const completedDivision = {
      status: 'completed',
      incomplete_details: null,
      model: 'qwen3.6:27b',
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: JSON.stringify({ facets: facets() }),
        }],
      }],
    }
    const create = vi.fn()
      .mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'response.reasoning_summary_text.delta',
            delta: privateReasoning,
          }
          yield {
            type: 'response.output_text.delta',
            delta: `NOTE: ${publicNote}\n`,
          }
          yield {
            type: 'response.completed',
            response: {
              status: 'completed',
              incomplete_details: null,
            },
          }
        },
      })
      .mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'response.reasoning_summary_text.delta',
            delta: privateReasoning,
          }
          yield {
            type: 'response.output_text.delta',
            delta: unfinishedDraft,
          }
          yield {
            type: 'response.completed',
            response: completedDivision,
          }
        },
      })
    const parse = vi.fn()
    const stream = vi.fn()
    const service = await serve(configuredOptions({
      client: { responses: { create, parse, stream } },
      environment: { WEBCHESS_MODEL_PROVIDER: 'ollama' },
      host: '127.0.0.1',
      model: 'qwen3.6:27b',
      modelActivityHeartbeatMs: 0,
      seedFactory: () => 'public-rationale-seed',
    }))
    const session = await login(service)

    const response = await service.request('/api/divide', {
      method: 'POST',
      headers: {
        ...paidHeaders(service, session),
        Accept: 'application/x-ndjson, application/json',
      },
      body: JSON.stringify({ problem: PROBLEM }),
    })
    const text = await response.text()
    const events = text.trim().split('\n').map((line) => JSON.parse(line))

    expect(response.status).toBe(200)
    expect(events.filter(({ type }) => type === 'phase').map(({ phase }) => phase))
      .toEqual([
        'request-accepted',
        'preparing-input',
        'writing-rationale',
        'awaiting-model',
        'thinking',
        'drafting',
        'validating-output',
        'complete',
      ])
    expect(events.filter(({ type }) => type === 'rationale')).toEqual([
      { type: 'rationale', text: publicNote },
    ])
    expect(events.findIndex(({ type }) => type === 'rationale'))
      .toBeLessThan(events.findIndex(({ type }) => type === 'result'))
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      data: {
        seed: 'public-rationale-seed',
        model: 'qwen3.6:27b',
        facets: expect.arrayContaining([
          expect.objectContaining({ id: 1 }),
        ]),
      },
    })
    // A local model runs inside the operator's own trust boundary, so its
    // thinking is displayed — but only ever labelled `raw`, never dressed up
    // as a provider-authored summary.
    expect(events.filter(({ type }) => type === 'reasoning')).toEqual([
      { type: 'reasoning', source: 'raw', text: privateReasoning },
    ])
    // Partial output text is still never forwarded: only the validated result is.
    expect(text).not.toContain(unfinishedDraft)
    expect(create).toHaveBeenCalledTimes(2)
    expect(stream).not.toHaveBeenCalled()
    expect(parse).not.toHaveBeenCalled()
  })

  it('never forwards reasoning from a provider that has no displayable summary', async () => {
    const privateReasoning = 'PRIVATE Codex reasoning must never cross the boundary'
    const create = vi.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'response.reasoning_summary_text.delta',
          delta: privateReasoning,
        }
        yield {
          type: 'response.completed',
          response: {
            status: 'completed',
            incomplete_details: null,
            model: 'gpt-5.6-sol',
            output: [{
              type: 'message',
              content: [{
                type: 'output_text',
                text: JSON.stringify({ facets: facets() }),
              }],
            }],
          },
        }
      },
    })
    const service = await serve(configuredOptions({
      client: { responses: { create, parse: vi.fn() } },
      environment: { WEBCHESS_MODEL_PROVIDER: 'codex-chatgpt' },
      host: '127.0.0.1',
      modelActivityHeartbeatMs: 0,
      seedFactory: () => 'codex-seed',
    }))
    const session = await login(service)

    const response = await service.request('/api/divide', {
      method: 'POST',
      headers: {
        ...paidHeaders(service, session),
        Accept: 'application/x-ndjson, application/json',
      },
      body: JSON.stringify({ problem: PROBLEM }),
    })
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).not.toContain(privateReasoning)
    expect(text).not.toContain('"type":"reasoning"')
  })
})
