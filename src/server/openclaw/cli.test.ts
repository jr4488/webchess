// @vitest-environment node

import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

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
    const request = createOpenClawBridgeRequester(
      vi.fn(async () => new Response(output, { status })),
    )

    await expect(request(
      '/v1/model/run',
      { prompt: 'bounded prompt' },
      config(),
    )).rejects.toMatchObject({
      kind,
      message: 'The OpenClaw plugin bridge rejected the request.',
    })
  })

  it('rejects invalid requester options before dispatch', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>()
    const request = createOpenClawBridgeRequester(fetcher)

    await expect(request('/v1/status', null, config(), {
      idempotencyKey: 'model-turn-only',
    })).rejects.toBeInstanceOf(RangeError)
    await expect(request('/v1/status', null, config(), {
      requestTimeoutMs: 0,
    })).rejects.toBeInstanceOf(RangeError)
    await expect(request('/v1/status', null, config(), {
      requestTimeoutMs: 305_001,
    })).rejects.toBeInstanceOf(RangeError)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('distinguishes caller cancellation from bridge unavailability', async () => {
    const controller = new AbortController()
    const hangingFetch = vi.fn<typeof globalThis.fetch>(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const rejectOnAbort = () => {
          reject(new DOMException('private abort detail', 'AbortError'))
        }
        if (init?.signal?.aborted) rejectOnAbort()
        else init?.signal?.addEventListener('abort', rejectOnAbort, { once: true })
      }))
    const request = createOpenClawBridgeRequester(hangingFetch)
    const pending = request('/v1/status', null, config(), {
      signal: controller.signal,
    })
    controller.abort()

    await expect(pending).rejects.toMatchObject({
      kind: 'aborted',
      message: 'The local OpenClaw request was cancelled.',
    })

    const unavailable = createOpenClawBridgeRequester(
      vi.fn(async () => Promise.reject(new TypeError('private socket detail'))),
    )
    await expect(unavailable('/v1/status', null, config())).rejects.toMatchObject({
      kind: 'failed',
      message: 'The authenticated OpenClaw plugin bridge was unavailable.',
    })
  })

  it('accepts an empty successful GET response without inventing a body', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async () => new Response(null))
    const request = createOpenClawBridgeRequester(fetcher)

    await expect(request('/v1/status', null, config())).resolves.toBe('')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      body: undefined,
      method: 'GET',
    })
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: `Bearer ${'t'.repeat(43)}`,
    })
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
