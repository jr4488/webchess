import {
  BISHOP,
  BLACK,
  EMPTY,
  KING,
  KNIGHT,
  PAWN,
  Position,
  QUEEN,
  RINGS,
  ROOK,
  SECTORS,
  SQUARE_COUNT,
  WHITE,
  codeKind,
  codeSide,
  encodeMove,
  encodePiece,
  ringOf,
  sectorOf,
  squareOf,
} from './position'

/** Maximum moves generated for one side; a full board cannot approach this. */
export const MAX_MOVES = 256

function normalizeSector(sector: number): number {
  return ((sector % SECTORS) + SECTORS) % SECTORS
}

/**
 * Ring steps leave the board at the edges, but sector steps wrap around the
 * seam, so a ray can travel the long way round to reach the same ring.
 */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

const ROOK_DIRECTIONS = [0, 1, 2, 3] as const
const BISHOP_DIRECTIONS = [4, 5, 6, 7] as const
const QUEEN_DIRECTIONS = [0, 1, 2, 3, 4, 5, 6, 7] as const

const MAX_RAY_STEPS = 7

function buildRays(): Int8Array[][] {
  return DIRECTIONS.map(([ringStep, sectorStep]) => {
    const perSquare: Int8Array[] = []
    for (let square = 0; square < SQUARE_COUNT; square += 1) {
      const ring = ringOf(square)
      const sector = sectorOf(square)
      const squares: number[] = []

      for (let distance = 1; distance <= MAX_RAY_STEPS; distance += 1) {
        const nextRing = ring + ringStep * distance
        if (nextRing < 0 || nextRing >= RINGS) break

        const nextSquare = squareOf(nextRing, normalizeSector(sector + sectorStep * distance))
        if (nextSquare === square) break
        squares.push(nextSquare)
      }

      perSquare.push(Int8Array.from(squares))
    }
    return perSquare
  })
}

function buildStepTargets(offsets: ReadonlyArray<readonly [number, number]>): Int8Array[] {
  const perSquare: Int8Array[] = []
  for (let square = 0; square < SQUARE_COUNT; square += 1) {
    const ring = ringOf(square)
    const sector = sectorOf(square)
    const squares: number[] = []

    for (const [ringStep, sectorStep] of offsets) {
      const nextRing = ring + ringStep
      if (nextRing < 0 || nextRing >= RINGS) continue
      squares.push(squareOf(nextRing, normalizeSector(sector + sectorStep)))
    }

    perSquare.push(Int8Array.from(squares))
  }
  return perSquare
}

const RAYS = buildRays()

const KNIGHT_TARGETS = buildStepTargets([
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
])

const KING_TARGETS = buildStepTargets([
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
])

/**
 * Two rays can land on the same square — the seam lets both sector directions
 * reach it, and the two diagonals of a ring pair meet four steps out. The game
 * module collapses those into a Map, so the search must not emit them twice.
 */
const seen = new Int32Array(SQUARE_COUNT)
let seenStamp = 0

function nextStamp(): number {
  seenStamp += 1
  if (seenStamp === 0x7fffffff) {
    seen.fill(0)
    seenStamp = 1
  }
  return seenStamp
}

export function pawnDirection(side: number): number {
  return side === BLACK ? 1 : -1
}

export function pawnStartRing(side: number): number {
  return side === BLACK ? 1 : 6
}

export function pawnPromotionRing(side: number): number {
  return side === BLACK ? RINGS - 1 : 0
}

/**
 * Writes every pseudo-legal move for `side` into `out` starting at index 0 and
 * returns the count. When `capturesOnly` is set the quiet moves are skipped,
 * which is what the quiescence search needs.
 */
export function generateMoves(
  position: Position,
  side: number,
  out: Int32Array,
  capturesOnly = false,
): number {
  const { board } = position
  let count = 0

  for (let from = 0; from < SQUARE_COUNT; from += 1) {
    const code = board[from]!
    if (code === EMPTY || codeSide(code) !== side) continue

    const kind = codeKind(code)

    if (kind === PAWN) {
      count = addPawnMoves(position, side, from, out, count, capturesOnly)
      continue
    }

    if (kind === KNIGHT || kind === KING) {
      const targets = kind === KNIGHT ? KNIGHT_TARGETS[from]! : KING_TARGETS[from]!
      for (let index = 0; index < targets.length; index += 1) {
        const to = targets[index]!
        const occupant = board[to]!
        if (occupant !== EMPTY && codeSide(occupant) === side) continue
        if (capturesOnly && occupant === EMPTY) continue
        out[count] = encodeMove(from, to, occupant, false)
        count += 1
      }
      continue
    }

    const stamp = nextStamp()
    const directions =
      kind === ROOK ? ROOK_DIRECTIONS : kind === BISHOP ? BISHOP_DIRECTIONS : QUEEN_DIRECTIONS

    for (let directionIndex = 0; directionIndex < directions.length; directionIndex += 1) {
      const ray = RAYS[directions[directionIndex]!]![from]!
      for (let step = 0; step < ray.length; step += 1) {
        const to = ray[step]!
        const occupant = board[to]!

        if (occupant === EMPTY) {
          if (!capturesOnly && seen[to] !== stamp) {
            seen[to] = stamp
            out[count] = encodeMove(from, to, EMPTY, false)
            count += 1
          }
          continue
        }

        if (codeSide(occupant) !== side && seen[to] !== stamp) {
          seen[to] = stamp
          out[count] = encodeMove(from, to, occupant, false)
          count += 1
        }
        break
      }
    }
  }

  return count
}

