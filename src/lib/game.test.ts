import { describe, expect, it } from 'vitest'
import type { CellCoord, Piece } from '../types'
import { makeProblemParts } from '../test/fixtures'
import { problemPartAt } from './problem'
import {
  applyMove,
  captureAttentionWeight,
  chooseAutoMove,
  coordKey,
  createInitialPieces,
  getGameOutcome,
  getLegalMoves,
  isSameCoord,
} from './game'

function piece(
  id: string,
  side: Piece['side'],
  kind: Piece['kind'],
  ring: number,
  sector: number,
  moved = true,
): Piece {
  return { id, side, kind, position: { ring, sector }, moved }
}

function keys(coords: readonly CellCoord[]): string[] {
  return coords.map(coordKey)
}

describe('polar chess setup', () => {
  it('places Black inside and White outside with standard piece counts', () => {
    const pieces = createInitialPieces()

    expect(pieces).toHaveLength(32)
    expect(new Set(pieces.map((entry) => entry.id)).size).toBe(32)
    expect(pieces.filter((entry) => entry.side === 'black' && entry.position.ring === 0)).toHaveLength(8)
    expect(pieces.filter((entry) => entry.side === 'black' && entry.position.ring === 1)).toHaveLength(8)
    expect(pieces.filter((entry) => entry.side === 'white' && entry.position.ring === 6)).toHaveLength(8)
    expect(pieces.filter((entry) => entry.side === 'white' && entry.position.ring === 7)).toHaveLength(8)
    expect(pieces.filter((entry) => entry.kind === 'king')).toHaveLength(2)
    expect(pieces.filter((entry) => entry.kind === 'queen')).toHaveLength(2)
  })
})

describe('polar legal moves', () => {
  it('wraps angular rook movement and stops rays at collisions', () => {
    const rook = piece('white-rook', 'white', 'rook', 3, 0)
    const friendly = piece('white-pawn', 'white', 'pawn', 3, 2)
    const enemy = piece('black-bishop', 'black', 'bishop', 3, 6)
    const moves = keys(getLegalMoves(rook, [rook, friendly, enemy]))

    expect(moves).toContain('3:7')
    expect(moves).toContain('3:6')
    expect(moves).toContain('3:1')
    expect(moves).not.toContain('3:2')
    expect(moves).not.toContain('3:5')
    expect(new Set(moves).size).toBe(moves.length)
  })

  it('wraps bishop and knight sectors while keeping rings bounded', () => {
    const bishop = piece('bishop', 'white', 'bishop', 1, 0)
    const knight = piece('knight', 'black', 'knight', 1, 0)

    expect(keys(getLegalMoves(bishop, [bishop]))).toContain('2:7')
    expect(keys(getLegalMoves(knight, [knight]))).toEqual(
      expect.arrayContaining(['2:6', '3:7']),
    )
    expect(getLegalMoves(knight, [knight]).every(({ ring }) => ring >= 0 && ring < 8)).toBe(true)
  })

  it('moves pawns outward for Black and inward for White, including wrapped captures', () => {
    const blackPawn = piece('black-pawn', 'black', 'pawn', 1, 0, false)
    const whitePawn = piece('white-pawn', 'white', 'pawn', 6, 3, false)
    const whiteTarget = piece('white-target', 'white', 'rook', 2, 7)
    const pieces = [blackPawn, whitePawn, whiteTarget]

    expect(keys(getLegalMoves(blackPawn, pieces))).toEqual(
      expect.arrayContaining(['2:0', '3:0', '2:7']),
    )
    expect(keys(getLegalMoves(whitePawn, pieces))).toEqual(
      expect.arrayContaining(['5:3', '4:3']),
    )
    expect(keys(getLegalMoves(whitePawn, pieces))).not.toContain('7:3')
  })

  it('does not allow a sliding piece to pass through a capture', () => {
    const queen = piece('queen', 'white', 'queen', 4, 4)
    const target = piece('target', 'black', 'pawn', 2, 2)
    const moves = keys(getLegalMoves(queen, [queen, target]))

    expect(moves).toContain('2:2')
    expect(moves).not.toContain('1:1')
  })
})

