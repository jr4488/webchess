import type { AutoMove, Piece, Side } from '../types'
import { searchBestMove } from './engine'
import type { EngineLineMove, EngineOptions } from './engine'
import type {
  EngineAnalysis,
  EngineRequest,
  EngineResponse,
  EngineStopReason,
} from './engine/protocol'

export type EngineResult =
  | { status: 'ok'; move: AutoMove | null; analysis?: EngineAnalysis }
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
  worker: Worker | null
  fallbackTimer: ReturnType<typeof setTimeout> | null
  watchdog: ReturnType<typeof setTimeout> | null
}

type SearchDetails = ReturnType<typeof searchBestMove> & {
  elapsedMs?: number
  score?: number
  nps?: number
  ttHits?: number
  principalVariation?: readonly EngineLineMove[]
  stopReason?: unknown
}

const MAIN_THREAD_NODE_BUDGET = 20_000
const MAIN_THREAD_MAX_DEPTH = 2
const WORKER_TIMEOUT_MS = 30_000
const WORKER_FAILURE_MESSAGE = 'The move engine stopped unexpectedly.'

function engineStopReason(value: unknown): EngineStopReason | undefined {
  if (
    value === 'complete' ||
    value === 'depth' ||
    value === 'nodes' ||
    value === 'time' ||
    value === 'no-move' ||
    value === 'game-over'
  ) {
    return value
  }
  return undefined
}

function analysisFrom(result: ReturnType<typeof searchBestMove>): EngineAnalysis {
  const details = result as SearchDetails
  const stopReason = engineStopReason(details.stopReason)
  return {
    nodes: result.nodes,
    depth: result.depth,
    ...(details.elapsedMs !== undefined ? { elapsedMs: details.elapsedMs } : {}),
    ...(details.score !== undefined ? { score: details.score } : {}),
    ...(details.nps !== undefined ? { nps: details.nps } : {}),
    ...(details.ttHits !== undefined ? { ttHits: details.ttHits } : {}),
    ...(details.principalVariation !== undefined
      ? { principalVariation: details.principalVariation }
      : {}),
    ...(stopReason !== undefined ? { stopReason } : {}),
  }
}

function isEngineAnalysis(value: unknown): value is EngineAnalysis {
  if (typeof value !== 'object' || value === null) return false
  const analysis = value as Partial<EngineAnalysis>
  return (
    typeof analysis.nodes === 'number' &&
    Number.isFinite(analysis.nodes) &&
    typeof analysis.depth === 'number' &&
    Number.isFinite(analysis.depth)
  )
}

function isEngineResponse(value: unknown): value is EngineResponse {
  if (typeof value !== 'object' || value === null) return false
  const response = value as Partial<EngineResponse>
  return (
    typeof response.id === 'number' &&
    Number.isInteger(response.id) &&
    (response.move === null || typeof response.move === 'object') &&
    (response.error === undefined || typeof response.error === 'string') &&
    (response.analysis === undefined || isEngineAnalysis(response.analysis))
  )
}

