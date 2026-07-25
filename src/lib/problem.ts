import type { CellCoord, ProblemPart } from '../types'

export const BOARD_RING_COUNT = 8
export const BOARD_SECTOR_COUNT = 8

interface LensDimension {
  name: string
  keyword: string
  focus: string
}

interface LensMovement {
  name: string
  keyword: string
  lead: string
}

interface HexagramLens {
  number: number
  name: string
  theme: string
}

/** Eight practical dimensions of a problem, not traditional I Ching categories. */
export const PROBLEM_DIMENSIONS: readonly LensDimension[] = [
  {
    name: 'Purpose',
    keyword: 'intention',
    focus: 'the result that truly matters',
  },
  {
    name: 'People',
    keyword: 'relationships',
    focus: 'the people affected and the perspectives they hold',
  },
  {
    name: 'Resources',
    keyword: 'capacity',
    focus: 'the time, energy, knowledge, and material available',
  },
  {
    name: 'Timing',
    keyword: 'rhythm',
    focus: 'what is ready now and what may need patience',
  },
  {
    name: 'Risks',
    keyword: 'tension',
    focus: 'the uncertainty, tradeoffs, and possible unintended effects',
  },
  {
    name: 'Values',
    keyword: 'integrity',
    focus: 'the principles and boundaries worth honoring',
  },
  {
    name: 'Evidence',
    keyword: 'signals',
    focus: 'what is known, assumed, missing, or contradicted',
  },
  {
    name: 'Possibilities',
    keyword: 'potential',
    focus: 'the alternatives that have not yet been explored',
  },
] as const

/** Eight kinds of change used to turn every dimension into a distinct lens. */
export const PROBLEM_MOVEMENTS: readonly LensMovement[] = [
  {
    name: 'Begin',
    keyword: 'initiate',
    lead: 'What first step would reveal',
  },
  {
    name: 'Receive',
    keyword: 'listen',
    lead: 'What becomes visible when you listen for',
  },
  {
    name: 'Clarify',
    keyword: 'distinguish',
    lead: 'Which distinction would sharpen',
  },
  {
    name: 'Connect',
    keyword: 'relate',
    lead: 'What relationship could strengthen',
  },
  {
    name: 'Challenge',
    keyword: 'question',
    lead: 'Which assumption might be distorting',
  },
  {
    name: 'Adapt',
    keyword: 'adjust',
    lead: 'What change would better align',
  },
  {
    name: 'Consolidate',
    keyword: 'stabilize',
    lead: 'What should be protected or made durable about',
  },
  {
    name: 'Release',
    keyword: 'make space',
    lead: 'What could be loosened to make room around',
  },
] as const

/**
 * The names follow the King Wen sequence. The short themes are deliberately
 * reflective rather than predictive: WebChess borrows imagery of change and
 * polarity without presenting the board as a formal divination method.
 */
