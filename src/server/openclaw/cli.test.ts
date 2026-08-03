// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import {
  OpenClawCliError,
  parseOpenClawWebSearchEnvelope,
  runOpenClawWebSearch,
  type OpenClawExecutor,
} from './cli'
import type { OpenClawConfig } from './config'

const QUERY = 'current evidence for reversible LLM inference speedups'
const MARKER_ID = '0123456789abcdef'

function config(overrides: Partial<OpenClawConfig> = {}): OpenClawConfig {
  return {
    binary: 'openclaw-research',
    maxOutputBytes: 64 * 1024,
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

describe('Codex Hosted Search CLI adapter', () => {
  it('invokes the explicit local Codex capability with bounded caller config', async () => {
    const signal = new AbortController().signal
    const researchConfig = config({ transport: 'gateway' })
    const execute = vi.fn<OpenClawExecutor>(async () => webSearchEnvelope())

    const result = await runOpenClawWebSearch(QUERY, researchConfig, {
      execute,
      limit: 4,
      maxContentChars: 2_000,
      maxSearchActivities: 3,
      signal,
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]?.[0]).toEqual([
      '--no-color',
      'infer',
      'web',
      'search',
      '--provider',
      'codex',
      '--limit',
      '4',
      '--json',
      '--query',
      QUERY,
    ])
    expect(execute.mock.calls[0]?.[1]).toEqual({
      ...researchConfig,
      transport: 'local',
    })
    expect(execute.mock.calls[0]?.[2]).toEqual({ signal })
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
    const execute = vi.fn<OpenClawExecutor>()
    await expect(runOpenClawWebSearch(' query with padding ', config(), {
      execute,
    })).rejects.toBeInstanceOf(RangeError)
    await expect(runOpenClawWebSearch(QUERY, config(), {
      execute,
      limit: 11,
    })).rejects.toBeInstanceOf(RangeError)
    expect(execute).not.toHaveBeenCalled()
  })
})
