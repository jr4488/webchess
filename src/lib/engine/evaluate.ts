import {
  BISHOP,
  BLACK,
  EMPTY,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  RINGS,
  ROOK,
  SQUARE_COUNT,
  WHITE,
  codeKind,
  codeSide,
  encodePiece,
  moveCaptured,
  moveFrom,
  moveIsPromotion,
  moveTo,
  ringOf,
  sectorOf,
} from './position'
import {
  isAttacked,
  leastValuableAttacker,
  pawnDirection,
  pawnPromotionRing,
  pawnStartRing,
} from './movegen'

/** Centipawn values indexed by kind. The king is priced out of exchanges. */
export const VALUES: readonly number[] = [100, 320, 330, 500, 900, 30_000]

/** A king capture ends the game, so it dwarfs any material score. */
export const MATE_SCORE = 1_000_000

/**
 * Rings are the direction of travel: White advances 7 to 0, Black 0 to 7. A
 * pawn one step from the far edge is nearly a queen, so the bonus accelerates.
 */
const PAWN_ADVANCEMENT: readonly number[] = [0, 8, 22, 48, 96, 180, 180]

/**
 * A clear promotion run is worth much more than generic centrality. These
 * bonuses stay below the guaranteed 800cp promotion gain because the opponent
 * may still attack the pawn or occupy its runway.
 */
const PAWN_RUNWAY: readonly number[] = [0, 360, 150, 65, 28, 12, 4, 0]
const BLOCKED_PAWN: readonly number[] = [0, 120, 50, 22, 10, 4, 0, 0]
const PROMOTION_TEMPO = 90
const TEMPO_BONUS = 10

/**
 * The outer and inner rings are edges where sliding pieces lose a direction,
 * so pieces are worth slightly more in the middle of the board.
 */
const RING_CENTRALITY: readonly number[] = [-14, -4, 6, 12, 12, 6, -4, -14]

function pawnAdvancement(side: number, ring: number): number {
  const progress = side === WHITE ? pawnStartRing(WHITE) - ring : ring - pawnStartRing(BLACK)
  if (progress <= 0) return 0
  return PAWN_ADVANCEMENT[Math.min(progress, PAWN_ADVANCEMENT.length - 1)]!
}

function pawnPlacement(
  board: Int8Array,
  square: number,
  side: number,
  sideToMove: number | undefined,
): number {
  const ring = ringOf(square)
  const direction = pawnDirection(side)
  const promotionRing = pawnPromotionRing(side)
  const distance = Math.abs(promotionRing - ring)
  let score = pawnAdvancement(side, ring)

  if (distance <= 0) return score

  const next = square + direction * 8
  if (board[next] !== EMPTY) {
    return score - BLOCKED_PAWN[Math.min(distance, BLOCKED_PAWN.length - 1)]!
  }

  let runwayClear = true
  if (distance > 1) {
    for (
      let nextRing = ring + direction * 2;
      ;
      nextRing += direction
    ) {
      if (board[nextRing * 8 + sectorOf(square)] !== EMPTY) {
        runwayClear = false
        break
      }
      if (nextRing === promotionRing) break
    }
  }

  if (runwayClear) {
    score += PAWN_RUNWAY[Math.min(distance, PAWN_RUNWAY.length - 1)]!
    if (distance === 1 && sideToMove === side) score += PROMOTION_TEMPO
  }

  return score
}

/**
 * Scores the position from White's point of view in centipawns. Tactics are
 * left to the search; this only has to rank quiet positions sensibly.
 */
export function evaluateBoard(board: Int8Array, sideToMove?: number): number {
  let score = 0
  let whiteMaterial = 0
  let blackMaterial = 0
  let whiteKing = -1
  let blackKing = -1

  for (let square = 0; square < SQUARE_COUNT; square += 1) {
    const code = board[square]!
    if (code === EMPTY) continue

    const side = codeSide(code)
    const kind = codeKind(code)
    const ring = ringOf(square)

    if (kind === KING) {
      if (side === WHITE) whiteKing = square
      else blackKing = square
      continue
    }

    const material = VALUES[kind]!
    const placement =
      kind === PAWN
        ? pawnPlacement(board, square, side, sideToMove)
        : RING_CENTRALITY[ring]! + localActivity(board, square, side, kind)

    if (side === WHITE) {
      whiteMaterial += material
      score += material + placement
    } else {
      blackMaterial += material
      score -= material + placement
    }
  }

  let whiteSafe = KING_STEPS
  let blackSafe = KING_STEPS
  if (whiteKing >= 0 && blackKing >= 0) {
    whiteSafe = safeKingSquares(board, whiteKing, BLACK)
    blackSafe = safeKingSquares(board, blackKing, WHITE)
    score +=
      kingDanger(board, blackKing, BLACK, blackSafe, sideToMove) -
      kingDanger(board, whiteKing, WHITE, whiteSafe, sideToMove)
  }

  if (sideToMove === WHITE) score += TEMPO_BONUS
  else if (sideToMove === BLACK) score -= TEMPO_BONUS

  return (
    score +
    mopUp(
      whiteKing,
      blackKing,
      whiteMaterial - blackMaterial,
      whiteSafe,
      blackSafe,
    )
  )
}

