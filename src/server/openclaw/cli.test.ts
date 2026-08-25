// @vitest-environment node

import { createHash } from 'node:crypto'
import { once } from 'node:events'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createOpenClawBridgeRequester,
  getOpenClawStatus,
  OpenClawCliError,
  parseModelRunEnvelope,
  parseOpenClawWebSearchEnvelope,
  runOpenClawWebSearch,
  type OpenClawBridgeRequester,
} from './cli'
import type { OpenClawConfig } from './config'

const QUERY = 'current evidence for reversible LLM inference speedups'
const MARKER_ID = '0123456789abcdef'
const loopbackServers: Server[] = []

interface Deferred<T> {
  promise: Promise<T>
  resolve(value?: T | PromiseLike<T>): void
}

function deferred<T = void>(): Deferred<T> {
  let resolvePromise!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: (value) => resolvePromise(value as T),
  }
}

async function listenLoopback(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ origin: string; server: Server }> {
  const server = createServer(handler)
  loopbackServers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP loopback test address.')
  }
  return { origin: `http://127.0.0.1:${String(address.port)}`, server }
}

async function closeLoopback(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(loopbackServers.splice(0).map(closeLoopback))
})

function config(overrides: Partial<OpenClawConfig> = {}): OpenClawConfig {
  return {
    binary: 'openclaw-research',
    bridgeToken: 't'.repeat(43),
    bridgeUrl: 'http://127.0.0.1:44123',
    maxOutputBytes: 64 * 1024,
    searchTimeoutMs: 300_000,
    timeoutMs: 45_000,
    transport: 'local',
    ...overrides,
  }
}

function wrappedContent(
  body = 'A grounded search synthesis with https://example.com/source.',
  startId = MARKER_ID,
  endId = startId,
): string {
  return [
    `<<<EXTERNAL_UNTRUSTED_CONTENT id="${startId}">>>`,
    'Source: Web Search',
    '---',
    body,
    `<<<END_EXTERNAL_UNTRUSTED_CONTENT id="${endId}">>>`,
  ].join('\n')
}

interface EnvelopeOverrides {
  content?: string
  externalProvider?: string
  extraOuterField?: boolean
  innerProvider?: string
  outerProvider?: string
  query?: string
  searches?: unknown[]
  tookMs?: number
  transport?: string
  untrusted?: boolean
  wrapped?: boolean
}

function webSearchEnvelope(overrides: EnvelopeOverrides = {}): string {
  const envelope: Record<string, unknown> = {
    ok: true,
    capability: 'web.search',
    transport: overrides.transport ?? 'local',
    provider: overrides.outerProvider ?? 'codex',
    inputBytes: Buffer.byteLength(QUERY, 'utf8'),
    inputSha256: createHash('sha256').update(QUERY, 'utf8').digest('hex'),
    attempts: [],
    outputs: [{
      result: {
        query: overrides.query ?? QUERY,
        provider: overrides.innerProvider ?? 'codex',
        model: 'gpt-5.6',
        tookMs: overrides.tookMs ?? 1_234,
        externalContent: {
          untrusted: overrides.untrusted ?? true,
          source: 'web_search',
          provider: overrides.externalProvider ?? 'codex',
          wrapped: overrides.wrapped ?? true,
        },
        content: overrides.content ?? wrappedContent(),
        searches: overrides.searches ?? [{
          query: QUERY,
          queries: [QUERY, 'bounded speculative decoding evidence'],
          action: 'open',
          url: 'https://example.com/source',
          pattern: 'latency',
        }],
      },
    }],
  }
  if (overrides.extraOuterField) envelope.unexpected = true
  return JSON.stringify(envelope)
}

