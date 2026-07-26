import type { AutoMove, Piece, Side } from '../../types'
import { hashString } from '../problem'
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
import { Search } from './search'

/**
 * How much work one move may cost. Counting nodes rather than milliseconds
 * keeps the choice of depth identical on every machine, so a replay of the same
 * problem still produces the same game on a slow laptop and a fast desktop.
 *
 * Roughly a second of search in a browser. Piece count would be the obvious
 * thing to budget by instead, and it is the wrong one: sectors wrap here, so an
 * emptier board gives rooks and queens more squares, not fewer. Measured, depth
 * six costs 0.6s with three pieces, 7s with eight, and 2.3s with twenty-one.
 */
export const NODE_BUDGET = 1_000_000

/** Always searched in full, however small the budget, so a move always exists. */
const MIN_DEPTH = 2
const MAX_DEPTH = 8

export interface EngineOptions {
  /** Fixes the depth instead of spending the node budget. Used by tests. */
  depth?: number
  /** Game ply of the position, so the search knows the move limit. */
  ply?: number
  /** Non-capturing plies played so far, for the progress limit. */
  quietPlies?: number
  /** Overrides how much work a single move may cost. */
  nodeBudget?: number
}

interface RootCandidate {
  move: number
  score: number
  tie: number
  pieceId: string
  destinationKey: string
}

function normalizeSector(sector: number): number {
  return ((sector % SECTORS) + SECTORS) % SECTORS
}

function coordKeyOf(square: number): string {
  return `${ringOf(square)}:${sectorOf(square)}`
}

/**
 * Searches for the strongest move and returns it in the game's own vocabulary.
 *
 * Ties are broken by a hash of the seed rather than by discovery order, so the
 * same problem text always produces the same game while still varying which of
 * several equally good moves gets played.
 */
export function findBestMove(
  pieces: readonly Piece[],
  side: Side,
  seed: string | number = 0,
  options: EngineOptions = {},
): AutoMove | null {
  return searchBestMove(pieces, side, seed, options).move
}

export interface SearchOutcome {
  move: AutoMove | null
  nodes: number
  /** Depth whose result was actually used. */
  depth: number
}

/** Same search as `findBestMove`, reporting the work it took. */
export function searchBestMove(
  pieces: readonly Piece[],
  side: Side,
  seed: string | number = 0,
  options: EngineOptions = {},
): SearchOutcome {
  const sideCode = side === 'white' ? WHITE : BLACK
  const position = positionFromPieces(pieces, side)
  const rootMoves = new Int32Array(MAX_MOVES)
  const count = generateMoves(position, sideCode, rootMoves)
  if (count === 0) return { move: null, nodes: 0, depth: 0 }

  const bySquare = new Map<number, Piece>()
  for (const piece of pieces) {
    if (!Number.isInteger(piece.position.ring) || !Number.isInteger(piece.position.sector)) continue
    if (piece.position.ring < 0 || piece.position.ring >= 8) continue
    bySquare.set(piece.position.ring * SECTORS + normalizeSector(piece.position.sector), piece)
  }

  const scoreAtDepth = (depth: number, nodeLimit: number): {
    candidates: RootCandidate[]
    nodes: number
    aborted: boolean
  } => {
    const search = new Search(position, {
      depth,
      startPly: options.ply ?? 0,
      startQuietPlies: options.quietPlies ?? 0,
      nodeLimit,
    })

    const found: RootCandidate[] = []
    for (let index = 0; index < count; index += 1) {
      const move = rootMoves[index]!
      const mover = bySquare.get(moveFrom(move))
      if (!mover) continue

      const destinationKey = coordKeyOf(moveTo(move))
      found.push({
        move,
        score: search.scoreRootMove(move),
        tie: hashString(`${String(seed)}/${side}/${mover.id}/${destinationKey}`),
        pieceId: mover.id,
        destinationKey,
      })

      if (search.aborted) break
    }

    return { candidates: found, nodes: search.nodes, aborted: search.aborted }
  }

  let candidates: RootCandidate[]
  let nodes: number
  let usedDepth: number

  if (options.depth !== undefined) {
    const attempt = scoreAtDepth(Math.max(1, options.depth), Number.POSITIVE_INFINITY)
    candidates = attempt.candidates
    nodes = attempt.nodes
    usedDepth = Math.max(1, options.depth)
  } else {
    // The shallowest search runs unbudgeted so there is always a complete
    // result to fall back on; returning nothing would read as "cannot move".
    const baseline = scoreAtDepth(MIN_DEPTH, Number.POSITIVE_INFINITY)
    candidates = baseline.candidates
    nodes = baseline.nodes
    usedDepth = MIN_DEPTH

    // Then deepen while the budget lasts, adopting a depth only once it has
    // finished, so an abandoned iteration leaves the last complete one standing.
    const budget = options.nodeBudget ?? NODE_BUDGET
    for (let depth = MIN_DEPTH + 1; depth <= MAX_DEPTH && nodes < budget; depth += 1) {
      const attempt = scoreAtDepth(depth, budget - nodes)
      nodes += attempt.nodes
      if (attempt.aborted) break

      candidates = attempt.candidates
      usedDepth = depth
    }
  }

  if (candidates.length === 0) return { move: null, nodes, depth: usedDepth }

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.tie - left.tie ||
      left.pieceId.localeCompare(right.pieceId) ||
      left.destinationKey.localeCompare(right.destinationKey),
  )

  const best = candidates[0]!
  const to = moveTo(best.move)
  const captured = bySquare.get(to)

  return {
    move: {
      pieceId: best.pieceId,
      from: {
        ring: ringOf(moveFrom(best.move)),
        sector: sectorOf(moveFrom(best.move)),
      },
      to: { ring: ringOf(to), sector: sectorOf(to) },
      score: best.score,
      ...(captured && captured.side !== side ? { captured } : {}),
    },
    nodes,
    depth: usedDepth,
  }
}
