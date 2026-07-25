// @vitest-environment node

import http from 'node:http'
import { once } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DIVISION_QUALITY_FIXTURES } from '../evals/division-quality-fixtures.mjs'
import { createWebChessApp } from './app.mjs'

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
    origin,
    server,
    async request(path, init = {}) {
      return fetch(`${origin}${path}`, init)
    },
  }
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
      maxConcurrentRequests: 1,
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