function expectInvalidOutput(run: () => unknown): void {
  let caught: unknown
  try {
    run()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(OpenClawCliError)
  expect(caught).toMatchObject({ kind: 'invalid-output' })
}

function modelEnvelope(outputs: string[], input = ''): string {
  return JSON.stringify({
    ok: true,
    capability: 'model.run',
    transport: 'local',
    provider: 'test-provider',
    model: 'test-model',
    inputBytes: Buffer.byteLength(input, 'utf8'),
    inputSha256: createHash('sha256').update(input, 'utf8').digest('hex'),
    outputs: outputs.map((text) => ({ text })),
  })
}

function searchReadiness(available = true) {
  return {
    available,
    checked: 'live-readiness-probe',
    configurationReady: available,
    oauthReady: available,
    provider: 'codex',
    providerReady: available,
    queryExecuted: true,
    requiredForLaunch: true,
  }
}

describe('Codex Hosted Search CLI adapter', () => {
  it('invokes the explicit local Codex capability with bounded caller config', async () => {
    const signal = new AbortController().signal
    const researchConfig = config()
    const request = vi.fn<OpenClawBridgeRequester>(async () => webSearchEnvelope())

    const result = await runOpenClawWebSearch(QUERY, researchConfig, {
      request,
      limit: 4,
      maxContentChars: 2_000,
      maxSearchActivities: 3,
      signal,
    })

    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[0]).toBe('/v1/web/search')
    expect(request.mock.calls[0]?.[1]).toEqual({
      limit: 4,
      query: QUERY,
      timeoutMs: 300_000,
      version: 1,
    })
    expect(request.mock.calls[0]?.[2]).toEqual(researchConfig)
    expect(request.mock.calls[0]?.[3]).toEqual({
      requestTimeoutMs: 305_000,
      signal,
    })
    expect(result).toMatchObject({
      query: QUERY,
      provider: 'codex',
      model: 'gpt-5.6',
      tookMs: 1_234,
      transport: 'local',
      externalContent: {
        untrusted: true,
        source: 'web_search',
        provider: 'codex',
        wrapped: true,
      },
    })
    expect(result.content).toBe(wrappedContent())
    expect(result.searches).toEqual([{
      query: QUERY,
      queries: [QUERY, 'bounded speculative decoding evidence'],
      action: 'open',
      url: 'https://example.com/source',
      pattern: 'latency',
    }])
  })

  it('strictly parses a bounded Codex search envelope', () => {
    expect(parseOpenClawWebSearchEnvelope(
      webSearchEnvelope(),
      QUERY,
      {
        maxContentChars: 2_000,
        maxOutputBytes: 64 * 1024,
        maxSearchActivities: 3,
        maxTookMs: 45_000,
      },
    )).toMatchObject({
      query: QUERY,
      provider: 'codex',
      model: 'gpt-5.6',
      tookMs: 1_234,
      transport: 'local',
    })
  })

  it('canonicalizes harmless ASCII whitespace around the untrusted boundary', () => {
    const content = wrappedContent()
    const searches = [
      { query: QUERY, queries: [QUERY, 'current primary guidance'] },
      { action: 'other' },
    ]
    const parsed = parseOpenClawWebSearchEnvelope(
      webSearchEnvelope({ content: ` \n${content}\n\t`, searches }),
      QUERY,
    )
    expect(parsed.content).toBe(content)
    expect(parsed.searches).toEqual(searches)
  })

  it.each([
    ['a text prefix', `log\n${wrappedContent()}`],
    ['a text suffix', `${wrappedContent()}\nwarning`],
    ['invisible Unicode framing', `\u200B${wrappedContent()}`],
  ])('rejects %s outside the untrusted boundary', (_label, content) => {
    expectInvalidOutput(() => parseOpenClawWebSearchEnvelope(
      webSearchEnvelope({ content }),
      QUERY,
    ))
  })

  it('applies the raw content bound before trimming framing whitespace', () => {
    const content = wrappedContent()
    expectInvalidOutput(() => parseOpenClawWebSearchEnvelope(
      webSearchEnvelope({ content: `\n${content}` }),
      QUERY,
      { maxContentChars: content.length },
    ))
  })

  it.each([
    ['outer provider', { outerProvider: 'brave' }],
    ['inner provider', { innerProvider: 'brave' }],
    ['external marker provider', { externalProvider: 'brave' }],
    ['transport', { transport: 'gateway' }],
    ['query', { query: 'a different search query' }],
    ['untrusted marker', { untrusted: false }],
    ['wrapped marker', { wrapped: false }],
    ['content boundary', {
      content: wrappedContent('grounded synthesis', MARKER_ID, 'fedcba9876543210'),
    }],
  ] satisfies Array<[string, EnvelopeOverrides]>)('rejects a %s mismatch', (
    _label,
    overrides,
  ) => {
    expectInvalidOutput(() => parseOpenClawWebSearchEnvelope(
      webSearchEnvelope(overrides),
      QUERY,
    ))
  })

  it.each([
    ['non-JSON output', 'not json'],
    ['the wrong JSON shape', JSON.stringify({ ok: true })],
    ['unexpected outer fields', webSearchEnvelope({ extraOuterField: true })],
  ])('rejects %s', (_label, stdout) => {
    expectInvalidOutput(() => parseOpenClawWebSearchEnvelope(stdout, QUERY))
  })

  it('fails closed when content, activity, timing, or stdout exceeds its bound', () => {
    expectInvalidOutput(() => parseOpenClawWebSearchEnvelope(
      webSearchEnvelope(),
      QUERY,
      { maxContentChars: 100 },
    ))
    expectInvalidOutput(() => parseOpenClawWebSearchEnvelope(
      webSearchEnvelope({ searches: [
        { query: QUERY },
        { query: 'second query' },
      ] }),
      QUERY,
      { maxSearchActivities: 1 },
    ))
    expectInvalidOutput(() => parseOpenClawWebSearchEnvelope(
      webSearchEnvelope({ tookMs: 45_001 }),
      QUERY,
      { maxTookMs: 45_000 },
    ))
    expectInvalidOutput(() => parseOpenClawWebSearchEnvelope(
      webSearchEnvelope(),
      QUERY,
      { maxOutputBytes: 100 },
    ))
  })

  it('rejects unbounded query and limit inputs before invoking OpenClaw', async () => {
    const request = vi.fn<OpenClawBridgeRequester>()
    await expect(runOpenClawWebSearch(' query with padding ', config(), {
      request,
    })).rejects.toBeInstanceOf(RangeError)
    await expect(runOpenClawWebSearch(QUERY, config(), {
      request,
      limit: 11,
    })).rejects.toBeInstanceOf(RangeError)
    expect(request).not.toHaveBeenCalled()
  })
})

