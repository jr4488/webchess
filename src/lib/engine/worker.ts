/// <reference lib="webworker" />

import { findBestMove } from './index'
import type { EngineRequest, EngineResponse } from './protocol'

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.addEventListener('message', (event: MessageEvent<EngineRequest>) => {
  const request = event.data

  try {
    const move = findBestMove(request.pieces, request.side, request.seed, request.options)
    const response: EngineResponse = { id: request.id, move }
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
