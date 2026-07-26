import { MAX_GAME_PLIES, MAX_QUIET_PLIES } from '../../constants'
import { MATE_SCORE, VALUES, captureOrderScore, evaluateBoard } from './evaluate'
import { MAX_MOVES, generateMoves, isAttacked } from './movegen'
import {
  BLACK,
  EMPTY,
  KING,
  Position,
  WHITE,
  codeKind,
  codeSide,
  moveCaptured,
  moveFrom,
  moveIsPromotion,
  moveTo,
} from './position'
import {
  TT_EXACT,
  TT_LOWER_BOUND,
  TT_UPPER_BOUND,
  TranspositionTable,
} from './transposition'

const MAX_QUIESCENCE_PLIES = 64
const MAX_SEARCH_PLIES = 96
const MATE_TT_THRESHOLD = MATE_SCORE - MAX_SEARCH_PLIES
const TIME_CHECK_INTERVAL = 1_024
const NO_MOVE = -1
const PASS_MOVE = -2

export type SearchStopReason = 'complete' | 'nodes' | 'time'

export interface SearchLimits {
  /** Deepest normal-search ply to complete. */
  depth: number
  /** Plies already completed before the root position. */
  completedPlies: number
  /** Consecutive non-capturing plies before the root. */
  startQuietPlies: number
  /** Whole-search node ceiling, shared by every iterative depth. */
  nodeLimit?: number
  /** Optional wall-clock safety ceiling. Fixed-node replay leaves this unset. */
  timeLimitMs?: number
  /** Root-only deterministic ordering bias used to choose reproducible ties. */
  rootBias?: ReadonlyMap<number, number>
  /** Transposition-table capacity; rounded up to a power of two. */
  tableEntries?: number
}

export interface RootSearchResult {
  move: number
  score: number
}

interface Frame {
  moves: Int32Array
  scores: Int32Array
}

function createFrames(): Frame[] {
  return Array.from({ length: MAX_SEARCH_PLIES }, () => ({
    moves: new Int32Array(MAX_MOVES),
    scores: new Int32Array(MAX_MOVES),
  }))
}

export class SearchAborted extends Error {
  readonly reason: Exclude<SearchStopReason, 'complete'>

  constructor(reason: Exclude<SearchStopReason, 'complete'>) {
    super(`Search stopped at its ${reason} limit.`)
    this.name = 'SearchAborted'
    this.reason = reason
  }
}

/**
 * Purpose-built search for the WebChess cylinder.
 *
 * The rules are deliberately not orthodox chess: Kings are captured, a side
 * with no move passes, and both quiet-ply and total-ply draw counters are part
 * of the position value. Iterative deepening is driven by the caller, while one
 * Search instance keeps its table, history, killers, and node budget across all
 * completed depths.
 */
export class Search {
  private readonly frames = createFrames()
  private readonly position: Position
  private readonly limits: SearchLimits
  private readonly nodeLimit: number
  private readonly deadline: number
  private readonly table: TranspositionTable
  private readonly history = new Int32Array(2 * 64 * 64)
  private readonly killers = new Int32Array(MAX_SEARCH_PLIES * 2)

  nodes = 0
  ttHits = 0
  stopReason: SearchStopReason = 'complete'

  constructor(position: Position, limits: SearchLimits) {
    this.position = position
    this.limits = limits
    this.nodeLimit = limits.nodeLimit ?? Number.POSITIVE_INFINITY
    this.deadline =
      limits.timeLimitMs === undefined
        ? Number.POSITIVE_INFINITY
        : performance.now() + Math.max(1, limits.timeLimitMs)
    this.table = new TranspositionTable(limits.tableEntries)
  }