describe('authenticated loopback bridge failure boundaries', () => {
  it.each([
    ['request timeout status', 408, '{not-json', 'aborted'],
    ['provider abort code', 400, { error: { code: 'OPENCLAW_ABORTED' } }, 'aborted'],
    ['gateway timeout status', 504, '{not-json', 'timeout'],
    ['provider timeout code', 400, { error: { code: 'OPENCLAW_TIMEOUT' } }, 'timeout'],
    ['missing bridge route', 404, { error: {} }, 'not-found'],
    ['invalid model result', 422, { error: { code: 'INVALID_MODEL_RESULT' } }, 'invalid-output'],
    ['oversized provider result', 422, { error: { code: 'RESPONSE_TOO_LARGE' } }, 'invalid-output'],
    ['unclassified bridge failure', 500, '{not-json', 'failed'],
  ] as const)('classifies a %s without exposing its response', async (
    _label,
    status,
    responseBody,
    kind,
  ) => {
    const output = typeof responseBody === 'string'
      ? responseBody
      : JSON.stringify(responseBody)
    const { origin } = await listenLoopback((_incoming, response) => {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(output)
    })
    const request = createOpenClawBridgeRequester()

    await expect(request(
      '/v1/model/run',
      { prompt: 'bounded prompt' },
      config({ bridgeUrl: origin }),
    )).rejects.toMatchObject({
      kind,
      message: 'The OpenClaw plugin bridge rejected the request.',
    })
  })

  it('rejects invalid requester options before dispatch', async () => {
    let requests = 0
    const { origin } = await listenLoopback((_incoming, response) => {
      requests += 1
      response.end('ok')
    })
    const request = createOpenClawBridgeRequester()
    const loopbackConfig = config({ bridgeUrl: origin })

    await expect(request('/v1/status', null, loopbackConfig, {
      idempotencyKey: 'model-turn-only',
    })).rejects.toBeInstanceOf(RangeError)
    await expect(request('/v1/status', null, loopbackConfig, {
      requestTimeoutMs: 0,
    })).rejects.toBeInstanceOf(RangeError)
    await expect(request('/v1/status', null, loopbackConfig, {
      requestTimeoutMs: 305_001,
    })).rejects.toBeInstanceOf(RangeError)
    expect(requests).toBe(0)
  })

  it('distinguishes caller cancellation from bridge unavailability', async () => {
    const controller = new AbortController()
    const received = deferred()
    const { origin } = await listenLoopback(() => received.resolve())
    const request = createOpenClawBridgeRequester()
    const pending = request('/v1/status', null, config({ bridgeUrl: origin }), {
      signal: controller.signal,
    })
    await received.promise
    controller.abort()

    await expect(pending).rejects.toMatchObject({
      kind: 'aborted',
      message: 'The local OpenClaw request was cancelled.',
    })

    const unavailableListener = await listenLoopback((_incoming, response) => {
      response.end('not reached')
    })
    const unavailableOrigin = unavailableListener.origin
    await closeLoopback(unavailableListener.server)
    loopbackServers.splice(loopbackServers.indexOf(unavailableListener.server), 1)
    const unavailable = createOpenClawBridgeRequester()
    await expect(unavailable(
      '/v1/status',
      null,
      config({ bridgeUrl: unavailableOrigin }),
    )).rejects.toMatchObject({
      kind: 'failed',
      message: 'The authenticated OpenClaw plugin bridge was unavailable.',
    })
  })

  it('uses one unpooled loopback request with an exact JSON byte length', async () => {
    const received = deferred<{
      body: string
      connection: string | undefined
      contentLength: string | undefined
      method: string | undefined
      path: string | undefined
      token: string | undefined
    }>()
    const { origin } = await listenLoopback((incoming, response) => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
      incoming.on('end', () => {
        received.resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          connection: incoming.headers.connection,
          contentLength: incoming.headers['content-length'],
          method: incoming.method,
          path: incoming.url,
          token: incoming.headers.authorization,
        })
        response.end('ok')
      })
    })
    const request = createOpenClawBridgeRequester()
    const prompt = 'bounded Unicode π prompt'

    await expect(request(
      '/v1/model/run',
      { prompt },
      config({ bridgeUrl: origin }),
      { idempotencyKey: 'stable-turn' },
    )).resolves.toBe('ok')
    const observed = await received.promise
    expect(observed).toMatchObject({
      connection: 'close',
      method: 'POST',
      path: '/v1/model/run',
      token: `Bearer ${'t'.repeat(43)}`,
    })
    expect(JSON.parse(observed.body)).toEqual({
      prompt,
      turnId: 'stable-turn',
    })
    expect(Number(observed.contentLength)).toBe(
      Buffer.byteLength(observed.body, 'utf8'),
    )
  })

  it('accepts the complete 305-second logical envelope without a hidden 300-second cap', async () => {
    vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] })
    const received = deferred()
    const { origin } = await listenLoopback((_incoming, response) => {
      received.resolve()
      setTimeout(() => response.end('ready'), 300_001)
    })
    const request = createOpenClawBridgeRequester()
    const pending = request('/v1/status', null, config({ bridgeUrl: origin }), {
      requestTimeoutMs: 305_000,
    })
    await received.promise

    await vi.advanceTimersByTimeAsync(300_001)
    await expect(pending).resolves.toBe('ready')
  })

  it('accepts the exact response byte bound and rejects one byte more', async () => {
    const exact = 'x'.repeat(1_024)
    let responseBody = exact
    const overflowClose = deferred()
    const { origin } = await listenLoopback((_incoming, response) => {
      if (responseBody.length === exact.length) {
        response.end(responseBody)
        return
      }
      response.once('close', () => overflowClose.resolve())
      response.write(responseBody)
    })
    const request = createOpenClawBridgeRequester()
    const boundedConfig = config({ bridgeUrl: origin, maxOutputBytes: 1_024 })

    await expect(request('/v1/status', null, boundedConfig)).resolves.toBe(exact)
    responseBody = `${exact}x`
    await expect(request('/v1/status', null, boundedConfig)).rejects.toMatchObject({
      kind: 'invalid-output',
      message: 'The OpenClaw bridge response exceeded its byte limit.',
    })
    await overflowClose.promise
  })

  it('refuses redirects instead of following a second request', async () => {
    let redirectedRequests = 0
    const redirected = await listenLoopback((_incoming, response) => {
      redirectedRequests += 1
      response.end('unexpected')
    })
    const redirecting = await listenLoopback((_incoming, response) => {
      response.writeHead(302, { Location: `${redirected.origin}/private` })
      response.end('redirect')
    })
    const request = createOpenClawBridgeRequester()

    await expect(request(
      '/v1/status',
      null,
      config({ bridgeUrl: redirecting.origin }),
    )).rejects.toMatchObject({
      kind: 'failed',
      message: 'The OpenClaw plugin bridge rejected the request.',
    })
    expect(redirectedRequests).toBe(0)
  })

  it('fails closed on premature response close and settles abort-timeout races once', async () => {
    const premature = await listenLoopback((_incoming, response) => {
      response.writeHead(200, { 'Content-Length': '10' })
      response.write('short')
      response.destroy()
    })
    const request = createOpenClawBridgeRequester()
    await expect(request(
      '/v1/status',
      null,
      config({ bridgeUrl: premature.origin }),
    )).rejects.toMatchObject({
      kind: 'failed',
      message: 'The authenticated OpenClaw plugin bridge was unavailable.',
    })

    const received = deferred()
    const cancelledConnectionClosed = deferred()
    const hanging = await listenLoopback((_incoming, response) => {
      received.resolve()
      response.once('close', () => cancelledConnectionClosed.resolve())
    })
    const controller = new AbortController()
    const raced = request(
      '/v1/status',
      null,
      config({ bridgeUrl: hanging.origin }),
      { requestTimeoutMs: 20, signal: controller.signal },
    )
    await received.promise
    controller.abort()
    await expect(raced).rejects.toMatchObject({ kind: 'aborted' })
    await cancelledConnectionClosed.promise
    await new Promise((resolve) => setTimeout(resolve, 30))
    await expect(raced).rejects.toMatchObject({ kind: 'aborted' })
  })

  it('applies the same total deadline while draining a response body', async () => {
    const bodyStarted = deferred()
    const connectionClosed = deferred()
    const { origin } = await listenLoopback((_incoming, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.write('{"partial":')
      bodyStarted.resolve()
      response.once('close', () => connectionClosed.resolve())
    })
    const request = createOpenClawBridgeRequester()
    const pending = request(
      '/v1/status',
      null,
      config({ bridgeUrl: origin }),
      { requestTimeoutMs: 100 },
    )
    await bodyStarted.promise

    await expect(pending).rejects.toMatchObject({
      kind: 'timeout',
      message: 'OpenClaw did not finish within the local request timeout.',
    })
    await connectionClosed.promise
  })

  it('revalidates the exact loopback origin, fixed path, and bearer characters', async () => {
    const request = createOpenClawBridgeRequester()
    for (const bridgeUrl of [
      'http://localhost:44123',
      'http://127.0.0.1:44123/',
      'http://127.0.0.1:44123/path',
      'https://127.0.0.1:44123',
    ]) {
      await expect(request(
        '/v1/status',
        null,
        config({ bridgeUrl }),
      )).rejects.toMatchObject({ kind: 'failed' })
    }
    await expect(request(
      '/v1/status',
      null,
      config({ bridgeToken: `${'t'.repeat(43)}\r\nInjected: true` }),
    )).rejects.toMatchObject({
      kind: 'failed',
      message: 'The authenticated OpenClaw plugin bridge was unavailable.',
    })
    await expect((request as unknown as (
      path: string,
      body: null,
      value: OpenClawConfig,
    ) => Promise<string>)(
      '/v1/status/../model/run',
      null,
      config(),
    )).rejects.toMatchObject({ kind: 'failed' })
  })
})

describe('model and readiness envelope edge cases', () => {
  it('rejects a structurally valid model envelope with no usable output text', () => {
    expectInvalidOutput(() => parseModelRunEnvelope(modelEnvelope([' ', '\n\t'])))
  })

  it('retains a safe model label when another readiness requirement is absent', async () => {
    const request = vi.fn<OpenClawBridgeRequester>(async () => JSON.stringify({
      available: true,
      model: 'openai/account-model',
      protocolVersion: 1,
      search: searchReadiness(false),
      transport: 'local',
      version: 'OpenClaw fixture',
    }))

    await expect(getOpenClawStatus(config(), { request })).resolves.toMatchObject({
      available: false,
      model: 'openai/account-model',
      reason: 'not-configured',
    })
  })

  it('fails closed through the default requesters when no bridge is configured', async () => {
    const unconfigured = config({ bridgeToken: null, bridgeUrl: null })

    await expect(getOpenClawStatus(unconfigured)).resolves.toMatchObject({
      available: false,
      reason: 'cli-not-found',
    })
    await expect(runOpenClawWebSearch(QUERY, unconfigured)).rejects.toMatchObject({
      kind: 'not-found',
    })
  })
})