const LOCAL_ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

const LOCAL_DIAGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

const LOCAL_DIRECTIONS = [...LOCAL_ORTHOGONAL, ...LOCAL_DIAGONAL]

const LOCAL_KNIGHT_STEPS: ReadonlyArray<readonly [number, number]> = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
]

/**
 * Counts only immediately available directions (or jumps for a knight). It is
 * a cheap activity signal, not full move generation, and strongly prefers
 * developing a boxed piece without materially slowing leaf evaluation.
 */
function localActivity(
  board: Int8Array,
  square: number,
  side: number,
  kind: number,
): number {
  const directions =
    kind === KNIGHT
      ? LOCAL_KNIGHT_STEPS
      : kind === ROOK
        ? LOCAL_ORTHOGONAL
        : kind === BISHOP
          ? LOCAL_DIAGONAL
          : LOCAL_DIRECTIONS
  const ring = ringOf(square)
  const sector = sectorOf(square)
  let available = 0

  for (const [ringStep, sectorStep] of directions) {
    const targetRing = ring + ringStep
    if (targetRing < 0 || targetRing >= RINGS) continue
    const targetSector = ((sector + sectorStep) % 8 + 8) % 8
    const occupant = board[targetRing * 8 + targetSector]!
    if (occupant === EMPTY || codeSide(occupant) !== side) available += 1
  }

  if (kind === QUEEN) return available
  if (kind === ROOK) return available * 2
  return available * 3
}

/** Material edge, in centipawns, at which hunting the bare king is worthwhile. */
const MOP_UP_THRESHOLD = 400

/**
 * Without this, a winning side has no gradient to follow once it is simply
 * ahead on material, and the game grinds into the no-progress draw. Sectors
 * wrap, so the only edges to drive a king toward are the inner and outer rings.
 */
function mopUp(
  whiteKing: number,
  blackKing: number,
  materialEdge: number,
  whiteSafe: number,
  blackSafe: number,
): number {
  if (whiteKing < 0 || blackKing < 0) return 0
  if (Math.abs(materialEdge) < MOP_UP_THRESHOLD) return 0

  const winning = materialEdge > 0 ? WHITE : BLACK
  const losingKing = winning === WHITE ? blackKing : whiteKing
  const drivenToEdge = Math.abs(3.5 - ringOf(losingKing))
  const closingIn = MAX_POLAR_DISTANCE - polarDistance(whiteKing, blackKing)
  const trapped = KING_STEPS - (winning === WHITE ? blackSafe : whiteSafe)

  const bonus = Math.round(14 * drivenToEdge + 6 * closingIn + 30 * trapped)
  return winning === WHITE ? bonus : -bonus
}

const KING_STEPS = 8
const KING_CONSTRAINT: readonly number[] = [0, 2, 5, 9, 16, 26, 40, 60, 85]

/**
 * In this variant an attacked king is a capturable piece, not merely a check
 * marker. Escape scarcity therefore matters in balanced positions too, while
 * an attack by the side that moves next is especially urgent.
 */
function kingDanger(
  board: Int8Array,
  kingSquare: number,
  defendingSide: number,
  safeSquares: number,
  sideToMove: number | undefined,
): number {
  const attacker = otherSideOf(defendingSide)
  const constrained = Math.max(0, Math.min(KING_STEPS, KING_STEPS - safeSquares))
  let danger = KING_CONSTRAINT[constrained]!

  if (isAttacked(board, kingSquare, attacker)) {
    danger += 160 + constrained * 16
    if (sideToMove === attacker) danger += 180
  }

  return danger
}

