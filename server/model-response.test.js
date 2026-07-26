import { describe, expect, it, vi } from 'vitest'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'

import {
  MODEL_RESPONSE_PHASES,
  runParsedModelResponse,
} from './model-response.mjs'

function streamingClient(events, finalValue, hooks = {}) {
  const finalResponse = vi.fn().mockResolvedValue(finalValue)
  const streamResult = {
    async *[Symbol.asyncIterator]() {
      for (const entry of events) {
        if (entry.at !== undefined) {
          hooks.setNow?.(entry.at)
        }
        yield entry.event
      }
    },
    finalResponse,
  }
  return {
    client: {
      responses: {
        parse: vi.fn(),
        stream: vi.fn().mockReturnValue(streamResult),
      },
    },
    finalResponse,
  }
}

describe('runParsedModelResponse', () => {
  it('uses the raw event stream and parses its completed response without exposing deltas', async () => {
    const sentinelReasoning = 'PRIVATE reasoning must remain server-side'
    const create = vi.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'response.reasoning_summary_text.delta',
          delta: sentinelReasoning,
        }
        yield {
          type: 'response.output_text.delta',
          delta: '{"ok":true}',
        }
        yield {
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [{
              type: 'message',
              content: [{
                type: 'output_text',
                text: '{"ok":true}',
              }],
            }],
          },
        }
      },
    })
    const parse = vi.fn()
    const stream = vi.fn()
    const client = { responses: { create, parse, stream } }
    const progress = []
    const input = {
      model: 'qwen3.6:27b',
      text: {
        format: zodTextFormat(z.object({ ok: z.boolean() }), 'probe'),
      },
    }
    const requestOptions = { timeout: 600_000, maxRetries: 0 }

    const result = await runParsedModelResponse({
      client,
      input,
      requestOptions,
      onProgress(event) {
        progress.push(event)
      },
    })

    expect(create).toHaveBeenCalledWith(
      { ...input, stream: true },
      requestOptions,
    )
    expect(stream).not.toHaveBeenCalled()
    expect(parse).not.toHaveBeenCalled()
    expect(result.output_parsed).toEqual({ ok: true })
    expect(progress.map(({ phase }) => phase)).toEqual([
      'connecting',
      'thinking',
      'drafting',
      'validating',
    ])
    expect(JSON.stringify(progress)).not.toContain(sentinelReasoning)
    expect(JSON.stringify(progress)).not.toContain('{"ok":true}')
  })

  it('publishes only bounded phases and returns the strictly parsed final response', async () => {
    let clock = 0
    const sentinelReasoning = 'PRIVATE chain of thought must never leave the server'
    const sentinelDraft = '{"facets":[{"secret":"UNVALIDATED OUTPUT"}]}'
    const parsed = {
      status: 'completed',
      output_parsed: { facets: [{ id: 1 }] },
    }
    const { client, finalResponse } = streamingClient([
      {
        at: 100,
        event: {
          type: 'response.reasoning_summary_text.delta',
          delta: sentinelReasoning,
        },
      },
      {
        at: 500,
        event: {
          type: 'response.reasoning_summary_text.delta',
          delta: `${sentinelReasoning} again`,
        },
      },
      {
        at: 1_200,
        event: {
          type: 'response.reasoning_text.delta',
          delta: sentinelReasoning,
        },
      },
      {
        at: 1_300,
        event: {
          type: 'response.output_text.delta',
          delta: sentinelDraft,
        },
      },
      {
        at: 1_600,
        event: {
          type: 'response.completed',
          response: {
            output: sentinelDraft,
            private_reasoning: sentinelReasoning,
          },
        },
      },
    ], parsed, {
      setNow(value) {
        clock = value
      },
    })
    const progress = []
    const input = { model: 'qwen3.6:27b', text: { format: { type: 'json_schema' } } }
    const requestOptions = { timeout: 600_000, signal: new AbortController().signal }

    const result = await runParsedModelResponse({
      client,
      input,
      requestOptions,
      onProgress(event) {
        progress.push(event)
      },
      now: () => clock,
    })

    expect(result).toBe(parsed)
    expect(client.responses.stream).toHaveBeenCalledWith(input, requestOptions)
    expect(client.responses.parse).not.toHaveBeenCalled()
    expect(finalResponse).toHaveBeenCalledOnce()
    expect(progress).toEqual([
      { phase: 'connecting', elapsedMs: 0, activityCount: 0 },
      { phase: 'thinking', elapsedMs: 100, activityCount: 1 },
      { phase: 'thinking', elapsedMs: 1_200, activityCount: 3 },
      { phase: 'drafting', elapsedMs: 1_300, activityCount: 4 },
      { phase: 'validating', elapsedMs: 1_600, activityCount: 4 },
    ])
    expect(JSON.stringify(progress)).not.toContain(sentinelReasoning)
    expect(JSON.stringify(progress)).not.toContain(sentinelDraft)
    expect(Object.keys(progress[0])).toEqual([
      'phase',
      'elapsedMs',
      'activityCount',
    ])
  })

  it('uses parse directly, with unchanged options, when progress is not requested', async () => {
    const parsed = { status: 'completed', output_parsed: { answer: 'bounded' } }
    const parse = vi.fn().mockResolvedValue(parsed)
    const stream = vi.fn()
    const client = { responses: { parse, stream } }
    const input = { model: 'provider-neutral' }
    const requestOptions = { timeout: 42_000, maxRetries: 0 }

    await expect(runParsedModelResponse({
      client,
      input,
      requestOptions,
    })).resolves.toBe(parsed)

    expect(parse).toHaveBeenCalledWith(input, requestOptions)
    expect(stream).not.toHaveBeenCalled()
  })

  it('keeps parse-only providers working with generic progress', async () => {
    const parsed = { status: 'completed', output_parsed: { answer: 'bounded' } }
    const parse = vi.fn().mockResolvedValue(parsed)
    const progress = []
    let clock = 25

    const result = await runParsedModelResponse({
      client: { responses: { parse } },
      input: { model: 'parse-only' },
      onProgress(event) {
        progress.push(event)
      },
      now: () => clock++,
    })

    expect(result).toBe(parsed)
    expect(progress.map(({ phase }) => phase)).toEqual([
      'connecting',
      'validating',
    ])
    expect(progress.every((event) =>
      Object.keys(event).every((key) =>
        ['phase', 'elapsedMs', 'activityCount'].includes(key),
      ),
    )).toBe(true)
  })

  it('does not manufacture a final result when finalResponse rejects', async () => {
    const providerError = new Error('structured response was incomplete')
    const { client, finalResponse } = streamingClient([
      {
        event: {
          type: 'response.output_text.delta',
          delta: '{"unfinished":',
        },
      },
    ], null)
    finalResponse.mockRejectedValue(providerError)
    const phases = []

    await expect(runParsedModelResponse({
      client,
      input: { model: 'qwen3.6:27b' },
      onProgress(event) {
        phases.push(event.phase)
      },
    })).rejects.toBe(providerError)

    expect(phases).toEqual(['connecting', 'drafting', 'validating'])
  })

  it('ignores provider event objects that are not approved activity signals', async () => {
    const parsed = { status: 'completed', output_parsed: { answer: 'safe' } }
    const { client } = streamingClient([
      {
        event: {
          type: 'provider.private.trace',
          delta: 'do not expose me',
          instructions: 'also private',
        },
      },
      {
        event: {
          type: 'response.created',
          response: { instructions: 'trusted server prompt' },
        },
      },
    ], parsed)
    const progress = []

    await runParsedModelResponse({
      client,
      input: {},
      onProgress(event) {
        progress.push(event)
      },
    })

    expect(progress.map(({ phase }) => phase)).toEqual([
      'connecting',
      'validating',
    ])
    expect(JSON.stringify(progress)).not.toContain('private')
    expect(JSON.stringify(progress)).not.toContain('trusted server prompt')
  })

  it('validates collaborators and the activity interval', async () => {
    const client = { responses: { parse: vi.fn() } }

    expect(MODEL_RESPONSE_PHASES).toEqual([
      'connecting',
      'thinking',
      'drafting',
      'validating',
    ])
    expect(Object.isFrozen(MODEL_RESPONSE_PHASES)).toBe(true)
    await expect(runParsedModelResponse({ client, onProgress: true }))
      .rejects.toThrow(/onProgress must be a function/u)
    await expect(runParsedModelResponse({
      client,
      onProgress: vi.fn(),
      activityIntervalMs: -1,
    })).rejects.toThrow(/activityIntervalMs/u)
    await expect(runParsedModelResponse({
      client,
      onProgress: vi.fn(),
      now: 123,
    })).rejects.toThrow(/now must be a function/u)
  })
})