  searchRoot(
    rootMoves: Int32Array,
    count: number,
    depth: number,
    alpha: number,
    beta: number,
    preferredMove = 0,
  ): RootSearchResult {
    this.visitNode()

    const frame = this.frames[0]!
    frame.moves.set(rootMoves.subarray(0, count), 0)
    this.orderMoves(frame, count, 0, preferredMove)

    const originalAlpha = alpha
    const originalBeta = beta
    let best = -MATE_SCORE - 1
    let bestMove = frame.moves[0] ?? NO_MOVE
    let searched = 0

    for (let index = 0; index < count; index += 1) {
      const move = selectNext(frame, count, index)
      let score: number

      if (isKingCapture(move)) {
        score = MATE_SCORE
      } else {
        this.position.make(move)
        try {
          const nextQuiet = nextQuietPlies(this.limits.startQuietPlies, move)
          if (searched === 0) {
            score = negateScore(this.negamax(depth - 1, 1, -beta, -alpha, nextQuiet))
          } else {
            score = negateScore(
              this.negamax(depth - 1, 1, -alpha - 1, -alpha, nextQuiet),
            )
            if (score > alpha && score < beta) {
              score = negateScore(
                this.negamax(depth - 1, 1, -beta, -alpha, nextQuiet),
              )
            }
          }
        } finally {
          this.position.unmake()
        }
      }

      searched += 1
      if (score > best) {
        best = score
        bestMove = move
      }
      if (score > alpha) alpha = score
      if (alpha >= beta) break
    }

    const flag =
      best <= originalAlpha
        ? TT_UPPER_BOUND
        : best >= originalBeta
          ? TT_LOWER_BOUND
          : TT_EXACT
    this.store(depth, 0, this.limits.startQuietPlies, best, flag, bestMove)
    return { move: bestMove, score: best }
  }

  principalVariation(maxDepth: number): number[] {
    const result: number[] = []
    let quietPlies = this.limits.startQuietPlies
    const madePasses: boolean[] = []

    try {
      for (let ply = 0; ply < maxDepth; ply += 1) {
        if (this.isDraw(ply, quietPlies)) break
        const entry = this.probe(ply, quietPlies)
        const move = entry?.bestMove ?? NO_MOVE
        if (move === NO_MOVE) break

        if (move === PASS_MOVE) {
          if (!this.isForcedPass(ply)) break
          this.position.makePass()
          madePasses.push(true)
          quietPlies += 1
          continue
        }

        if (!this.isGeneratedMove(move, ply)) break

        result.push(move)
        if (isKingCapture(move)) break
        this.position.make(move)
        madePasses.push(false)
        quietPlies = nextQuietPlies(quietPlies, move)
      }
    } finally {
      while (madePasses.length > 0) {
        if (madePasses.pop()) this.position.unmakePass()
        else this.position.unmake()
      }
    }

    return result
  }

  private negamax(
    depth: number,
    ply: number,
    alpha: number,
    beta: number,
    quietPlies: number,
  ): number {
    this.visitNode()
    if (this.isDraw(ply, quietPlies)) return 0
    if (depth <= 0) return this.quiesce(alpha, beta, ply, 0, quietPlies)

    const entry = this.probe(ply, quietPlies)
    const tableMove = entry?.bestMove ?? NO_MOVE

    if (entry && entry.depth >= depth) {
      this.ttHits += 1
      const tableScore = scoreFromTable(entry.score, ply)
      if (entry.flag === TT_EXACT) return tableScore
      if (entry.flag === TT_LOWER_BOUND) alpha = Math.max(alpha, tableScore)
      else if (entry.flag === TT_UPPER_BOUND) beta = Math.min(beta, tableScore)
      if (alpha >= beta) return tableScore
    }

    // A transposition-table bound may narrow the caller's window. Classify the
    // result against the effective window actually searched, otherwise a
    // cutoff against a tightened bound can be stored incorrectly as exact.
    const windowAlpha = alpha
    const windowBeta = beta
    const side = this.position.sideToMove
    const frame = this.frameAt(ply)
    const count = generateMoves(this.position, side, frame.moves)
    if (count === 0) {
      return this.searchPass(
        depth,
        ply,
        alpha,
        beta,
        quietPlies,
        windowAlpha,
        windowBeta,
      )
    }

    if (entry && entry.depth < depth) this.ttHits += 1
    this.orderMoves(frame, count, ply, tableMove)

    let best = -MATE_SCORE - 1
    let bestMove = NO_MOVE
    let searched = 0

    for (let index = 0; index < count; index += 1) {
      const move = selectNext(frame, count, index)
      let score: number

      if (isKingCapture(move)) {
        score = MATE_SCORE - ply
      } else {
        this.position.make(move)
        try {
          const nextQuiet = nextQuietPlies(quietPlies, move)
          if (searched === 0) {
            score = negateScore(
              this.negamax(depth - 1, ply + 1, -beta, -alpha, nextQuiet),
            )
          } else {
            score = negateScore(
              this.negamax(depth - 1, ply + 1, -alpha - 1, -alpha, nextQuiet),
            )
            if (score > alpha && score < beta) {
              score = negateScore(
                this.negamax(depth - 1, ply + 1, -beta, -alpha, nextQuiet),
              )
            }
          }
        } finally {
          this.position.unmake()
        }
      }

      searched += 1
      if (score > best) {
        best = score
        bestMove = move
      }
      if (score > alpha) alpha = score

      if (alpha >= beta) {
        if (moveCaptured(move) === EMPTY && !moveIsPromotion(move)) {
          this.recordQuietCutoff(side, move, depth, ply)
        }
        break
      }
    }

    const flag =
      best <= windowAlpha
        ? TT_UPPER_BOUND
        : best >= windowBeta
          ? TT_LOWER_BOUND
          : TT_EXACT
    this.store(depth, ply, quietPlies, best, flag, bestMove)
    return best
  }

