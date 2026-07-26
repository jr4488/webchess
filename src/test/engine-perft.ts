import { MAX_GAME_PLIES, MAX_QUIET_PLIES } from '../constants'
import { MAX_MOVES, generateMoves } from '../lib/engine/movegen'
import {
  BLACK,
  EMPTY,
  KING,
  Position,
  WHITE,
  codeKind,
  moveCaptured,
} from '../lib/engine/position'

export interface PerftState {
  /** Plies already completed before this position. */
  completedPlies?: number
  quietPlies?: number
}

export interface PerftStats {
  /** Leaf positions, including an early terminal leaf. */
  nodes: number
  passes: number
  captures: number
  kingCaptures: number
  moveLimitDraws: number
  quietLimitDraws: number
  noMoveDraws: number
}

function emptyStats(): PerftStats {
  return {
    nodes: 0,
    passes: 0,
    captures: 0,
    kingCaptures: 0,
    moveLimitDraws: 0,
    quietLimitDraws: 0,
    noMoveDraws: 0,
  }
}

function addStats(target: PerftStats, source: PerftStats): void {
  target.nodes += source.nodes
  target.passes += source.passes
  target.captures += source.captures
  target.kingCaptures += source.kingCaptures
  target.moveLimitDraws += source.moveLimitDraws
  target.quietLimitDraws += source.quietLimitDraws
  target.noMoveDraws += source.noMoveDraws
}

/**
 * Counts WebChess game trees, not orthodox-chess trees.
 *
 * A forced pass consumes one ply, direct king capture ends the line, and draw
 * counters stop a line even when the requested depth has not been exhausted.
 * One terminal position counts as one leaf.
 */
export function webChessPerft(
  position: Position,
  depth: number,
  state: PerftState = {},
): PerftStats {
  if (!Number.isInteger(depth) || depth < 0) {
    throw new RangeError(`Perft depth must be a non-negative integer; received ${depth}.`)
  }

  const frames = Array.from(
    { length: Math.max(2, depth + 1) },
    () => new Int32Array(MAX_MOVES),
  )

  return visit(
    position,
    depth,
    0,
    state.completedPlies ?? 0,
    state.quietPlies ?? 0,
    frames,
  )
}

function visit(
  position: Position,
  depth: number,
  frameIndex: number,
  completedPlies: number,
  quietPlies: number,
  frames: readonly Int32Array[],
): PerftStats {
  const result = emptyStats()

  if (depth === 0) {
    result.nodes = 1
    return result
  }

  const moves = frames[frameIndex]!
  const side = position.sideToMove
  const count = generateMoves(position, side, moves)

  if (count === 0) {
    const opponent = side === WHITE ? BLACK : WHITE
    const opponentMoves = frames[frameIndex + 1]!
    if (generateMoves(position, opponent, opponentMoves) === 0) {
      result.nodes = 1
      result.noMoveDraws = 1
      return result
    }
  }

  // This ordering mirrors getGameOutcome: standstill is resolved before the
  // progress counters, and no-progress takes precedence if both limits land on
  // the same completed action.
  if (quietPlies >= MAX_QUIET_PLIES) {
    result.nodes = 1
    result.quietLimitDraws = 1
    return result
  }

  if (completedPlies >= MAX_GAME_PLIES) {
    result.nodes = 1
    result.moveLimitDraws = 1
    return result
  }

  if (count === 0) {
    position.makePass()
    try {
      addStats(
        result,
        visit(
          position,
          depth - 1,
          frameIndex + 1,
          completedPlies + 1,
          quietPlies + 1,
          frames,
        ),
      )
      result.passes += 1
    } finally {
      position.unmakePass()
    }
    return result
  }

  for (let index = 0; index < count; index += 1) {
    const move = moves[index]!
    const captured = moveCaptured(move)
    const capturesKing = captured !== EMPTY && codeKind(captured) === KING

    if (capturesKing) {
      result.nodes += 1
      result.captures += 1
      result.kingCaptures += 1
      continue
    }

    position.make(move)
    try {
      const child = visit(
        position,
        depth - 1,
        frameIndex + 1,
        completedPlies + 1,
        captured === EMPTY ? quietPlies + 1 : 0,
        frames,
      )
      addStats(result, child)
      if (captured !== EMPTY) result.captures += 1
    } finally {
      position.unmake()
    }
  }

  return result
}
