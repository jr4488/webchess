// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import {
  PUBLIC_RATIONALE_INSTRUCTIONS,
  PUBLIC_RATIONALE_MAX_CHARS,
  PUBLIC_RATIONALE_MAX_NOTES,
  streamPublicRationale,
} from './public-rationale.mjs'

function rawStream(events) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event
    },
  }
}

describe('public rationale stream', () => {
  it('emits validated complete public lines live and never forwards reasoning', async () => {
    const privateReasoning = 'PRIVATE chain-of-thought sentinel'
    const seen = []
    let completed = false
    const create = vi.fn().mockResolvedValue(rawStream([
      {
        type: 'response.reasoning_summary_text.delta',
        delta: privateReasoning,
      },
      {
        type: 'response.output_text.delta',
        delta: 'NOTE: Check which standards make the work recognizably yours before expanding its reach.\nNOTE: Compare the ',
      },
      {
        type: 'response.output_text.delta',
        delta: 'pressure to grow with the boundaries that protect quality.\n',
      },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          incomplete_details: null,
          privateReasoning,
        },
      },
    ]))
    const onRationale = vi.fn((text) => {
      expect(completed).toBe(false)
      seen.push(text)
    })
    const onProgress = vi.fn()
    const requestOptions = { timeout: 42_000, maxRetries: 0 }

    const result = await streamPublicRationale({
      client: { responses: { create } },
      model: 'qwen3.6:27b',
      operation: 'division',
      subject: '{"player_problem":"How should this grow?"}',
      requestOptions,
      onRationale,
      onProgress,
    })
    completed = true

    expect(result).toEqual(seen)
    expect(seen).toEqual([
      'Check which standards make the work recognizably yours before expanding its reach.',
      'Compare the pressure to grow with the boundaries that protect quality.',
    ])
    expect(JSON.stringify(seen)).not.toContain(privateReasoning)
    expect(onProgress).toHaveBeenCalledWith({ phase: 'public-rationale' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'qwen3.6:27b',
      reasoning: { effort: 'none' },
      instructions: PUBLIC_RATIONALE_INSTRUCTIONS,
      temperature: 0.2,
      stream: true,
    }), {
      ...requestOptions,
      timeout: 20_000,
    })
  })

  it('caps, normalizes, and deduplicates notes while ignoring other output', async () => {
    const valid = Array.from(
      { length: PUBLIC_RATIONALE_MAX_NOTES + 2 },
      (_, index) => `NOTE: Consider distinct evidence source number ${index + 1} before treating the current assumption as settled.`,
    )
    const create = vi.fn().mockResolvedValue(rawStream([
      {
        type: 'response.output_text.delta',
        delta: [
          'This line has no public framing.',
          valid[0],
          `NOTE:   ${valid[0].slice(6).toUpperCase()}   `,
          'NOTE: Too short.',
          `NOTE: ${'x'.repeat(PUBLIC_RATIONALE_MAX_CHARS + 1)}`,
          ...valid.slice(1),
        ].join('\n'),
      },
      {
        type: 'response.completed',
        response: { status: 'completed', incomplete_details: null },
      },
    ]))
    const onRationale = vi.fn()

    const notes = await streamPublicRationale({
      client: { responses: { create } },
      model: 'qwen3.6:27b',
      operation: 'answer',
      subject: '{"player_problem":"A bounded question"}',
      onRationale,
    })

    expect(notes).toHaveLength(PUBLIC_RATIONALE_MAX_NOTES)
    expect(onRationale).toHaveBeenCalledTimes(PUBLIC_RATIONALE_MAX_NOTES)
    expect(notes.every((note) => note.length <= PUBLIC_RATIONALE_MAX_CHARS))
      .toBe(true)
  })

  it('fails closed on incomplete or unbounded streams', async () => {
    const incomplete = {
      responses: {
        create: vi.fn().mockResolvedValue(rawStream([
          {
            type: 'response.output_text.delta',
            delta: 'NOTE: This complete public note arrives before an interrupted provider stream.\n',
          },
        ])),
      },
    }
    await expect(streamPublicRationale({
      client: incomplete,
      model: 'qwen3.6:27b',
      operation: 'division',
      subject: 'A bounded subject',
      onRationale: vi.fn(),
    })).rejects.toThrow(/before completion/u)

    const oversized = {
      responses: {
        create: vi.fn().mockResolvedValue(rawStream([
          {
            type: 'response.output_text.delta',
            delta: 'x'.repeat(4_097),
          },
        ])),
      },
    }
    await expect(streamPublicRationale({
      client: oversized,
      model: 'qwen3.6:27b',
      operation: 'division',
      subject: 'A bounded subject',
      onRationale: vi.fn(),
    })).rejects.toThrow(/buffer limit/u)
  })
})
