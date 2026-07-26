import { describe, expect, it, vi } from 'vitest'

import {
  beginModelActivity,
  ModelActivityStreamError,
  modelActivityAcceptHeader,
  readModelActivityPayload,
  updateModelActivity,
} from './model-activity'

function activityResponse(lines: string[], splitAt: number[] = []): Response {
  const encoded = new TextEncoder().encode(`${lines.join('\n')}\n`)
  const boundaries = [...splitAt, encoded.length]
  let start = 0
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      boundaries.forEach((end) => {
        controller.enqueue(encoded.slice(start, end))
        start = end
      })
      controller.close()
    },
  })
  return new Response(body, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  })
}

describe('model reasoning stream', () => {
  it('accumulates reasoning deltas into one labelled trace', () => {
    const initial = beginModelActivity('answer', 1_000)
    const started = updateModelActivity(
      initial,
      { type: 'reasoning', source: 'summary', text: 'Weighing the capacity ' },
      2_000,
    )
    const continued = updateModelActivity(
      started,
      { type: 'reasoning', source: 'summary', text: 'against the people.' },
      2_500,
    )

    expect(initial.reasoning).toBeNull()
    expect(continued.reasoning).toEqual({
      source: 'summary',
      text: 'Weighing the capacity against the people.',
      updatedAt: 2_500,
    })
    expect(continued.lastProviderActivityAt).toBe(2_500)
  })

  it('restarts the trace when the source changes rather than blending the two', () => {
    const summarised = updateModelActivity(
      beginModelActivity('division', 1_000),
      { type: 'reasoning', source: 'summary', text: 'A provider summary.' },
      2_000,
    )
    const switched = updateModelActivity(
      summarised,
      { type: 'reasoning', source: 'raw', text: 'Local model thinking.' },
      3_000,
    )

    expect(switched.reasoning).toEqual({
      source: 'raw',
      text: 'Local model thinking.',
      updatedAt: 3_000,
    })
  })

  it('reads reasoning frames and rejects an unknown source', async () => {
    const events: unknown[] = []
    await readModelActivityPayload(
      activityResponse([
        JSON.stringify({ type: 'reasoning', source: 'raw', text: 'thinking aloud' }),
        JSON.stringify({ type: 'result', data: { ok: true } }),
      ]),
      (event) => { events.push(event) },
    )
    expect(events).toContainEqual({
      type: 'reasoning',
      source: 'raw',
      text: 'thinking aloud',
    })

    await expect(readModelActivityPayload(
      activityResponse([
        JSON.stringify({ type: 'reasoning', source: 'invented', text: 'nope' }),
        JSON.stringify({ type: 'result', data: { ok: true } }),
      ]),
      () => {},
    )).rejects.toThrow(/unknown reasoning source/i)
  })

  it('strips directional overrides that could reorder surrounding text', async () => {
    const events: Array<{ type: string; text?: string }> = []
    await readModelActivityPayload(
      activityResponse([
        JSON.stringify({
          type: 'reasoning',
          source: 'summary',
          text: 'safe\u202etext\u0007here\r\nnext',
        }),
        JSON.stringify({ type: 'result', data: { ok: true } }),
      ]),
      (event) => { events.push(event as { type: string; text?: string }) },
    )

    const reasoning = events.find(({ type }) => type === 'reasoning')
    expect(reasoning?.text).toBe('safetexthere\nnext')
  })
})

