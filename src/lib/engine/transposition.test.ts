import { describe, expect, it } from 'vitest'

import {
  TT_EXACT,
  TT_LOWER_BOUND,
  TranspositionTable,
} from './transposition'

describe('transposition table', () => {
  it('round-trips an entry only for the complete position and draw state', () => {
    const table = new TranspositionTable(1_024)
    table.store(0x12345678, 0x90abcdef, 7, 201, {
      depth: 5,
      score: 314,
      flag: TT_EXACT,
      bestMove: 42,
    })

    expect(table.probe(0x12345678, 0x90abcdef, 7, 201)).toEqual({
      depth: 5,
      score: 314,
      flag: TT_EXACT,
      bestMove: 42,
    })
    expect(table.probe(0x12345678, 0x90abcdef, 8, 201)).toBeNull()
    expect(table.probe(0x12345678, 0x90abcdef, 7, 200)).toBeNull()
    expect(table.probe(0x12345679, 0x90abcdef, 7, 201)).toBeNull()
  })

  it('keeps a deeper bound for the same state but accepts an exact replacement', () => {
    const table = new TranspositionTable(1_024)
    table.store(1, 2, 3, 4, {
      depth: 8,
      score: 80,
      flag: TT_LOWER_BOUND,
      bestMove: 12,
    })
    table.store(1, 2, 3, 4, {
      depth: 4,
      score: 40,
      flag: TT_LOWER_BOUND,
      bestMove: 24,
    })
    expect(table.probe(1, 2, 3, 4)?.bestMove).toBe(12)

    table.store(1, 2, 3, 4, {
      depth: 4,
      score: 41,
      flag: TT_EXACT,
      bestMove: 25,
    })
    expect(table.probe(1, 2, 3, 4)).toMatchObject({
      depth: 4,
      score: 41,
      flag: TT_EXACT,
      bestMove: 25,
    })
  })

  it('clears entries without reallocating the table', () => {
    const table = new TranspositionTable(1_024)
    table.store(11, 22, 0, 256, {
      depth: 1,
      score: 0,
      flag: TT_EXACT,
      bestMove: 9,
    })
    table.clear()
    expect(table.probe(11, 22, 0, 256)).toBeNull()
  })
})
