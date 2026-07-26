import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createInitialPieces } from '../game'
import type { EngineRequest, EngineResponse } from './protocol'

type Listener = (event: { data: EngineRequest }) => void

const listeners: Listener[] = []
const posted: EngineResponse[] = []

beforeEach(() => {
  listeners.length = 0
  posted.length = 0

  vi.stubGlobal('self', {
    addEventListener: (type: string, listener: Listener) => {
      if (type === 'message') listeners.push(listener)
    },
    postMessage: (message: EngineResponse) => posted.push(message),
  })
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function loadWorker(): Promise<Listener> {
  await import('./worker')
  const listener = listeners[0]
  if (!listener) throw new Error('The worker did not register a message listener.')
  return listener
}

describe('engine worker', () => {
  it('answers a request with the chosen move, tagged with the request id', async () => {
    const onMessage = await loadWorker()

    onMessage({
      data: { id: 7, pieces: createInitialPieces(), side: 'white', seed: 'w', options: { depth: 1 } },
    })

    expect(posted).toHaveLength(1)
    expect(posted[0]!.id).toBe(7)
    expect(posted[0]!.move?.pieceId).toBeTruthy()
    expect(posted[0]!.analysis).toMatchObject({
      depth: 1,
      score: expect.any(Number),
      elapsedMs: expect.any(Number),
      nps: expect.any(Number),
      ttHits: expect.any(Number),
      principalVariation: expect.any(Array),
      stopReason: 'depth',
    })
    expect(posted[0]!.error).toBeUndefined()
  })

  it('reports no move when the side cannot play', async () => {
    const onMessage = await loadWorker()

    onMessage({ data: { id: 2, pieces: [], side: 'black', seed: 0, options: { depth: 1 } } })

    expect(posted[0]).toMatchObject({
      id: 2,
      move: null,
      analysis: { nodes: 0, depth: 0 },
    })
  })

  it('returns the failure instead of letting the worker die', async () => {
    const onMessage = await loadWorker()

    // A frozen array makes the engine's internal bookkeeping throw.
    const hostile = new Proxy([] as unknown[], {
      get() {
        throw new Error('unreadable position')
      },
    })

    onMessage({
      data: { id: 3, pieces: hostile as never, side: 'white', seed: 0, options: { depth: 1 } },
    })

    expect(posted[0]!.id).toBe(3)
    expect(posted[0]!.move).toBeNull()
    expect(posted[0]!.error).toBe('unreadable position')
  })
})