  private searchPass(
    depth: number,
    ply: number,
    alpha: number,
    beta: number,
    quietPlies: number,
    windowAlpha: number,
    windowBeta: number,
  ): number {
    const opponent = otherSide(this.position.sideToMove)
    const frame = this.frameAt(ply)
    const opponentCount = generateMoves(this.position, opponent, frame.moves)
    let score: number
    let bestMove = PASS_MOVE

    if (opponentCount === 0) {
      score = 0
      bestMove = NO_MOVE
    } else if (
      quietPlies + 1 >= MAX_QUIET_PLIES ||
      this.limits.completedPlies + ply + 1 >= MAX_GAME_PLIES
    ) {
      score = 0
    } else {
      this.position.makePass()
      try {
        score = negateScore(
          this.negamax(depth - 1, ply + 1, -beta, -alpha, quietPlies + 1),
        )
      } finally {
        this.position.unmakePass()
      }
    }

    const flag =
      score <= windowAlpha
        ? TT_UPPER_BOUND
        : score >= windowBeta
          ? TT_LOWER_BOUND
          : TT_EXACT
    this.store(depth, ply, quietPlies, score, flag, bestMove)
    return score
  }

  private quiesce(
    alpha: number,
    beta: number,
    ply: number,
    extension: number,
    quietPlies: number,
  ): number {
    this.visitNode()
    if (this.isDraw(ply, quietPlies)) return 0

    const side = this.position.sideToMove
    const opponent = otherSide(side)
    const frame = this.frameAt(ply)
    const count = generateMoves(this.position, side, frame.moves, 'all')

    if (count === 0) {
      if (generateMoves(this.position, opponent, frame.moves, 'all') === 0) return 0
      if (
        quietPlies + 1 >= MAX_QUIET_PLIES ||
        this.limits.completedPlies + ply + 1 >= MAX_GAME_PLIES
      ) {
        return 0
      }
      if (extension >= MAX_QUIESCENCE_PLIES) return evaluateForSide(this.position, side)

      this.position.makePass()
      try {
        return negateScore(
          this.quiesce(
            -beta,
            -alpha,
            ply + 1,
            extension + 1,
            quietPlies + 1,
          ),
        )
      } finally {
        this.position.unmakePass()
      }
    }

    // Action 256 is legal. Capturing the King on it wins; every other action
    // reaches the total-ply draw immediately afterward.
    if (this.limits.completedPlies + ply === MAX_GAME_PLIES - 1) {
      for (let index = 0; index < count; index += 1) {
        if (isKingCapture(frame.moves[index]!)) return MATE_SCORE - ply
      }
      return 0
    }

    const kingSquare = findKing(this.position.board, side)
    const kingThreatened =
      kingSquare >= 0 && isAttacked(this.position.board, kingSquare, opponent)
    const standPat = evaluateForSide(this.position, side)
    const quietBoundary = quietPlies === MAX_QUIET_PLIES - 1
    let best = kingThreatened ? -MATE_SCORE + ply : standPat

    if (quietBoundary) {
      // Any legal quiet action claims the no-progress draw. Captures still
      // reset the counter and must be searched.
      best = hasQuietMove(frame.moves, count) ? 0 : -MATE_SCORE + ply
      if (best >= beta) return best
      if (best > alpha) alpha = best
    } else if (!kingThreatened) {
      if (standPat >= beta) return standPat
      if (standPat > alpha) alpha = standPat
    }
    if (extension >= MAX_QUIESCENCE_PLIES) return best

    this.orderMoves(frame, count, ply, NO_MOVE)

    for (let index = 0; index < count; index += 1) {
      const move = selectNext(frame, count, index)
      const captured = moveCaptured(move)
      if (quietBoundary && captured === EMPTY) continue
      if (
        !quietBoundary &&
        !kingThreatened &&
        captured === EMPTY &&
        !moveIsPromotion(move)
      ) {
        continue
      }
      if (isKingCapture(move)) return MATE_SCORE - ply

      this.position.make(move)
      try {
        const score = negateScore(
          this.quiesce(
            -beta,
            -alpha,
            ply + 1,
            extension + 1,
            nextQuietPlies(quietPlies, move),
          ),
        )
        if (score > best) best = score
        if (score > alpha) alpha = score
        if (alpha >= beta) break
      } finally {
        this.position.unmake()
      }
    }

    return Math.max(best, alpha)
  }

