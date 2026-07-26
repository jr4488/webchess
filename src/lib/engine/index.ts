import type { AutoMove, CellCoord, Piece, Side } from '../../types'
import { MAX_GAME_PLIES, MAX_QUIET_PLIES } from '../../constants'
import { hashString } from '../problem'
import { MATE_SCORE } from './evaluate'
import { MAX_MOVES, generateMoves } from './movegen'
import {
  BLACK,
  SECTORS,
  WHITE,
  moveFrom,
  moveTo,
  positionFromPieces,
  ringOf,
  sectorOf,
} from './position'
import { Search, SearchAborted } from './search'

/**
 * Fixed work, rather than fixed time, keeps a replay deterministic. Engine V2
 * spends this budget across one iterative search so previous depths, the
 * transposition table, and move-ordering knowledge are all reused.
 */
/**
 * The richer V2 evaluator reaches a stable depth-five opening result at this
 * budget in roughly 3–4 seconds on the reference host. Higher fixed budgets
 * remain available to callers that prefer maximum strength over turn latency.
 */
export const NODE_BUDGET = 150_000

const MAX_DEPTH = 12
const ASPIRATION_WINDOW = 50

export interface EngineOptions {
  /** Completes every iterative depth through this one. Primarily used by tests. */
  depth?: number
  /** Number of plies already played before this position. */
  completedPlies?: number
  /**
   * @deprecated One-based move about to be played. Kept temporarily for callers
   * from Engine V1; converted to `completedPlies = ply - 1`.
   */
  ply?: number
  /** Consecutive non-capturing plies played before this position. */
  quietPlies?: number
  /** Overrides deterministic work available for one move. */
  nodeBudget?: number
  /** Optional hard wall-clock safety limit. Omit for reproducible fixed-node play. */
  timeLimitMs?: number
  /** Advanced tuning/testing option for the per-search transposition table. */
  tableEntries?: number
}

export interface EngineLineMove {
  from: CellCoord
  to: CellCoord
}

export interface SearchOutcome {
  move: AutoMove | null
  nodes: number
  /** Deepest fully completed iteration whose result was used. */
  depth: number
  score: number
  elapsedMs: number
  nps: number
  ttHits: number
  principalVariation: readonly EngineLineMove[]
  stopReason: 'depth' | 'nodes' | 'time' | 'no-move' | 'game-over'
}

function normalizeSector(sector: number): number {
  return ((sector % SECTORS) + SECTORS) % SECTORS
}

function coordKeyOf(square: number): string {
  return `${ringOf(square)}:${sectorOf(square)}`
}

export function findBestMove(
  pieces: readonly Piece[],
  side: Side,
  seed: string | number = 0,
  options: EngineOptions = {},
): AutoMove | null {
  return searchBestMove(pieces, side, seed, options).move
}