function addPawnMoves(
  position: Position,
  side: number,
  from: number,
  out: Int32Array,
  startCount: number,
  capturesOnly: boolean,
): number {
  const { board, moved } = position
  let count = startCount

  const ring = ringOf(from)
  const sector = sectorOf(from)
  const direction = pawnDirection(side)
  const promotionRing = pawnPromotionRing(side)
  const forwardRing = ring + direction

  if (forwardRing >= 0 && forwardRing < RINGS) {
    if (!capturesOnly) {
      const forward = squareOf(forwardRing, sector)
      if (board[forward] === EMPTY) {
        out[count] = encodeMove(from, forward, EMPTY, forwardRing === promotionRing)
        count += 1

        const doubleRing = ring + direction * 2
        if (
          moved[from] === 0 &&
          ring === pawnStartRing(side) &&
          doubleRing >= 0 &&
          doubleRing < RINGS
        ) {
          const doubleForward = squareOf(doubleRing, sector)
          if (board[doubleForward] === EMPTY) {
            out[count] = encodeMove(from, doubleForward, EMPTY, doubleRing === promotionRing)
            count += 1
          }
        }
      }
    }

    for (const sectorStep of [-1, 1]) {
      const target = squareOf(forwardRing, normalizeSector(sector + sectorStep))
      const occupant = board[target]!
      if (occupant !== EMPTY && codeSide(occupant) !== side) {
        out[count] = encodeMove(from, target, occupant, forwardRing === promotionRing)
        count += 1
      }
    }
  }

  return count
}

/**
 * Whether `side` attacks `square`, scanning outward from the square itself.
 * Whatever occupies the square is ignored, so this also answers "is my own
 * piece defended here", which the exchange evaluator depends on.
 */
export function isAttacked(board: Int8Array, square: number, side: number): boolean {
  const knightTargets = KNIGHT_TARGETS[square]!
  const enemyKnight = encodePiece(side, KNIGHT)
  for (let index = 0; index < knightTargets.length; index += 1) {
    if (board[knightTargets[index]!] === enemyKnight) return true
  }

  const kingTargets = KING_TARGETS[square]!
  const enemyKing = encodePiece(side, KING)
  for (let index = 0; index < kingTargets.length; index += 1) {
    if (board[kingTargets[index]!] === enemyKing) return true
  }

  for (let direction = 0; direction < DIRECTIONS.length; direction += 1) {
    const ray = RAYS[direction]![square]!
    const straight = direction < 4

    for (let step = 0; step < ray.length; step += 1) {
      const occupant = board[ray[step]!]!
      if (occupant === EMPTY) continue
      if (codeSide(occupant) === side) {
        const kind = codeKind(occupant)
        if (kind === QUEEN) return true
        if (straight ? kind === ROOK : kind === BISHOP) return true
      }
      break
    }
  }

  // A pawn attacks diagonally forward, so the squares it attacks from sit one
  // ring behind the target relative to that pawn's own direction of travel.
  const ring = ringOf(square)
  const sector = sectorOf(square)
  const originRing = ring - pawnDirection(side)
  if (originRing >= 0 && originRing < RINGS) {
    const enemyPawn = encodePiece(side, PAWN)
    for (const sectorStep of [-1, 1]) {
      if (board[squareOf(originRing, normalizeSector(sector + sectorStep))] === enemyPawn) {
        return true
      }
    }
  }

  return false
}

/** Origin square of `side`'s least valuable attacker of `square`, or -1. */
export function leastValuableAttacker(
  board: Int8Array,
  square: number,
  side: number,
  values: readonly number[],
): number {
  let best = -1
  let bestValue = Number.POSITIVE_INFINITY

  const consider = (from: number): void => {
    const value = values[codeKind(board[from]!)]!
    if (value < bestValue) {
      bestValue = value
      best = from
    }
  }

  const ring = ringOf(square)
  const sector = sectorOf(square)
  const originRing = ring - pawnDirection(side)
  if (originRing >= 0 && originRing < RINGS) {
    const enemyPawn = encodePiece(side, PAWN)
    for (const sectorStep of [-1, 1]) {
      const from = squareOf(originRing, normalizeSector(sector + sectorStep))
      if (board[from] === enemyPawn) consider(from)
    }
  }

  const knightTargets = KNIGHT_TARGETS[square]!
  const enemyKnight = encodePiece(side, KNIGHT)
  for (let index = 0; index < knightTargets.length; index += 1) {
    if (board[knightTargets[index]!] === enemyKnight) consider(knightTargets[index]!)
  }

  for (let direction = 0; direction < DIRECTIONS.length; direction += 1) {
    const ray = RAYS[direction]![square]!
    const straight = direction < 4

    for (let step = 0; step < ray.length; step += 1) {
      const from = ray[step]!
      const occupant = board[from]!
      if (occupant === EMPTY) continue
      if (codeSide(occupant) === side) {
        const kind = codeKind(occupant)
        if (kind === QUEEN || (straight ? kind === ROOK : kind === BISHOP)) consider(from)
      }
      break
    }
  }

  const kingTargets = KING_TARGETS[square]!
  const enemyKing = encodePiece(side, KING)
  for (let index = 0; index < kingTargets.length; index += 1) {
    if (board[kingTargets[index]!] === enemyKing) consider(kingTargets[index]!)
  }

  return best
}

export { WHITE, BLACK }
