/// <reference lib="webworker" />

import { searchBestMove } from './index'
import type { EngineLineMove } from './index'
import type {
  EngineAnalysis,
  EngineRequest,
  EngineResponse,
  EngineStopReason,
} from './protocol'

const scope = self as unknown as DedicatedWorkerGlobalScope

type SearchDetails = ReturnType<typeof searchBestMove> & {
  elapsedMs?: number
  score?: number
  nps?: number
  ttHits?: number
  principalVariation?: readonly EngineLineMove[]
  stopReason?: unknown
}

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

scope.addEventListener('message', (event: MessageEvent<EngineRequest>) => {
  const request = event.data

  try {
    const result = searchBestMove(request.pieces, request.side, request.seed, request.options)
    const response: EngineResponse = {
      id: request.id,
      move: result.move,
      analysis: analysisFrom(result),
    }
    scope.postMessage(response)
  } catch (error) {
    const response: EngineResponse = {
      id: request.id,
      move: null,
      error: error instanceof Error ? error.message : 'The engine failed to choose a move.',
    }
    scope.postMessage(response)
  }
})
