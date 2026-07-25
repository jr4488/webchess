import type {
  CaptureRecord,
  FinalReading,
  Piece,
  PieceKind,
  ProblemPart,
  ReadingSection,
  Side,
} from '../types'

export interface PieceMetaphor {
  /** Short, UI-friendly name for the kind of attention this piece represents. */
  label: string
  /** What this piece asks the player to notice. */
  role: string
  /** A concrete way to use that attention in the reading. */
  action: string
}

export const PIECE_METAPHORS: Readonly<Record<PieceKind, PieceMetaphor>> = {
  king: {
    label: 'Core purpose',
    role: 'the outcome that must remain protected',
    action: 'name the non-negotiable outcome',
  },
  queen: {
    label: 'Agency',
    role: 'the options, influence, and resources available',
    action: 'compare the available levers',
  },
  rook: {
    label: 'Structure',
    role: 'the rules, boundaries, and systems holding things in place',
    action: 'make the governing constraint explicit',
  },
  bishop: {
    label: 'Perspective',
    role: 'the values and assumptions shaping interpretation',
    action: 'test the assumption behind the current view',
  },
  knight: {
    label: 'Reframing',
    role: 'an indirect route or useful change of viewpoint',
    action: 'try one materially different framing',
  },
  pawn: {
    label: 'Practice',
    role: 'the facts, effort, and small steps closest to the work',
    action: 'take the smallest observable next step',
  },
}

const SIDE_DIRECTION: Readonly<Record<Side, string>> = {
  white: 'outside-in evidence',
  black: 'inside-out intent',
}

const MAX_SIGNALS = 3