export function searchBestMove(
  pieces: readonly Piece[],
  side: Side,
  seed: string | number = 0,
  options: EngineOptions = {},
): SearchOutcome {
  const startedAt = performance.now()
  const sideCode = side === 'white' ? WHITE : BLACK
  const completedPlies =
    options.completedPlies ??
    (options.ply === undefined ? 0 : Math.max(0, Math.trunc(options.ply) - 1))
  const quietPlies = Math.max(0, Math.trunc(options.quietPlies ?? 0))

  if (completedPlies >= MAX_GAME_PLIES || quietPlies >= MAX_QUIET_PLIES) {
    return emptyOutcome(startedAt, 'game-over')
  }

  const position = positionFromPieces(pieces, side)
  const rootMoves = new Int32Array(MAX_MOVES)
  const count = generateMoves(position, sideCode, rootMoves, 'all')
  if (count === 0) return emptyOutcome(startedAt, 'no-move')

  const bySquare = new Map<number, Piece>()
  for (const piece of pieces) {
    if (!Number.isInteger(piece.position.ring) || !Number.isInteger(piece.position.sector)) continue
    if (piece.position.ring < 0 || piece.position.ring >= 8) continue
    bySquare.set(piece.position.ring * SECTORS + normalizeSector(piece.position.sector), piece)
  }

  const rootBias = new Map<number, number>()
  for (let index = 0; index < count; index += 1) {
    const move = rootMoves[index]!
    const mover = bySquare.get(moveFrom(move))
    const identity = mover?.id ?? coordKeyOf(moveFrom(move))
    const tie = hashString(`${String(seed)}/${side}/${identity}/${coordKeyOf(moveTo(move))}`)
    rootBias.set(move, tie & 0x000fffff)
  }

  let bestMove = fallbackRootMove(rootMoves, count, rootBias)
  let bestScore = 0
  let completedDepth = 0
  let previousScore = 0
  let packedVariation: number[] = [bestMove]
  let stopReason: SearchOutcome['stopReason'] = 'depth'

  const fixedDepth = options.depth !== undefined
  const targetDepth = fixedDepth
    ? Math.max(1, Math.min(MAX_DEPTH, Math.trunc(options.depth!)))
    : MAX_DEPTH
  const nodeLimit =
    options.nodeBudget !== undefined
      ? Math.max(1, Math.trunc(options.nodeBudget))
      : fixedDepth
        ? Number.POSITIVE_INFINITY
        : NODE_BUDGET

  const search = new Search(position, {
    depth: targetDepth,
    completedPlies,
    startQuietPlies: quietPlies,
    nodeLimit,
    ...(options.timeLimitMs === undefined ? {} : { timeLimitMs: options.timeLimitMs }),
    rootBias,
    ...(options.tableEntries === undefined ? {} : { tableEntries: options.tableEntries }),
  })

  for (let depth = 1; depth <= targetDepth; depth += 1) {
    let alpha = -MATE_SCORE
    let beta = MATE_SCORE
    if (depth >= 3 && Math.abs(previousScore) < MATE_SCORE - 1_000) {
      alpha = Math.max(-MATE_SCORE, previousScore - ASPIRATION_WINDOW)
      beta = Math.min(MATE_SCORE, previousScore + ASPIRATION_WINDOW)
    }

    try {
      let attempt = search.searchRoot(rootMoves, count, depth, alpha, beta, bestMove)
      if (attempt.score <= alpha || attempt.score >= beta) {
        attempt = search.searchRoot(
          rootMoves,
          count,
          depth,
          -MATE_SCORE,
          MATE_SCORE,
          attempt.move,
        )
      }

      bestMove = attempt.move
      bestScore = attempt.score
      previousScore = attempt.score
      completedDepth = depth
      // Snapshot the completed line now. A later, aborted aspiration retry may
      // replace table entries, but must never rewrite the published PV from
      // the last fully completed iteration.
      packedVariation = search.principalVariation(depth)
    } catch (error) {
      if (!(error instanceof SearchAborted)) throw error
      stopReason = error.reason
      break
    }
  }

  if (completedDepth === targetDepth) stopReason = 'depth'
  else if (search.stopReason !== 'complete') stopReason = search.stopReason

  const elapsedMs = performance.now() - startedAt
  const move = autoMoveFromPacked(bestMove, bestScore, side, bySquare)

  return {
    move,
    nodes: search.nodes,
    depth: completedDepth,
    score: bestScore,
    elapsedMs,
    nps: elapsedMs > 0 ? Math.round((search.nodes * 1_000) / elapsedMs) : search.nodes,
    ttHits: search.ttHits,
    principalVariation: packedVariation.map(lineMoveFromPacked),
    stopReason,
  }
}

function fallbackRootMove(
  rootMoves: Int32Array,
  count: number,
  rootBias: ReadonlyMap<number, number>,
): number {
  let selected = rootMoves[0]!
  let selectedBias = rootBias.get(selected) ?? 0
  for (let index = 1; index < count; index += 1) {
    const move = rootMoves[index]!
    const bias = rootBias.get(move) ?? 0
    if (bias > selectedBias) {
      selected = move
      selectedBias = bias
    }
  }
  return selected
}

function autoMoveFromPacked(
  move: number,
  score: number,
  side: Side,
  bySquare: ReadonlyMap<number, Piece>,
): AutoMove | null {
  const mover = bySquare.get(moveFrom(move))
  if (!mover) return null
  const to = moveTo(move)
  const captured = bySquare.get(to)

  return {
    pieceId: mover.id,
    from: {
      ring: ringOf(moveFrom(move)),
      sector: sectorOf(moveFrom(move)),
    },
    to: { ring: ringOf(to), sector: sectorOf(to) },
    score,
    ...(captured && captured.side !== side ? { captured } : {}),
  }
}

function lineMoveFromPacked(move: number): EngineLineMove {
  return {
    from: { ring: ringOf(moveFrom(move)), sector: sectorOf(moveFrom(move)) },
    to: { ring: ringOf(moveTo(move)), sector: sectorOf(moveTo(move)) },
  }
}

function emptyOutcome(
  startedAt: number,
  stopReason: 'no-move' | 'game-over',
): SearchOutcome {
  const elapsedMs = performance.now() - startedAt
  return {
    move: null,
    nodes: 0,
    depth: 0,
    score: 0,
    elapsedMs,
    nps: 0,
    ttHits: 0,
    principalVariation: [],
    stopReason,
  }
}
