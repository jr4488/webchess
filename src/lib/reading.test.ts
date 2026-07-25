import { describe, expect, it } from 'vitest'

import type { CaptureRecord, Piece, PieceKind, ProblemPart } from '../types'
import {
  PIECE_METAPHORS,
  captureNarration,
  synthesizeReading,
} from './reading'

const part = (id: number, keyword: string): ProblemPart => ({
  id,
  title: `${keyword} facet`,
  focus: `${keyword} focus`,
  hexagram: id,
  hexagramName: `Hexagram ${id}`,
  theme: `${keyword} theme`,
  dimension: `${keyword} dimension`,
  movement: `${keyword} is becoming more specific`,
  prompt: `What evidence would clarify ${keyword}?`,
  keyword,
})

const piece = (id: string, kind: PieceKind, side: 'white' | 'black'): Piece => ({
  id,
  kind,
  side,
  position: { ring: 1, sector: 2 },
  moved: false,
})

const capture = (
  id: string,
  resonance: number,
  problemPart: ProblemPart,
  attackerKind: PieceKind = 'knight',
  capturedKind: PieceKind = 'rook',
  turn = 1,
): CaptureRecord => {
  const attacker = piece(`${id}-attacker`, attackerKind, 'white')
  const captured = piece(`${id}-captured`, capturedKind, 'black')
  return {
    id,
    turn,
    attacker,
    captured,
    cell: { ring: 2, sector: 3 },
    part: problemPart,
    resonance,
    narration: captureNarration(attacker, captured, problemPart),
  }
}

describe('PIECE_METAPHORS', () => {
  it('defines an actionable role for every chess piece', () => {
    expect(Object.keys(PIECE_METAPHORS).sort()).toEqual([
      'bishop',
      'king',
      'knight',
      'pawn',
      'queen',
      'rook',
    ])
    for (const metaphor of Object.values(PIECE_METAPHORS)) {
      expect(metaphor.role).not.toBe('')
      expect(metaphor.action).not.toBe('')
    }
  })
})

describe('captureNarration', () => {
  it('connects attacker, captured role, polarity, and problem part', () => {
    const signal = part(12, 'constraints')
    const result = captureNarration(
      piece('w-knight', 'knight', 'white'),
      piece('b-rook', 'rook', 'black'),
      signal,
    )

    expect(result).toContain('White Knight (reframing)')
    expect(result).toContain('outside-in evidence')
    expect(result).toContain('Black Rook (structure)')
    expect(result).toContain(signal.theme)
    expect(result).toContain(signal.dimension)
  })

  it('uses inside-out intent when black is the attacker', () => {
    const signal = part(29, 'commitment')
    const result = captureNarration(
      piece('b-bishop', 'bishop', 'black'),
      piece('w-queen', 'queen', 'white'),
      signal,
    )

    expect(result).toContain('Black Bishop (perspective)')
    expect(result).toContain('inside-out intent')
    expect(result).toContain('White Queen (agency)')
  })
})

describe('synthesizeReading', () => {
  it('produces a deterministic provisional reading with no captures', () => {
    const mapped = [part(1, 'scope'), part(2, 'timing'), part(3, 'ownership')]

    const first = synthesizeReading('How should we launch?', [], mapped)
    const second = synthesizeReading('How should we launch?', [], [...mapped].reverse())

    expect(first).toEqual(second)
    expect(first.summary).toContain('no capture')
    expect(first.sections).toHaveLength(2)
    expect(first.sections.every((section) => section.partIds.length === 1)).toBe(true)
    expect(first.closing).toContain('not a prediction')
  })

  it('returns an honest next step when no parts have been mapped', () => {
    const reading = synthesizeReading('Choose a direction', [], [])

    expect(reading.sections).toEqual([])
    expect(reading.summary).toContain('not enough evidence')
    expect(reading.closing).toContain('divide the problem')
  })

  it('uses the most resonant capture and both piece roles', () => {
    const scope = part(8, 'scope')
    const reading = synthesizeReading(
      'Should we expand?',
      [capture('scope-capture', 0.82, scope, 'queen', 'king')],
      [scope],
    )

    expect(reading.title).toContain('scope')
    expect(reading.sections).toHaveLength(1)
    expect(reading.sections[0].body.toLowerCase()).toContain(
      PIECE_METAPHORS.queen.action,
    )
    expect(reading.sections[0].body).toContain(PIECE_METAPHORS.king.role)
    expect(reading.sections[0].partIds).toEqual([8])
  })

  it('ranks up to three captures by resonance with deterministic tie breaks', () => {
    const low = capture('low', 0.2, part(1, 'cost'), 'pawn', 'queen', 1)
    const laterTie = capture('z-tie', 0.9, part(2, 'trust'), 'bishop', 'knight', 4)
    const earlierTie = capture('a-tie', 0.9, part(3, 'timing'), 'rook', 'pawn', 2)
    const fourth = capture('fourth', 0.1, part(4, 'scope'), 'king', 'bishop', 5)

    const reading = synthesizeReading(
      'What should change first?',
      [low, laterTie, earlierTie, fourth],
      [low.part, laterTie.part, earlierTie.part, fourth.part],
    )

    expect(reading.sections.map((section) => section.partIds[0])).toEqual([3, 2, 1])
    expect(reading.sections).toHaveLength(3)
    expect(reading.summary).toContain(earlierTie.part.focus)
    expect(reading.closing).toContain('outside-in evidence and inside-out intent')
  })

  it('combines repeated conflict on one part into one stronger signal', () => {
    const repeated = part(7, 'purpose')
    const timing = part(8, 'timing')
    const reading = synthesizeReading(
      'How should this change?',
      [
        capture('purpose-first', 70, repeated, 'pawn', 'rook', 2),
        capture('timing', 74, timing, 'bishop', 'pawn', 3),
        capture('purpose-return', 72, repeated, 'king', 'queen', 5),
      ],
      [repeated, timing],
    )

    expect(reading.sections).toHaveLength(2)
    expect(reading.sections[0].partIds).toEqual([7])
    expect(reading.sections[0].label).toContain('returned 2 times')
    expect(new Set(reading.sections.flatMap((section) => section.partIds)).size).toBe(2)
  })
})