const capitalise = (value: string): string =>
  value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`

const clean = (value: string, fallback: string): string => {
  const result = value.trim().replace(/\s+/g, ' ')
  return result.length > 0 ? result : fallback
}

const endSentence = (value: string): string =>
  /[.!?]$/.test(value) ? value : `${value}.`

/**
 * Explain a capture as a clash between two useful modes of attention.
 * This sentence is suitable for the move animation as well as the final reading.
 */
export function captureNarration(
  attacker: Piece,
  captured: Piece,
  part: ProblemPart,
): string {
  const active = PIECE_METAPHORS[attacker.kind]
  const challenged = PIECE_METAPHORS[captured.kind]
  const facet = clean(part.title, clean(part.keyword, 'this part of the problem'))
  const focus = clean(part.focus, clean(part.theme, part.keyword))
  const theme = clean(part.theme, focus)
  const dimension = clean(part.dimension, 'the situation')

  return `${capitalise(attacker.side)} ${capitalise(attacker.kind)} (${active.label.toLowerCase()}) brings ${
    SIDE_DIRECTION[attacker.side]
  } into conflict with ${capitalise(captured.side)} ${capitalise(captured.kind)} (${challenged.label.toLowerCase()}), putting ${
    challenged.role
  } under review. In ${dimension}, examine “${facet}”: ${focus}. Its I Ching pairing, ${part.hexagramName}, adds ${theme}.`
}

interface RankedSignal {
  capture: CaptureRecord
  occurrences: number
  score: number
  originalIndex: number
}

const safeResonance = (capture: CaptureRecord): number =>
  Number.isFinite(capture.resonance) ? capture.resonance : Number.NEGATIVE_INFINITY

const compareCaptures = (left: CaptureRecord, right: CaptureRecord): number =>
  safeResonance(right) - safeResonance(left) ||
  left.turn - right.turn ||
  left.id.localeCompare(right.id)

const rankCaptureSignals = (captures: readonly CaptureRecord[]): RankedSignal[] => {
  const groups = new Map<number, Array<{ capture: CaptureRecord; originalIndex: number }>>()
  captures.forEach((capture, originalIndex) => {
    const group = groups.get(capture.part.id) ?? []
    group.push({ capture, originalIndex })
    groups.set(capture.part.id, group)
  })

  return [...groups.values()]
    .map((group): RankedSignal => {
      const representative = [...group].sort((left, right) =>
        compareCaptures(left.capture, right.capture) || left.originalIndex - right.originalIndex,
      )[0]
      const recurrenceLift = 1 + Math.min(3, group.length - 1) * 0.08
      return {
        capture: representative.capture,
        occurrences: group.length,
        score: safeResonance(representative.capture) * recurrenceLift,
        originalIndex: representative.originalIndex,
      }
    })
    .sort((left, right) =>
      right.score - left.score ||
      compareCaptures(left.capture, right.capture) ||
      left.originalIndex - right.originalIndex,
    )
}

const hash = (value: string): number => {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

const provisionalParts = (
  problem: string,
  mappedParts: readonly ProblemPart[],
): ProblemPart[] => {
  if (mappedParts.length === 0) return []

  const scored = mappedParts.map((part, originalIndex) => ({
    part,
    originalIndex,
    score: hash(`${problem}|${part.id}|${part.keyword}|${part.dimension}`),
  }))

  scored.sort(
    (left, right) =>
      left.score - right.score ||
      left.part.id - right.part.id ||
      left.originalIndex - right.originalIndex,
  )

  return scored.slice(0, Math.min(2, scored.length)).map(({ part }) => part)
}

const partTitle = (part: ProblemPart): string => {
  return clean(part.title, clean(part.keyword, `Part ${part.id}`))
}

const promptFor = (part: ProblemPart): string =>
  endSentence(clean(part.prompt, `What would change your view of ${part.theme}?`))

const captureSection = (
  capture: CaptureRecord,
  rank: number,
  occurrences: number,
): ReadingSection => {
  const attacker = PIECE_METAPHORS[capture.attacker.kind]
  const challenged = PIECE_METAPHORS[capture.captured.kind]
  const movement = clean(capture.part.movement, 'look for what is changing')
  const narration = captureNarration(capture.attacker, capture.captured, capture.part)

  return {
    label: `${rank === 0 ? 'Strongest signal' : `Supporting signal ${rank + 1}`}${
      occurrences > 1 ? ` · returned ${occurrences} times` : ''
    }`,
    title: partTitle(capture.part),
    body: `${narration} ${capitalise(attacker.action)}; use that to reassess ${
      challenged.role
    }. Change cue: ${endSentence(movement)} Write a one-sentence answer to: ${promptFor(
      capture.part,
    )}`,
    partIds: [capture.part.id],
    captureId: capture.id,
  }
}

const provisionalSection = (part: ProblemPart, index: number): ReadingSection => ({
  label: index === 0 ? 'Starting facet' : 'Counterpoint',
  title: partTitle(part),
  body: `No capture has prioritised this yet, so treat it as a hypothesis. In ${clean(
    part.dimension,
    'this area',
  )}, ${endSentence(clean(part.movement, 'notice what may be changing'))} Write a one-sentence answer to: ${promptFor(
    part,
  )}`,
  partIds: [part.id],
})

const summaryForCaptures = (
  problem: string,
  selected: readonly CaptureRecord[],
): string => {
  const primary = selected[0]
  const attacker = PIECE_METAPHORS[primary.attacker.kind]
  const challenged = PIECE_METAPHORS[primary.captured.kind]
  const primaryTheme = clean(primary.part.focus, clean(primary.part.theme, primary.part.keyword))
  const secondary = selected[1]
    ? ` Check that against ${clean(selected[1].part.focus, clean(selected[1].part.theme, selected[1].part.keyword))} before committing.`
    : ''

  return `For “${problem}”, the board’s answer is to ${attacker.action} around ${primaryTheme} first. Let ${challenged.role} set the boundary for the larger decision.${secondary}`
}

const closingForCaptures = (selected: readonly CaptureRecord[]): string => {
  const primary = selected[0]
  const primaryAction = PIECE_METAPHORS[primary.attacker.kind].action
  const keyword = clean(primary.part.title, clean(primary.part.keyword, primary.part.theme))

  return `Next move: ${primaryAction}, record one observable result about “${keyword}”, and revise the decision only from that result. The I Ching-inspired polarity here describes change between outside-in evidence and inside-out intent; it is a thinking aid, not a prediction.`
}

/**
 * Turn the board's strongest capture signals into a concise, actionable reading.
 * Identical inputs always produce identical output.
 */
export function synthesizeReading(
  problem: string,
  captures: readonly CaptureRecord[],
  mappedParts: readonly ProblemPart[],
): FinalReading {
  const subject = clean(problem, 'the problem you brought to the board')
  const selectedSignals = rankCaptureSignals(captures).slice(0, MAX_SIGNALS)
  const selected = selectedSignals.map(({ capture }) => capture)

  if (selected.length > 0) {
    const primaryKeyword = clean(
      selected[0].part.title,
      clean(selected[0].part.keyword, selected[0].part.theme),
    )
    return {
      title: `Answer: ${primaryKeyword}`,
      summary: summaryForCaptures(subject, selected),
      sections: selectedSignals.map((signal, index) =>
        captureSection(signal.capture, index, signal.occurrences),
      ),
      closing: closingForCaptures(selected),
    }
  }

  const anchors = provisionalParts(subject, mappedParts)
  if (anchors.length === 0) {
    return {
      title: 'Direction: gather a signal',
      summary: `For “${subject}”, the board has no captured or mapped parts to weigh yet. There is not enough evidence for a responsible answer.`,
      sections: [],
      closing:
        'Next move: divide the problem into concrete parts, map them to the board, and play until a conflict identifies what deserves closer attention. The I Ching-inspired polarity is a framework for noticing change, not a prediction.',
    }
  }

  return {
    title: 'Direction: begin with a test',
    summary: `For “${subject}”, no capture has yet made one concern more important than another. Begin with these mapped facets, but keep the conclusion provisional.`,
    sections: anchors.map(provisionalSection),
    closing:
      'Next move: answer the starting prompt, make one small reversible test, and continue play to see which tension earns more attention. The I Ching-inspired polarity is a framework for noticing change, not a prediction.',
  }
}
