import { MAX_GAME_PLIES, MAX_QUIET_PLIES } from '../../constants'
import { MATE_SCORE, VALUES, captureOrderScore, evaluateBoard } from './evaluate'
import { MAX_MOVES, generateMoves } from './movegen'
import { BLACK, EMPTY, KING, Position, WHITE, codeKind, moveCaptured } from './position'

/** Quiescence still needs a floor so a long capture chain cannot run away. */
const MAX_QUIESCENCE_PLIES = 8

const MAX_SEARCH_PLIES = 64

export interface SearchLimits {
  depth: number
  /** Game ply the root position sits at, used for the move-limit draw. */
  startPly: number
  /** Consecutive non-capturing plies before the root, for the progress draw. */
  startQuietPlies: number
  /** Node ceiling for this iteration; passing it abandons the whole depth. */
  nodeLimit?: number
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

/**
 * Negamax with alpha-beta over the polar board. Three rules of this variant
 * shape it: a king can simply be captured, a side with no move passes instead
 * of losing, and the game is drawn once progress or ply limits run out.
 */
export class Search {
  private readonly frames = createFrames()
  private readonly position: Position
  private readonly limits: SearchLimits
  private readonly nodeLimit: number
  nodes = 0
  /** Set once the node ceiling is passed; results from then on are unusable. */
  aborted = false

  constructor(position: Position, limits: SearchLimits) {
    this.position = position
    this.limits = limits
    this.nodeLimit = limits.nodeLimit ?? Number.POSITIVE_INFINITY
  }

  /**
   * Scores one root move. The window stays wide so that every root move gets an
   * exact score rather than a bound, which is what lets the caller detect true
   * ties and break them reproducibly.
   */
  scoreRootMove(move: number): number {
    const capturedKing = isKingCapture(move)
    this.position.make(move)

    const score = capturedKing
      ? MATE_SCORE
      : -this.negamax(
          this.limits.depth - 1,
          1,
          -MATE_SCORE,
          MATE_SCORE,
          nextQuietPlies(this.limits.startQuietPlies, move),
        )

    this.position.unmake()
    return score
  }

  private negamax(
    depth: number,
    ply: number,
    alpha: number,
    beta: number,
    quietPlies: number,
  ): number {
    this.nodes += 1
    if (this.nodes >= this.nodeLimit) {
      this.aborted = true
      return 0
    }

    if (this.reachedDrawHorizon(ply, quietPlies)) return 0

    if (depth <= 0) return this.quiesce(alpha, beta, ply, quietPlies, 0)

    const side = this.position.sideToMove
    const frame = this.frames[ply]!
    const count = generateMoves(this.position, side, frame.moves)

    if (count === 0) return this.searchPass(depth, ply, alpha, beta, quietPlies)

    this.orderMoves(frame, count)

    let best = -MATE_SCORE - 1
    for (let index = 0; index < count; index += 1) {
      const move = selectNext(frame, count, index)

      if (isKingCapture(move)) {
        // Nothing after this matters: taking the king ends the game.
        return MATE_SCORE - ply
      }

      this.position.make(move)
      const score = -this.negamax(
        depth - 1,
        ply + 1,
        -beta,
        -alpha,
        nextQuietPlies(quietPlies, move),
      )
      this.position.unmake()

      if (score > best) best = score
      if (score > alpha) alpha = score
      if (alpha >= beta) break
    }

    return best
  }

  /**
   * A side with nothing to move hands the turn back rather than losing, and
   * only a board where neither side can move is over.
   */
  private searchPass(
    depth: number,
    ply: number,
    alpha: number,
    beta: number,
    quietPlies: number,
  ): number {
    const opponent = this.position.sideToMove === WHITE ? BLACK : WHITE
    const frame = this.frames[ply]!
    if (generateMoves(this.position, opponent, frame.moves) === 0) return 0

    this.position.makePass()
    const score = -this.negamax(depth - 1, ply + 1, -beta, -alpha, quietPlies + 1)
    this.position.unmakePass()
    return score
  }

  /**
   * Extends the search over captures only, so a leaf is never scored in the
   * middle of an exchange. Standing pat is allowed because the side to move is
   * not obliged to capture.
   */
  private quiesce(
    alpha: number,
    beta: number,
    ply: number,
    quietPlies: number,
    extension: number,
  ): number {
    this.nodes += 1
    if (this.nodes >= this.nodeLimit) {
      this.aborted = true
      return 0
    }

    if (this.reachedDrawHorizon(ply, quietPlies)) return 0

    const side = this.position.sideToMove
    const standPat = side === WHITE ? evaluateBoard(this.position.board) : -evaluateBoard(this.position.board)

    if (extension >= MAX_QUIESCENCE_PLIES) return standPat
    if (standPat >= beta) return standPat
    if (standPat > alpha) alpha = standPat

    const frame = this.frames[Math.min(ply, MAX_SEARCH_PLIES - 1)]!
    const count = generateMoves(this.position, side, frame.moves, true)
    if (count === 0) return alpha

    for (let index = 0; index < count; index += 1) {
      frame.scores[index] = captureOrderScore(this.position.board, frame.moves[index]!)
    }

    let best = standPat
    for (let index = 0; index < count; index += 1) {
      const move = selectNext(frame, count, index)

      if (isKingCapture(move)) return MATE_SCORE - ply

      // Selection sort keeps move and score together, so this is the exchange
      // value computed above. A capture that loses material outright cannot
      // improve the position, and searching it only widens the tree.
      if (frame.scores[index]! < 0) continue

      this.position.make(move)
      const score = -this.quiesce(
        -beta,
        -alpha,
        ply + 1,
        nextQuietPlies(quietPlies, move),
        extension + 1,
      )
      this.position.unmake()

      if (score > best) best = score
      if (score > alpha) alpha = score
      if (alpha >= beta) break
    }

    return best
  }

  private reachedDrawHorizon(ply: number, quietPlies: number): boolean {
    return (
      quietPlies >= MAX_QUIET_PLIES ||
      this.limits.startPly + ply >= MAX_GAME_PLIES
    )
  }

  private orderMoves(frame: Frame, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const move = frame.moves[index]!
      const captured = moveCaptured(move)

      frame.scores[index] =
        captured === EMPTY
          ? -1_000_000 + quietBonus(move)
          : VALUES[codeKind(captured)]! * 16 + captureOrderScore(this.position.board, move)
    }
  }
}

/** Promotions are the only quiet moves worth trying before the rest. */
function quietBonus(move: number): number {
  return (move & (1 << 16)) !== 0 ? 5_000 : 0
}

/**
 * Selection sort one entry at a time: the search usually cuts off after a few
 * moves, so sorting the whole list up front would be wasted work.
 */
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

function isKingCapture(move: number): boolean {
  const captured = moveCaptured(move)
  return captured !== EMPTY && codeKind(captured) === KING
}

function nextQuietPlies(current: number, move: number): number {
  return moveCaptured(move) === EMPTY ? current + 1 : 0
}
