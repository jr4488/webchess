import type { AutoMove, Piece, Side } from '../types'
import { findBestMove } from './engine'
import type { EngineOptions } from './engine'
import type { EngineRequest, EngineResponse } from './engine/protocol'

export type EngineResult =
  | { status: 'ok'; move: AutoMove | null }
  | { status: 'superseded' }
  | { status: 'failed'; message: string }

export interface AutoPlayEngine {
  chooseMove(
    pieces: readonly Piece[],
    side: Side,
    seed: string | number,
    options?: EngineOptions,
  ): Promise<EngineResult>
  /** Abandons any search in flight, discarding the work immediately. */
  reset(): void
  dispose(): void
}

interface Pending {
  id: number
  settle: (result: EngineResult) => void
}

/**
 * Searching a few plies takes seconds on a full board, which would freeze the
 * board animations if it ran inline. The work goes to a worker where possible,
 * and falls back to the main thread in environments without one — tests, and
 * any browser where the worker fails to start.
 */
export function createAutoPlayEngine(): AutoPlayEngine {
  let worker: Worker | null = null
  let pending: Pending | null = null
  let nextId = 1
  let disposed = false

  function supersede(): void {
    if (!pending) return
    pending.settle({ status: 'superseded' })
    pending = null
  }

  function startWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null

    try {
      const created = new Worker(new URL('./engine/worker.ts', import.meta.url), {
        type: 'module',
      })

      created.addEventListener('message', (event: MessageEvent<EngineResponse>) => {
        const response = event.data
        if (!pending || pending.id !== response.id) return

        const settle = pending.settle
        pending = null
        settle(
          response.error
            ? { status: 'failed', message: response.error }
            : { status: 'ok', move: response.move },
        )
      })

      created.addEventListener('error', () => {
        if (!pending) return
        const settle = pending.settle
        pending = null
        settle({ status: 'failed', message: 'The move engine stopped unexpectedly.' })
      })

      return created
    } catch {
      return null
    }
  }

  function chooseOnMainThread(
    pieces: readonly Piece[],
    side: Side,
    seed: string | number,
    options: EngineOptions | undefined,
    id: number,
  ): Promise<EngineResult> {
    return new Promise((resolve) => {
      // Yielding first lets the pending render flush, so the board shows the
      // previous move before the thread blocks on the search.
      setTimeout(() => {
        if (!pending || pending.id !== id) return

        try {
          const move = findBestMove(pieces, side, seed, options)
          if (!pending || pending.id !== id) return
          pending = null
          resolve({ status: 'ok', move })
        } catch (error) {
          if (!pending || pending.id !== id) return
          pending = null
          resolve({
            status: 'failed',
            message:
              error instanceof Error ? error.message : 'The engine failed to choose a move.',
          })
        }
      }, 0)
    })
  }

  return {
    chooseMove(pieces, side, seed, options) {
      if (disposed) return Promise.resolve({ status: 'superseded' })

      supersede()
      const id = nextId
      nextId += 1

      if (worker === null) worker = startWorker()

      if (worker === null) {
        let settle: (result: EngineResult) => void = () => {}
        const promise = new Promise<EngineResult>((resolve) => {
          settle = resolve
        })
        pending = { id, settle }
        void chooseOnMainThread(pieces, side, seed, options, id).then(settle)
        return promise
      }

      const request: EngineRequest = { id, pieces, side, seed, ...(options ? { options } : {}) }
      return new Promise<EngineResult>((resolve) => {
        pending = { id, settle: resolve }
        worker?.postMessage(request)
      })
    },

    reset() {
      supersede()
      // A search already running cannot be interrupted from outside, so the
      // only way to reclaim the thread promptly is to replace the worker.
      if (worker) {
        worker.terminate()
        worker = null
      }
    },

    dispose() {
      disposed = true
      supersede()
      worker?.terminate()
      worker = null
    },
  }
}