describe('model activity state', () => {
  it('tracks phases, heartbeats, provider activity, and completion without duplicates', () => {
    const initial = beginModelActivity('division', 1_000)
    const prepared = updateModelActivity(
      initial,
      { type: 'phase', phase: 'preparing-input' },
      2_000,
    )
    const repeated = updateModelActivity(
      prepared,
      { type: 'phase', phase: 'preparing-input' },
      2_500,
    )
    const active = updateModelActivity(repeated, { type: 'provider_activity' }, 3_000)
    const complete = updateModelActivity(
      active,
      { type: 'phase', phase: 'complete' },
      4_000,
    )

    expect(initial).toMatchObject({
      operation: 'division',
      status: 'active',
      phase: 'request-accepted',
      startedAt: 1_000,
      lastHeartbeatAt: 1_000,
      rationaleNotes: [],
    })
    expect(repeated.history.map((entry) => entry.phase)).toEqual([
      'request-accepted',
      'preparing-input',
    ])
    expect(active).toMatchObject({
      lastHeartbeatAt: 3_000,
      lastProviderActivityAt: 3_000,
    })
    expect(complete.status).toBe('complete')
  })

  it('keeps six normalized, unique public rationale notes and refreshes activity', () => {
    const initial = beginModelActivity('division', 1_000)
    const first = updateModelActivity(
      initial,
      {
        type: 'rationale',
        text: '  I am separating the practical constraints from the desired outcome.  ',
      },
      2_000,
    )
    const duplicate = updateModelActivity(
      first,
      {
        type: 'rationale',
        text: 'I am separating the practical constraints from the desired outcome.',
      },
      3_000,
    )
    const second = updateModelActivity(
      duplicate,
      {
        type: 'rationale',
        text: 'I am checking whether the perspectives remain distinct and concrete.',
      },
      4_000,
    )
    const third = updateModelActivity(
      second,
      {
        type: 'rationale',
        text: 'I am balancing immediate action with the purpose that should be protected.',
      },
      5_000,
    )
    const fourth = updateModelActivity(
      third,
      {
        type: 'rationale',
        text: 'I am preparing the structured facets for WebChess to validate.',
      },
      6_000,
    )
    const fifth = updateModelActivity(
      fourth,
      {
        type: 'rationale',
        text: 'I am testing whether each note stays grounded in the question.',
      },
      7_000,
    )
    const sixth = updateModelActivity(
      fifth,
      {
        type: 'rationale',
        text: 'I am checking the relationships that could alter the recommendation.',
      },
      8_000,
    )
    const seventh = updateModelActivity(
      sixth,
      {
        type: 'rationale',
        text: 'I am finishing with concrete prompts that invite a small experiment.',
      },
      9_000,
    )

    expect(duplicate.rationaleNotes).toEqual(first.rationaleNotes)
    expect(seventh.rationaleNotes.map((note) => note.text)).toEqual([
      'I am checking whether the perspectives remain distinct and concrete.',
      'I am balancing immediate action with the purpose that should be protected.',
      'I am preparing the structured facets for WebChess to validate.',
      'I am testing whether each note stays grounded in the question.',
      'I am checking the relationships that could alter the recommendation.',
      'I am finishing with concrete prompts that invite a small experiment.',
    ])
    expect(seventh).toMatchObject({
      lastHeartbeatAt: 9_000,
      lastProviderActivityAt: 9_000,
    })
  })
})

