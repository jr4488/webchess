import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Piece } from '../types'
import { createInitialPieces } from './game'
import { createAutoPlayEngine } from './auto-play'
import type { EngineResponse } from './engine/protocol'

const originalWorker = globalThis.Worker

afterEach(() => {
  vi.useRealTimers()
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
  static postsToFail = 0
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
    if (FakeWorker.postsToFail > 0) {
      FakeWorker.postsToFail -= 1
      throw new DOMException('The request could not be cloned.', 'DataCloneError')
    }
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

  messageError(): void {
    for (const listener of this.listeners.get('messageerror') ?? []) listener({})
  }
}

function useFakeWorker(): typeof FakeWorker {
  FakeWorker.instances = []
  FakeWorker.postsToFail = 0
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

  it('caps the default main-thread search budget', async () => {
    Reflect.deleteProperty(globalThis, 'Worker')
    const engine = createAutoPlayEngine()

    const result = await engine.chooseMove(pieces, 'white', 'bounded-fallback')

    expect(result.status).toBe('ok')
    expect(result.status === 'ok' && result.analysis?.nodes).toBeLessThanOrEqual(20_000)
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
    const analysis = {
      nodes: 42,
      depth: 2,
      score: 12,
      principalVariation: [{ from: move.from, to: move.to }],
      stopReason: 'depth' as const,
    }
    instance.reply({ id: 1, move, analysis })

    expect(await pending).toEqual({ status: 'ok', move, analysis })
    engine.dispose()
  })

  it('terminates a superseded search and ignores events from its worker', async () => {
    const worker = useFakeWorker()
    const engine = createAutoPlayEngine()

    const first = engine.chooseMove(pieces, 'white', 'first', { depth: 2 })
    const replaced = worker.instances[0]!
    const second = engine.chooseMove(pieces, 'white', 'second', { depth: 2 })

    expect(await first).toEqual({ status: 'superseded' })
    expect(replaced.terminated).toBe(true)
    expect(worker.instances).toHaveLength(2)

    const replacement = worker.instances[1]!
    const secondSettled = vi.fn()
    void second.then(secondSettled)
    replaced.reply({ id: 2, move: null })
    replaced.fail()
    replaced.messageError()
    await Promise.resolve()
    expect(secondSettled).not.toHaveBeenCalled()

    replacement.reply({ id: 2, move: null })
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

  it.each([
    ['error', (instance: FakeWorker) => instance.fail()],
    ['messageerror', (instance: FakeWorker) => instance.messageError()],
  ])('retires a worker after %s so the next request starts fresh', async (_, crash) => {
    const worker = useFakeWorker()
    const engine = createAutoPlayEngine()

    const pending = engine.chooseMove(pieces, 'white', 'crash', { depth: 2 })
    const crashed = worker.instances[0]!
    crash(crashed)

    expect((await pending).status).toBe('failed')
    expect(crashed.terminated).toBe(true)

    const next = engine.chooseMove(pieces, 'white', 'after-crash', { depth: 2 })
    expect(worker.instances).toHaveLength(2)
    expect(crashed.posted).toHaveLength(1)
    worker.instances[1]!.reply({ id: 2, move: null })
    expect(await next).toEqual({ status: 'ok', move: null })
    engine.dispose()
  })

  it('retires an idle worker if it crashes before the next request', async () => {
    const worker = useFakeWorker()
    const engine = createAutoPlayEngine()

    const first = engine.chooseMove(pieces, 'white', 'first', { depth: 2 })
    const crashed = worker.instances[0]!
    crashed.reply({ id: 1, move: null })
    await first

    crashed.fail()
    expect(crashed.terminated).toBe(true)

    const next = engine.chooseMove(pieces, 'white', 'after-idle-crash', { depth: 2 })
    expect(worker.instances).toHaveLength(2)
    worker.instances[1]!.reply({ id: 2, move: null })
    expect(await next).toEqual({ status: 'ok', move: null })
    engine.dispose()
  })

  it('replaces the worker on reset so a running search is abandoned', async () => {
    const worker = useFakeWorker()
    const engine = createAutoPlayEngine()

    const pending = engine.chooseMove(pieces, 'white', 'reset', { depth: 2 })
    engine.reset()

    expect(await pending).toEqual({ status: 'superseded' })
    expect(worker.instances[0]!.terminated).toBe(true)

    const next = engine.chooseMove(pieces, 'white', 'after-reset', { depth: 2 })
    expect(worker.instances).toHaveLength(2)
    worker.instances[1]!.reply({ id: 2, move: null })
    expect(await next).toEqual({ status: 'ok', move: null })
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

  it('falls back safely when posting to a worker throws', async () => {
    const worker = useFakeWorker()
    worker.postsToFail = 1
    const engine = createAutoPlayEngine()

    const result = await engine.chooseMove(pieces, 'white', 'uncloneable', { depth: 8 })

    expect(worker.instances[0]!.terminated).toBe(true)
    expect(result.status).toBe('ok')
    expect(result.status === 'ok' && result.analysis?.depth).toBeLessThanOrEqual(2)
    engine.dispose()
  })

  it('times out and retires a worker that never answers', async () => {
    vi.useFakeTimers()
    const worker = useFakeWorker()
    const engine = createAutoPlayEngine()

    const pending = engine.chooseMove(pieces, 'white', 'hung', { depth: 2 })
    const hung = worker.instances[0]!
    await vi.advanceTimersByTimeAsync(30_000)

    expect(await pending).toEqual({
      status: 'failed',
      message: 'The move engine took too long to respond.',
    })
    expect(hung.terminated).toBe(true)
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