export const HEXAGRAM_LENSES: readonly HexagramLens[] = [
  { number: 1, name: 'The Creative', theme: 'initiating force and persistent purpose' },
  { number: 2, name: 'The Receptive', theme: 'openness, support, and responsive strength' },
  { number: 3, name: 'Difficulty at the Beginning', theme: 'bringing order to an uncertain start' },
  { number: 4, name: 'Youthful Folly', theme: 'learning through honest questions' },
  { number: 5, name: 'Waiting', theme: 'patient preparation and trust in timing' },
  { number: 6, name: 'Conflict', theme: 'meeting disagreement with clarity and restraint' },
  { number: 7, name: 'The Army', theme: 'disciplined collective effort' },
  { number: 8, name: 'Holding Together', theme: 'belonging, alliance, and shared purpose' },
  { number: 9, name: 'The Taming Power of the Small', theme: 'gentle influence through small actions' },
  { number: 10, name: 'Treading', theme: 'careful conduct in sensitive terrain' },
  { number: 11, name: 'Peace', theme: 'fruitful exchange and balanced flow' },
  { number: 12, name: 'Standstill', theme: 'recognizing blockage without forcing movement' },
  { number: 13, name: 'Fellowship with People', theme: 'cooperation across differences' },
  { number: 14, name: 'Possession in Great Measure', theme: 'stewarding abundance with care' },
  { number: 15, name: 'Modesty', theme: 'quiet confidence and proportion' },
  { number: 16, name: 'Enthusiasm', theme: 'mobilizing energy around a vision' },
  { number: 17, name: 'Following', theme: 'responsive alignment with what works' },
  { number: 18, name: 'Work on What Has Been Spoiled', theme: 'repairing inherited patterns' },
  { number: 19, name: 'Approach', theme: 'drawing near with attention and care' },
  { number: 20, name: 'Contemplation', theme: 'observing the whole before acting' },
  { number: 21, name: 'Biting Through', theme: 'decisive action through an obstacle' },
  { number: 22, name: 'Grace', theme: 'form, presentation, and essential simplicity' },
  { number: 23, name: 'Splitting Apart', theme: 'letting an exhausted structure fall away' },
  { number: 24, name: 'Return', theme: 'renewal through a return to the essential' },
  { number: 25, name: 'Innocence', theme: 'acting naturally without hidden agenda' },
  { number: 26, name: 'The Taming Power of the Great', theme: 'building strength through restraint' },
  { number: 27, name: 'Nourishment', theme: 'examining what sustains people and ideas' },
  { number: 28, name: 'Preponderance of the Great', theme: 'responding when the load becomes exceptional' },
  { number: 29, name: 'The Abysmal Water', theme: 'moving through repeated uncertainty with steadiness' },
  { number: 30, name: 'The Clinging Fire', theme: 'clarity, attention, and interdependence' },
  { number: 31, name: 'Influence', theme: 'mutual attraction and respectful persuasion' },
  { number: 32, name: 'Duration', theme: 'continuity through adaptive commitment' },
  { number: 33, name: 'Retreat', theme: 'strategic distance that preserves strength' },
  { number: 34, name: 'The Power of the Great', theme: 'using strength responsibly' },
  { number: 35, name: 'Progress', theme: 'visible advance and widening contribution' },
  { number: 36, name: 'Darkening of the Light', theme: 'protecting insight in difficult conditions' },
  { number: 37, name: 'The Family', theme: 'roles, trust, and order within a group' },
  { number: 38, name: 'Opposition', theme: 'learning from difference without erasing it' },
  { number: 39, name: 'Obstruction', theme: 'turning difficulty into a change of direction' },
  { number: 40, name: 'Deliverance', theme: 'release after tension and timely forgiveness' },
  { number: 41, name: 'Decrease', theme: 'simplifying to restore balance' },
  { number: 42, name: 'Increase', theme: 'directing growth toward shared benefit' },
  { number: 43, name: 'Breakthrough', theme: 'clear resolve expressed without aggression' },
  { number: 44, name: 'Coming to Meet', theme: 'recognizing a powerful new influence early' },
  { number: 45, name: 'Gathering Together', theme: 'concentrating people and purpose' },
  { number: 46, name: 'Pushing Upward', theme: 'gradual growth through devoted effort' },
  { number: 47, name: 'Oppression', theme: 'finding inner resources under constraint' },
  { number: 48, name: 'The Well', theme: 'renewing the shared source of nourishment' },
  { number: 49, name: 'Revolution', theme: 'well-timed transformation with legitimacy' },
  { number: 50, name: 'The Cauldron', theme: 'transforming raw material into shared culture' },
  { number: 51, name: 'The Arousing Thunder', theme: 'awakening and composure after a shock' },
  { number: 52, name: 'Keeping Still Mountain', theme: 'stillness, boundaries, and deliberate pause' },
  { number: 53, name: 'Development', theme: 'patient, organic progress' },
  { number: 54, name: 'The Marrying Maiden', theme: 'adapting when influence is limited' },
  { number: 55, name: 'Abundance', theme: 'acting clearly at a moment of fullness' },
  { number: 56, name: 'The Wanderer', theme: 'resourcefulness while passing through unfamiliar ground' },
  { number: 57, name: 'The Gentle Wind', theme: 'subtle influence through steady penetration' },
  { number: 58, name: 'The Joyous Lake', theme: 'open exchange and shared encouragement' },
  { number: 59, name: 'Dispersion', theme: 'dissolving barriers that prevent connection' },
  { number: 60, name: 'Limitation', theme: 'useful boundaries without needless restriction' },
  { number: 61, name: 'Inner Truth', theme: 'sincerity that makes trust possible' },
  { number: 62, name: 'Preponderance of the Small', theme: 'careful attention to modest details' },
  { number: 63, name: 'After Completion', theme: 'staying attentive when order has been achieved' },
  { number: 64, name: 'Before Completion', theme: 'care at the threshold of a new order' },
] as const

/** Stable 32-bit FNV-1a hash for seeds, record IDs, and tie-breaking. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

/** Mulberry32: compact, deterministic, and suitable for game presentation. */
export function createSeededRandom(seed: string | number): () => number {
  let state = typeof seed === 'number' ? seed >>> 0 : hashString(seed)

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000
  }
}

export function deterministicShuffle<T>(values: readonly T[], seed: string | number): T[] {
  const shuffled = [...values]
  const random = createSeededRandom(seed)

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[swapIndex]
    shuffled[swapIndex] = current
  }

  return shuffled
}

export function normalizeProblemInput(problem: string): string {
  return problem.replace(/\s+/g, ' ').trim()
}

export function problemPartAt(parts: readonly ProblemPart[], coord: CellCoord): ProblemPart {
  if (parts.length !== BOARD_RING_COUNT * BOARD_SECTOR_COUNT) {
    throw new Error(`A WebChess board requires exactly 64 problem parts; received ${parts.length}.`)
  }

  if (
    !Number.isInteger(coord.ring) ||
    !Number.isInteger(coord.sector) ||
    coord.ring < 0 ||
    coord.ring >= BOARD_RING_COUNT ||
    coord.sector < 0 ||
    coord.sector >= BOARD_SECTOR_COUNT
  ) {
    throw new Error(`Invalid board coordinate (${coord.ring}, ${coord.sector}).`)
  }

  return parts[coord.ring * BOARD_SECTOR_COUNT + coord.sector]
}

export const partAt = problemPartAt
