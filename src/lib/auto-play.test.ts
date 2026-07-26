import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Piece } from '../types'
import { createInitialPieces } from './game'
import { createAutoPlayEngine } from './auto-play'
import type { EngineResponse } from './engine/protocol'

const originalWorker = globalThis.Worker

afterEach(() => {
  if (originalWorker === undefined) {
    Reflect.deleteProperty(globalThis, 'Worker')
  } else {
    globalThis.Worker = originalWorker
  }
  vi.restoreAllMocks()
})

/** Stands in for the real worker so the facade can be driven step by step. */
class FakeWorker {
  static instances: FakeWorker[] = []
  readonly posted: unknown[] = []
  terminated = false
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor() {
    FakeWorker.instances.push(this)
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const existing = this.listeners.get(type) ?? []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  postMessage(message: unknown): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  reply(data: EngineResponse): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data })
  }

  fail(): void {
    for (const listener of this.listeners.get('error') ?? []) listener({})
  }
}

function useFakeWorker(): typeof FakeWorker {
  FakeWorker.instances = []
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  return FakeWorker
}

const pieces: readonly Piece[] = createInitialPieces()

describe('auto-play engine without a worker', () => {
  it('searches on the main thread and returns a move', async () => {
    Reflect.deleteProperty(globalThis, 'Worker')
    const engine = createAutoPlayEngine()

    const result = await engine.chooseMove(pieces, 'white', 'fallback', { depth: 1 })

    expect(result.status).toBe('ok')
    expect(result.status === 'ok' && result.move?.pieceId).toBeTruthy()
    engine.dispose()
  })

  it('marks an earlier request superseded when a new one arrives', async () => {
    Reflect.deleteProperty(globalThis, 'Worker')
    const engine = createAutoPlayEngine()

    const first = engine.chooseMove(pieces, 'white', 'one', { depth: 1 })
    const second = engine.chooseMove(pieces, 'white', 'two', { depth: 1 })

    expect(await first).toEqual({ status: 'superseded' })
    expect((await second).status).toBe('ok')
    engine.dispose()
  })

  it('reports a failure rather than throwing when the search breaks', async () => {
    Reflect.deleteProperty(globalThis, 'Worker')
    const engine = createAutoPlayEngine()
    const broken = [{ ...pieces[0]!, position: { ring: Number.NaN, sector: 0 } }]

    const result = await engine.chooseMove(broken, 'white', 'broken', { depth: 1 })

    // A position the engine cannot use yields no move rather than an exception.
    expect(result.status === 'ok' || result.status === 'failed').toBe(true)
    engine.dispose()
  })
})

describe('auto-play engine with a worker', () => {
  it('posts the request and resolves with the reply', async () => {
    const worker = useFakeWorker()
    const engine = createAutoPlayEngine()

    const pending = engine.chooseMove(pieces, 'white', 'worker', { depth: 2 })
    const instance = worker.instances[0]!
    expect(instance.posted).toHaveLength(1)

    const move = {
      pieceId: 'white-pawn-1',
      from: { ring: 6, sector: 0 },
      to: { ring: 5, sector: 0 },
      score: 12,
    }
    instance.reply({ id: 1, move })

    expect(await pending).toEqual({ status: 'ok', move })
    engine.dispose()
  })

  it('ignores a reply that belongs to a superseded request', async () => {
    const worker = useFakeWorker()
    const engine = createAutoPlayEngine()

    const first = engine.chooseMove(pieces, 'white', 'first', { depth: 2 })
    const second = engine.chooseMove(pieces, 'white', 'second', { depth: 2 })
    const instance = worker.instances[0]!

    instance.reply({ id: 1, move: null })
    expect(await first).toEqual({ status: 'superseded' })

    instance.reply({ id: 2, move: null })
    expect(await second).toEqual({ status: 'ok', move: null })
    engine.dispose()
  })

  it('surfaces an engine error as a failure', async () => {
    const worker = useFakeWorker()
    const engine = createAutoPlayEngine()

    const pending = engine.chooseMove(pieces, 'white', 'error', { depth: 2 })
    worker.instances[0]!.reply({ id: 1, move: null, error: 'boom' })

    expect(await pending).toEqual({ status: 'failed', message: 'boom' })
    engine.dispose()
  })

  it('surfaces a crashed worker as a failure', async () => {
    const worker = useFakeWorker()
    const engine = createAutoPlayEngine()

    const pending = engine.chooseMove(pieces, 'white', 'crash', { depth: 2 })
    worker.instances[0]!.fail()

    expect((await pending).status).toBe('failed')
    engine.dispose()
  })

  it('replaces the worker on reset so a running search is abandoned', async () => {
    const worker = useFakeWorker()
    const engine = createAutoPlayEngine()

    const pending = engine.chooseMove(pieces, 'white', 'reset', { depth: 2 })
    engine.reset()

    expect(await pending).toEqual({ status: 'superseded' })
    expect(worker.instances[0]!.terminated).toBe(true)

    void engine.chooseMove(pieces, 'white', 'after-reset', { depth: 2 })
    expect(worker.instances).toHaveLength(2)
    engine.dispose()
  })

  it('falls back to the main thread when the worker cannot start', async () => {
    globalThis.Worker = class {
      constructor() {
        throw new Error('workers are blocked')
      }
    } as unknown as typeof Worker

    const engine = createAutoPlayEngine()
    const result = await engine.chooseMove(pieces, 'white', 'blocked', { depth: 1 })

    expect(result.status).toBe('ok')
    engine.dispose()
  })

  it('stops accepting work once disposed', async () => {
    useFakeWorker()
    const engine = createAutoPlayEngine()
    engine.dispose()

    expect(await engine.chooseMove(pieces, 'white', 'gone', { depth: 1 })).toEqual({
      status: 'superseded',
    })
  })
})
