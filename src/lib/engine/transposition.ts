export const TT_EXACT = 0
export const TT_LOWER_BOUND = 1
export const TT_UPPER_BOUND = 2

export type TranspositionFlag =
  | typeof TT_EXACT
  | typeof TT_LOWER_BOUND
  | typeof TT_UPPER_BOUND

export interface TranspositionEntry {
  depth: number
  score: number
  flag: TranspositionFlag
  bestMove: number
}

/**
 * A compact, direct-mapped transposition table.
 *
 * JavaScript bitwise arithmetic is deliberately used instead of BigInt here.
 * Position supplies two independently generated 32-bit Zobrist halves, and the
 * draw counters are mixed into both halves before lookup. Both halves must
 * match, so a table collision has the same practical protection as a 64-bit
 * key without putting BigInt in the hottest part of the search.
 */
export class TranspositionTable {
  private readonly mask: number
  private readonly occupied: Uint8Array
  private readonly keyLow: Uint32Array
  private readonly keyHigh: Uint32Array
  private readonly depths: Int16Array
  private readonly scores: Int32Array
  private readonly flags: Uint8Array
  private readonly bestMoves: Int32Array

  constructor(entryCount = 1 << 17) {
    const size = nextPowerOfTwo(Math.max(1_024, entryCount))
    this.mask = size - 1
    this.occupied = new Uint8Array(size)
    this.keyLow = new Uint32Array(size)
    this.keyHigh = new Uint32Array(size)
    this.depths = new Int16Array(size)
    this.scores = new Int32Array(size)
    this.flags = new Uint8Array(size)
    this.bestMoves = new Int32Array(size)
  }

  clear(): void {
    this.occupied.fill(0)
  }

  probe(
    positionLow: number,
    positionHigh: number,
    quietPlies: number,
    remainingPlies: number,
  ): TranspositionEntry | null {
    const [low, high] = stateKey(positionLow, positionHigh, quietPlies, remainingPlies)
    const index = this.indexOf(low, high)
    if (
      this.occupied[index] === 0 ||
      this.keyLow[index] !== low ||
      this.keyHigh[index] !== high
    ) {
      return null
    }

    return {
      depth: this.depths[index]!,
      score: this.scores[index]!,
      flag: this.flags[index]! as TranspositionFlag,
      bestMove: this.bestMoves[index]!,
    }
  }

  store(
    positionLow: number,
    positionHigh: number,
    quietPlies: number,
    remainingPlies: number,
    entry: TranspositionEntry,
  ): void {
    const [low, high] = stateKey(positionLow, positionHigh, quietPlies, remainingPlies)
    const index = this.indexOf(low, high)

    const samePosition =
      this.occupied[index] !== 0 &&
      this.keyLow[index] === low &&
      this.keyHigh[index] === high

    // Prefer deeper information for the same state. A collision is always
    // replaceable: keeping an unrelated entry would not help this subtree.
    if (samePosition && this.depths[index]! > entry.depth && entry.flag !== TT_EXACT) {
      return
    }

    this.occupied[index] = 1
    this.keyLow[index] = low
    this.keyHigh[index] = high
    this.depths[index] = entry.depth
    this.scores[index] = entry.score
    this.flags[index] = entry.flag
    this.bestMoves[index] = entry.bestMove
  }

  private indexOf(low: number, high: number): number {
    const mixed = (low ^ rotateLeft(high, 13) ^ Math.imul(high, 0x9e3779b1)) >>> 0
    return mixed & this.mask
  }
}

function stateKey(
  positionLow: number,
  positionHigh: number,
  quietPlies: number,
  remainingPlies: number,
): readonly [number, number] {
  const quiet = Math.max(0, quietPlies) | 0
  const remaining = Math.max(0, remainingPlies) | 0
  const low = (
    positionLow ^
    Math.imul(quiet + 1, 0x85ebca6b) ^
    rotateLeft(Math.imul(remaining + 1, 0xc2b2ae35), 11)
  ) >>> 0
  const high = (
    positionHigh ^
    Math.imul(remaining + 1, 0x27d4eb2f) ^
    rotateLeft(Math.imul(quiet + 1, 0x165667b1), 17)
  ) >>> 0
  return [low, high]
}

function rotateLeft(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0
}

function nextPowerOfTwo(value: number): number {
  let result = 1
  while (result < value) result *= 2
  return result
}