describe('moves and captures', () => {
  it('applies a capture immutably and attaches the problem lens', () => {
    const attacker = piece('white-rook', 'white', 'rook', 4, 0)
    const target = piece('black-pawn', 'black', 'pawn', 2, 0)
    const original = [attacker, target]
    const parts = makeProblemParts('project momentum')
    const result = applyMove(original, attacker.id, target.position, parts, 7)

    expect(original).toEqual([attacker, target])
    expect(result.pieces).toHaveLength(1)
    expect(result.pieces[0]).toMatchObject({
      id: attacker.id,
      position: { ring: 2, sector: 0 },
      moved: true,
    })
    expect(result.capture).toMatchObject({
      turn: 7,
      cell: { ring: 2, sector: 0 },
      captured: { id: target.id },
      part: problemPartAt(parts, { ring: 2, sector: 0 }),
    })
    expect(result.capture?.narration).toContain('under review')
    expect(result.capture?.narration).toContain(result.capture?.part.theme)
    expect(result.capture?.resonance).toBeGreaterThanOrEqual(55)
    expect(result.capture?.resonance).toBeLessThanOrEqual(95)
  })

  it('gives explainably more attention to central conflicts over important roles', () => {
    const strong = captureAttentionWeight(
      piece('white-king', 'white', 'king', 4, 0),
      piece('black-queen', 'black', 'queen', 3, 0),
      { ring: 3, sector: 0 },
    )
    const light = captureAttentionWeight(
      piece('white-pawn', 'white', 'pawn', 7, 0),
      piece('black-pawn', 'black', 'pawn', 7, 1),
      { ring: 7, sector: 1 },
    )

    expect(strong).toBeGreaterThan(light)
    expect(strong).toBeLessThanOrEqual(95)
  })

  it('promotes a pawn at the opposite radial edge', () => {
    const pawn = piece('black-pawn', 'black', 'pawn', 6, 4)
    const parts = makeProblemParts('growth')
    const result = applyMove([pawn], pawn.id, { ring: 7, sector: 4 }, parts, 12)

    expect(result.pieces[0].kind).toBe('queen')
    expect(result.promoted).toMatchObject({ id: pawn.id, kind: 'queen' })
  })

  it('rejects illegal moves', () => {
    const rook = piece('rook', 'white', 'rook', 3, 0)
    const blocker = piece('blocker', 'white', 'pawn', 4, 0)
    const parts = makeProblemParts('blocked')

    expect(() => applyMove([rook, blocker], rook.id, { ring: 5, sector: 0 }, parts)).toThrow(
      /Illegal move/,
    )
  })

  it('chooses deterministically and always favors an available capture', () => {
    const attacker = piece('white-rook', 'white', 'rook', 4, 0)
    const target = piece('black-queen', 'black', 'queen', 4, 2)
    const other = piece('white-knight', 'white', 'knight', 6, 5)
    const pieces = [attacker, target, other]

    const first = chooseAutoMove(pieces, 'white', 'turn-4')
    const replay = chooseAutoMove(pieces, 'white', 'turn-4')

    expect(replay).toEqual(first)
    expect(first).toMatchObject({ pieceId: attacker.id, to: target.position })
    expect(first?.captured?.id).toBe(target.id)
  })

  it('treats capturing the opposing king as the decisive capture', () => {
    const rook = piece('white-rook', 'white', 'rook', 4, 0)
    const whiteKing = piece('white-king', 'white', 'king', 7, 4)
    const blackQueen = piece('black-queen', 'black', 'queen', 4, 2)
    const blackKing = piece('black-king', 'black', 'king', 2, 0)

    const choice = chooseAutoMove(
      [rook, whiteKing, blackQueen, blackKing],
      'white',
      'king-value',
    )

    expect(choice).toMatchObject({ pieceId: rook.id, to: blackKing.position })
    expect(choice?.captured?.kind).toBe('king')
  })

  it('prefers taking a more consequential piece when two captures are available', () => {
    const rook = piece('white-rook', 'white', 'rook', 4, 0)
    const pawn = piece('black-pawn', 'black', 'pawn', 4, 1)
    const queen = piece('black-queen', 'black', 'queen', 2, 0)

    const choice = chooseAutoMove([rook, pawn, queen], 'white', 'capture-value')

    expect(choice).toMatchObject({ pieceId: rook.id, to: queen.position })
    expect(choice?.captured?.kind).toBe('queen')
  })

  it('avoids a high-progress destination where the moving piece can be taken immediately', () => {
    const rook = piece('white-rook', 'white', 'rook', 6, 0)
    const whiteKing = piece('white-king', 'white', 'king', 7, 4)
    const attackingRook = piece('black-rook', 'black', 'rook', 0, 1)
    const blackKing = piece('black-king', 'black', 'king', 7, 7)

    const choice = chooseAutoMove(
      [rook, whiteKing, attackingRook, blackKing],
      'white',
      'safe-progress',
    )

    expect(choice).toMatchObject({ pieceId: rook.id, to: { ring: 1, sector: 0 } })
    expect(choice?.to).not.toEqual({ ring: 0, sector: 0 })
  })

  it('keeps a blocker in place when moving it would expose its own king', () => {
    const whiteKing = piece('white-king', 'white', 'king', 5, 1)
    const blockingRook = piece('white-rook', 'white', 'rook', 4, 0)
    const safePawn = piece('white-pawn', 'white', 'pawn', 6, 4)
    const attackingBishop = piece('black-bishop', 'black', 'bishop', 2, 6)
    const blackKing = piece('black-king', 'black', 'king', 0, 3)

    const choice = chooseAutoMove(
      [whiteKing, blockingRook, safePawn, attackingBishop, blackKing],
      'white',
      'protect-king',
    )

    expect(choice?.pieceId).toBe(safePawn.id)
  })

  it('turns back from the far edge to converge on an opposing piece', () => {
    const whiteKing = piece('white-king', 'white', 'king', 0, 0)
    const blackKing = piece('black-king', 'black', 'king', 7, 0)

    const choice = chooseAutoMove([whiteKing, blackKing], 'white', 'edge-convergence')

    expect(choice).toMatchObject({
      pieceId: whiteKing.id,
      from: whiteKing.position,
      to: { ring: 1, sector: 0 },
    })
  })

  it('prefers a move that puts direct pressure on the opposing king', () => {
    const rook = piece('white-rook', 'white', 'rook', 4, 0)
    const whiteKing = piece('white-king', 'white', 'king', 7, 7)
    const blackKing = piece('black-king', 'black', 'king', 2, 2)

    const choice = chooseAutoMove([rook, whiteKing, blackKing], 'white', 'king-pressure')

    expect(choice).toMatchObject({ pieceId: rook.id, to: { ring: 2, sector: 0 } })
  })

  it('drives an alternating replay from setup toward capture signals', () => {
    const parts = makeProblemParts('speed and care')
    let pieces = createInitialPieces()
    let captureCount = 0

    for (let turn = 1; turn <= 24; turn += 1) {
      const side = turn % 2 === 1 ? 'white' : 'black'
      const move = chooseAutoMove(pieces, side, `replay-${turn}`)
      expect(move).not.toBeNull()
      if (!move) break

      const result = applyMove(pieces, move.pieceId, move.to, parts, turn)
      pieces = result.pieces
      if (result.capture) captureCount += 1
    }

    expect(captureCount).toBeGreaterThan(0)
  })

  it('returns null when a side has no pieces or legal moves', () => {
    expect(chooseAutoMove([], 'black', 1)).toBeNull()

    const trappedPawn = piece('pawn', 'white', 'pawn', 0, 0)
    expect(chooseAutoMove([trappedPawn], 'white', 1)).toBeNull()
  })

  it('normalizes sector comparisons around the seam', () => {
    expect(isSameCoord({ ring: 2, sector: -1 }, { ring: 2, sector: 7 })).toBe(true)
  })
})