function mainThreadOptions(options: EngineOptions | undefined): EngineOptions {
  const requestedBudget = options?.nodeBudget
  const nodeBudget =
    typeof requestedBudget === 'number' && Number.isFinite(requestedBudget)
      ? Math.max(1, Math.min(MAIN_THREAD_NODE_BUDGET, Math.floor(requestedBudget)))
      : MAIN_THREAD_NODE_BUDGET
  const normalized: EngineOptions = { ...options, nodeBudget }

  if (options?.depth === undefined) return normalized

  normalized.depth =
    Number.isFinite(options.depth) && options.depth > 0
      ? Math.max(1, Math.min(MAIN_THREAD_MAX_DEPTH, Math.floor(options.depth)))
      : MAIN_THREAD_MAX_DEPTH
  return normalized
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

  function terminate(target: Worker): void {
    try {
      target.terminate()
    } catch {
      // A worker that is already broken is still retired from local state.
    }
  }

  function clearTimers(active: Pending): void {
    if (active.fallbackTimer !== null) {
      clearTimeout(active.fallbackTimer)
      active.fallbackTimer = null
    }
    if (active.watchdog !== null) {
      clearTimeout(active.watchdog)
      active.watchdog = null
    }
  }

  function complete(active: Pending, result: EngineResult): void {
    if (pending !== active) return
    pending = null
    clearTimers(active)
    active.settle(result)
  }

  function supersede(): void {
    const active = pending
    if (!active) return
    pending = null
    clearTimers(active)
    if (active.worker !== null) {
      if (worker === active.worker) worker = null
      terminate(active.worker)
    }
    active.settle({ status: 'superseded' })
  }

  function failWorker(target: Worker, message: string): void {
    // Replaced workers may still have queued events. They must not be allowed
    // to clear or settle the request owned by their replacement.
    if (worker !== target) return

    worker = null
    terminate(target)
    const active = pending
    if (active?.worker === target) complete(active, { status: 'failed', message })
  }

  function startWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null

    let created: Worker | null = null
    try {
      created = new Worker(new URL('./engine/worker.ts', import.meta.url), {
        type: 'module',
      })
      const target = created

      target.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (worker !== target) return

        const response = event.data
        const active = pending
        if (!active || active.worker !== target) return
        if (!isEngineResponse(response) || response.id !== active.id) {
          failWorker(target, 'The move engine returned an invalid response.')
          return
        }

        complete(
          active,
          response.error
            ? { status: 'failed', message: response.error }
            : {
                status: 'ok',
                move: response.move,
                ...(response.analysis ? { analysis: response.analysis } : {}),
              },
        )
      })

      target.addEventListener('error', () => {
        failWorker(target, WORKER_FAILURE_MESSAGE)
      })

      target.addEventListener('messageerror', () => {
        failWorker(target, 'The move engine could not read its result.')
      })

      return target
    } catch {
      if (created !== null) terminate(created)
      return null
    }
  }

  function scheduleOnMainThread(
    active: Pending,
    pieces: readonly Piece[],
    side: Side,
    seed: string | number,
    options: EngineOptions | undefined,
  ): void {
    // Yielding first lets the pending render flush, so the board shows the
    // previous move before the deliberately bounded inline search runs.
    active.fallbackTimer = setTimeout(() => {
      active.fallbackTimer = null
      if (pending !== active) return

      try {
        const result = searchBestMove(pieces, side, seed, mainThreadOptions(options))
        complete(active, {
          status: 'ok',
          move: result.move,
          analysis: analysisFrom(result),
        })
      } catch (error) {
        complete(active, {
          status: 'failed',
          message:
            error instanceof Error ? error.message : 'The engine failed to choose a move.',
        })
      }
    }, 0)
  }

  return {
    chooseMove(pieces, side, seed, options) {
      if (disposed) return Promise.resolve({ status: 'superseded' })

      supersede()
      const id = nextId
      nextId += 1

      return new Promise<EngineResult>((resolve) => {
        const active: Pending = {
          id,
          settle: resolve,
          worker: null,
          fallbackTimer: null,
          watchdog: null,
        }
        pending = active

        if (worker === null) worker = startWorker()
        const target = worker
        if (target === null) {
          scheduleOnMainThread(active, pieces, side, seed, options)
          return
        }

        active.worker = target
        active.watchdog = setTimeout(() => {
          failWorker(target, 'The move engine took too long to respond.')
        }, WORKER_TIMEOUT_MS)

        const request: EngineRequest = {
          id,
          pieces,
          side,
          seed,
          ...(options ? { options } : {}),
        }
        try {
          target.postMessage(request)
        } catch {
          if (pending !== active) return
          clearTimers(active)
          if (worker === target) worker = null
          terminate(target)
          active.worker = null
          scheduleOnMainThread(active, pieces, side, seed, options)
        }
      })
    },

    reset() {
      supersede()
      if (worker) {
        terminate(worker)
        worker = null
      }
    },

    dispose() {
      disposed = true
      supersede()
      if (worker) terminate(worker)
      worker = null
    },
  }
}