describe('model activity transport', () => {
  it('requests the streaming format with a JSON fallback', () => {
    expect(modelActivityAcceptHeader()).toBe(
      'application/x-ndjson, application/json',
    )
  })

  it('consumes fragmented UTF-8 events and returns only the terminal result', async () => {
    const onActivity = vi.fn()
    const response = activityResponse([
      JSON.stringify({ type: 'phase', phase: 'awaiting-model' }),
      JSON.stringify({ type: 'provider_activity' }),
      JSON.stringify({
        type: 'rationale',
        text: '  I am comparing the concrete tensions before forming the board.  ',
      }),
      JSON.stringify({ type: 'future-safe-event', hidden: 'must not surface' }),
      JSON.stringify({ type: 'result', data: { answer: 'Careful change ✓' } }),
    ], [1, 7, 19, 41, 83])

    await expect(readModelActivityPayload(response, onActivity)).resolves.toEqual({
      answer: 'Careful change ✓',
    })
    expect(onActivity.mock.calls.map(([event]) => event)).toEqual([
      { type: 'phase', phase: 'awaiting-model' },
      { type: 'provider_activity' },
      {
        type: 'rationale',
        text: 'I am comparing the concrete tensions before forming the board.',
      },
    ])
  })

  it('preserves bounded streamed error metadata', async () => {
    const onActivity = vi.fn()
    const response = activityResponse([
      JSON.stringify({
        type: 'error',
        message: 'The local model timed out.',
        status: 504,
        code: 'timeout',
        prompt: 'Inspectable prompt',
      }),
    ])

    const error = await readModelActivityPayload(response, onActivity)
      .catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(ModelActivityStreamError)
    expect(error).toMatchObject({
      message: 'The local model timed out.',
      status: 504,
      code: 'timeout',
      prompt: 'Inspectable prompt',
    })
    expect(onActivity).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })

  it('keeps ordinary JSON responses compatible', async () => {
    const response = new Response(JSON.stringify({ facets: [1, 2, 3] }), {
      headers: { 'Content-Type': 'application/json' },
    })
    await expect(readModelActivityPayload(response)).resolves.toEqual({
      facets: [1, 2, 3],
    })
  })

  it('accepts a roughly 256 KB result and ignores every event after the terminal result', async () => {
    const onActivity = vi.fn()
    const largeResult = 'x'.repeat(256 * 1_024)
    const response = activityResponse([
      JSON.stringify({ type: 'result', data: { largeResult } }),
      '{not valid trailing json',
      JSON.stringify({
        type: 'rationale',
        text: 'This trailing display note must never enter the activity state.',
      }),
    ])

    await expect(readModelActivityPayload(response, onActivity)).resolves.toEqual({
      largeResult,
    })
    expect(onActivity).not.toHaveBeenCalled()
  })

  it('caps individual NDJSON events and total event count', async () => {
    await expect(readModelActivityPayload(activityResponse([
      JSON.stringify({
        type: 'future-safe-event',
        hidden: 'x'.repeat(512 * 1_024),
      }),
    ]))).rejects.toThrow(/oversized event/i)

    await expect(readModelActivityPayload(activityResponse([
      ...Array.from({ length: 2_049 }, () => JSON.stringify({ type: 'heartbeat' })),
      JSON.stringify({ type: 'result', data: { ok: true } }),
    ]))).rejects.toThrow(/too many events/i)

    await expect(readModelActivityPayload(activityResponse(
      Array.from({ length: 5 }, (_, index) => JSON.stringify({
        type: 'future-safe-event',
        index,
        hidden: 'x'.repeat(450 * 1_024),
      })),
    ))).rejects.toThrow(/size limit/i)
  })

  it('rejects malformed known events and streams without a terminal result', async () => {
    await expect(readModelActivityPayload(activityResponse([
      JSON.stringify({ type: 'phase', phase: 'raw-chain-of-thought' }),
    ]))).rejects.toThrow(/unknown phase/i)

    await expect(readModelActivityPayload(activityResponse([
      JSON.stringify({ type: 'heartbeat' }),
    ]))).rejects.toThrow(/before returning a result/i)
  })

  it('rejects missing, short, or oversized public rationale text', async () => {
    await expect(readModelActivityPayload(activityResponse([
      JSON.stringify({ type: 'rationale' }),
    ]))).rejects.toThrow(/invalid public rationale/i)

    await expect(readModelActivityPayload(activityResponse([
      JSON.stringify({ type: 'rationale', text: 'Too short.' }),
    ]))).rejects.toThrow(/invalid public rationale/i)

    await expect(readModelActivityPayload(activityResponse([
      JSON.stringify({ type: 'rationale', text: 'x'.repeat(221) }),
    ]))).rejects.toThrow(/invalid public rationale/i)

    await expect(readModelActivityPayload(activityResponse([
      JSON.stringify({
        type: 'rationale',
        text: 'This sentence contains a hidden\u202Espoofing control character.',
      }),
    ]))).rejects.toThrow(/invalid public rationale/i)
  })

  it('cancels the response reader after a protocol failure', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{invalid json}\n'))
      },
      cancel,
    })
    const response = new Response(body, {
      headers: { 'Content-Type': 'application/x-ndjson' },
    })

    await expect(readModelActivityPayload(response)).rejects.toThrow(/invalid JSON/i)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('does not deliver stale activity callbacks after the response body aborts', async () => {
    const abortController = new AbortController()
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          `${JSON.stringify({ type: 'phase', phase: 'thinking' })}\n`,
        ))
        abortController.signal.addEventListener('abort', () => {
          controller.error(new DOMException('The operation was aborted.', 'AbortError'))
        }, { once: true })
      },
    })
    const onActivity = vi.fn()
    const pending = readModelActivityPayload(new Response(body, {
      headers: { 'Content-Type': 'application/x-ndjson' },
    }), onActivity)

    await vi.waitFor(() => expect(onActivity).toHaveBeenCalledWith({
      type: 'phase',
      phase: 'thinking',
    }))
    abortController.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(onActivity).toHaveBeenCalledTimes(1)
  })
})