  private orderMoves(frame: Frame, count: number, ply: number, preferredMove: number): void {
    const side = this.position.sideToMove
    const killerIndex = Math.min(ply, MAX_SEARCH_PLIES - 1) * 2
    const firstKiller = this.killers[killerIndex]!
    const secondKiller = this.killers[killerIndex + 1]!

    for (let index = 0; index < count; index += 1) {
      const move = frame.moves[index]!
      const captured = moveCaptured(move)
      let score: number

      if (move === preferredMove) {
        score = 2_000_000_000
      } else if (captured !== EMPTY && codeKind(captured) === KING) {
        score = 1_900_000_000
      } else if (captured !== EMPTY) {
        score =
          1_000_000_000 +
          VALUES[codeKind(captured)]! * 1_024 +
          captureOrderScore(this.position.board, move)
      } else if (moveIsPromotion(move)) {
        score = 900_000_000
      } else if (move === firstKiller) {
        score = 800_000_000
      } else if (move === secondKiller) {
        score = 799_000_000
      } else {
        score = this.history[historyIndex(side, move)]!
      }

      if (ply === 0) score += this.limits.rootBias?.get(move) ?? 0
      frame.scores[index] = score
    }
  }

  private recordQuietCutoff(side: number, move: number, depth: number, ply: number): void {
    const killerIndex = Math.min(ply, MAX_SEARCH_PLIES - 1) * 2
    if (this.killers[killerIndex] !== move) {
      this.killers[killerIndex + 1] = this.killers[killerIndex]!
      this.killers[killerIndex] = move
    }

    const index = historyIndex(side, move)
    const next = this.history[index]! + depth * depth
    this.history[index] = next
    if (next > 1_000_000) {
      for (let slot = 0; slot < this.history.length; slot += 1) {
        this.history[slot] = (this.history[slot]! / 2) | 0
      }
    }
  }

  private probe(ply: number, quietPlies: number) {
    const remaining = Math.max(0, MAX_GAME_PLIES - (this.limits.completedPlies + ply))
    return this.table.probe(
      this.position.hashLow,
      this.position.hashHigh,
      quietPlies,
      remaining,
    )
  }