describe('complete-game endings', () => {
  it('ends immediately when a Core Purpose is captured', () => {
    const whiteKing = piece('white-king', 'white', 'king', 7, 4)
    const blackRook = piece('black-rook', 'black', 'rook', 4, 2)

    expect(getGameOutcome([whiteKing, blackRook], { quietPlies: 0, ply: 29 })).toEqual({
      winner: 'white',
      reason: 'king-captured',
      completedTurn: 29,
    })
  })

  it('ends a motionless position as a standstill', () => {
    const whiteKing = piece('white-king', 'white', 'king', -1, 0)
    const blackKing = piece('black-king', 'black', 'king', 8, 0)

    expect(getGameOutcome([whiteKing, blackKing], { quietPlies: 0, ply: 12 })).toEqual({
      winner: null,
      reason: 'no-moves',
      completedTurn: 12,
    })
  })

  it('uses no-progress and move limits as deterministic safety endings', () => {
    const whiteKing = piece('white-king', 'white', 'king', 7, 4)
    const blackKing = piece('black-king', 'black', 'king', 0, 4)

    expect(getGameOutcome([whiteKing, blackKing], { quietPlies: 100, ply: 120 }))
      .toMatchObject({ reason: 'no-progress', winner: null })
    expect(getGameOutcome([whiteKing, blackKing], { quietPlies: 20, ply: 256 }))
      .toMatchObject({ reason: 'move-limit', winner: null })
  })
})