/**
 * How many squares the hunted king can still step to without the winning side
 * covering them. Driving this to zero is the win condition: the king has to
 * move, every square it can reach is attacked, so it is captured next ply.
 */
function safeKingSquares(board: Int8Array, kingSquare: number, attackingSide: number): number {
  const ring = ringOf(kingSquare)
  const sector = sectorOf(kingSquare)
  const hunted = otherSideOf(attackingSide)
  let safe = 0

  for (let ringStep = -1; ringStep <= 1; ringStep += 1) {
    const nextRing = ring + ringStep
    if (nextRing < 0 || nextRing >= RINGS) continue

    for (let sectorStep = -1; sectorStep <= 1; sectorStep += 1) {
      if (ringStep === 0 && sectorStep === 0) continue

      const target = nextRing * 8 + (((sector + sectorStep) % 8) + 8) % 8
      const occupant = board[target]!
      if (occupant !== EMPTY && codeSide(occupant) === hunted) continue
      if (!isAttacked(board, target, attackingSide)) safe += 1
    }
  }

  return safe
}

function otherSideOf(side: number): number {
  return side === WHITE ? BLACK : WHITE
}

const MAX_POLAR_DISTANCE = 11

function polarDistance(left: number, right: number): number {
  const sectorGap = Math.abs(sectorOf(left) - sectorOf(right))
  return Math.abs(ringOf(left) - ringOf(right)) + Math.min(sectorGap, 8 - sectorGap)
}

const seeBoard = new Int8Array(SQUARE_COUNT)
const seeGains = new Int32Array(40)

/**
 * Static exchange evaluation: plays out the capture sequence on one square,
 * always recapturing with the cheapest available attacker, and returns the
 * material the mover ends up ahead. Mutating a scratch board as it goes means
 * pieces lined up behind an attacker join the exchange automatically.
 */
export function staticExchange(board: Int8Array, move: number): number {
  const from = moveFrom(move)
  const to = moveTo(move)
  const captured = moveCaptured(move)

  seeBoard.set(board)

  let side = codeSide(seeBoard[from]!)
  let onSquareValue = pieceValueAt(seeBoard, from, move)
  let depth = 0
  seeGains[0] = captured === EMPTY ? 0 : VALUES[codeKind(captured)]!

  if (moveIsPromotion(move)) {
    seeGains[0]! += VALUES[QUEEN]! - VALUES[PAWN]!
  }

  seeBoard[to] = moveIsPromotion(move) ? encodePiece(side, QUEEN) : seeBoard[from]!
  seeBoard[from] = EMPTY

  for (;;) {
    side = side === WHITE ? BLACK : WHITE
    const attacker = leastValuableAttacker(seeBoard, to, side, VALUES)
    if (attacker < 0) break

    depth += 1
    if (depth >= seeGains.length) break

    seeGains[depth] = onSquareValue - seeGains[depth - 1]!

    const attackerCode = seeBoard[attacker]!
    const promotes =
      codeKind(attackerCode) === PAWN && ringOf(to) === pawnPromotionRing(side)
    if (promotes) {
      seeGains[depth]! += VALUES[QUEEN]! - VALUES[PAWN]!
    }

    // Once a side is already losing the exchange it simply declines to
    // recapture, so there is no point extending the sequence further.
    if (Math.max(-seeGains[depth - 1]!, seeGains[depth]!) < 0) break

    onSquareValue = promotes ? VALUES[QUEEN]! : VALUES[codeKind(attackerCode)]!
    seeBoard[to] = promotes ? encodePiece(side, QUEEN) : attackerCode
    seeBoard[attacker] = EMPTY
  }

  while (depth > 0) {
    seeGains[depth - 1] = -Math.max(-seeGains[depth - 1]!, seeGains[depth]!)
    depth -= 1
  }

  return seeGains[0]!
}

function pieceValueAt(board: Int8Array, square: number, move: number): number {
  const kind = codeKind(board[square]!)
  return moveIsPromotion(move) ? VALUES[QUEEN]! : VALUES[kind]!
}

/**
 * Move ordering score. Taking the king ends the game, so it outranks any
 * exchange; everything else is ordered by the material the exchange wins.
 */
export function captureOrderScore(board: Int8Array, move: number): number {
  const captured = moveCaptured(move)
  if (captured !== EMPTY && codeKind(captured) === KING) return MATE_SCORE

  return staticExchange(board, move)
}