  private store(
    depth: number,
    ply: number,
    quietPlies: number,
    score: number,
    flag: typeof TT_EXACT | typeof TT_LOWER_BOUND | typeof TT_UPPER_BOUND,
    bestMove: number,
  ): void {
    const remaining = Math.max(0, MAX_GAME_PLIES - (this.limits.completedPlies + ply))
    this.table.store(
      this.position.hashLow,
      this.position.hashHigh,
      quietPlies,
      remaining,
      {
        depth,
        score: scoreToTable(score, ply),
        flag,
        bestMove,
      },
    )
  }

  private isGeneratedMove(move: number, ply: number): boolean {
    const frame = this.frameAt(ply)
    const count = generateMoves(this.position, this.position.sideToMove, frame.moves, 'all')
    for (let index = 0; index < count; index += 1) {
      if (frame.moves[index] === move) return true
    }
    return false
  }

  private isForcedPass(ply: number): boolean {
    const frame = this.frameAt(ply)
    if (generateMoves(this.position, this.position.sideToMove, frame.moves, 'all') > 0) {
      return false
    }
    return (
      generateMoves(
        this.position,
        otherSide(this.position.sideToMove),
        frame.moves,
        'all',
      ) > 0
    )
  }

  private isDraw(ply: number, quietPlies: number): boolean {
    return (
      quietPlies >= MAX_QUIET_PLIES ||
      this.limits.completedPlies + ply >= MAX_GAME_PLIES
    )
  }

  private visitNode(): void {
    if (this.nodes >= this.nodeLimit) {
      this.stopReason = 'nodes'
      throw new SearchAborted('nodes')
    }
    this.nodes += 1

    if (
      Number.isFinite(this.deadline) &&
      (this.nodes === 1 || this.nodes % TIME_CHECK_INTERVAL === 0) &&
      performance.now() >= this.deadline
    ) {
      this.stopReason = 'time'
      throw new SearchAborted('time')
    }
  }

  private frameAt(ply: number): Frame {
    return this.frames[Math.min(ply, MAX_SEARCH_PLIES - 1)]!
  }
}

function selectNext(frame: Frame, count: number, index: number): number {
  let bestIndex = index
  for (let candidate = index + 1; candidate < count; candidate += 1) {
    if (frame.scores[candidate]! > frame.scores[bestIndex]!) bestIndex = candidate
  }

  if (bestIndex !== index) {
    const move = frame.moves[index]!
    const score = frame.scores[index]!
    frame.moves[index] = frame.moves[bestIndex]!
    frame.scores[index] = frame.scores[bestIndex]!
    frame.moves[bestIndex] = move
    frame.scores[bestIndex] = score
  }

  return frame.moves[index]!
}

function historyIndex(side: number, move: number): number {
  return side * 64 * 64 + moveFrom(move) * 64 + moveTo(move)
}

function isKingCapture(move: number): boolean {
  const captured = moveCaptured(move)
  return captured !== EMPTY && codeKind(captured) === KING
}

function nextQuietPlies(current: number, move: number): number {
  return moveCaptured(move) === EMPTY ? current + 1 : 0
}

function negateScore(score: number): number {
  return score === 0 ? 0 : -score
}

function hasQuietMove(moves: Int32Array, count: number): boolean {
  for (let index = 0; index < count; index += 1) {
    if (moveCaptured(moves[index]!) === EMPTY) return true
  }
  return false
}

function otherSide(side: number): number {
  return side === WHITE ? BLACK : WHITE
}

function findKing(board: Int8Array, side: number): number {
  for (let square = 0; square < board.length; square += 1) {
    const code = board[square]!
    if (code !== EMPTY && codeSide(code) === side && codeKind(code) === KING) return square
  }
  return -1
}

function evaluateForSide(position: Position, side: number): number {
  const whiteScore = evaluateBoard(position.board, side)
  return side === WHITE ? whiteScore : -whiteScore
}

function scoreToTable(score: number, ply: number): number {
  if (score >= MATE_TT_THRESHOLD) return score + ply
  if (score <= -MATE_TT_THRESHOLD) return score - ply
  return score
}

function scoreFromTable(score: number, ply: number): number {
  if (score >= MATE_TT_THRESHOLD) return score - ply
  if (score <= -MATE_TT_THRESHOLD) return score + ply
  return score
}
