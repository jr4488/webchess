import { describe, expect, it } from 'vitest'

import { forcedPassPieces, pieceAt } from '../test/engine-fixtures'
import { makeProblemParts } from '../test/fixtures'
import {
  CURRENT_GAME_VERSIONS,
  GAME_EVENT_VERSION,
  WEBCHESS_CAST_VERSION,
  WEBCHESS_ENGINE_VERSION,
  WEBCHESS_RULES_VERSION,
} from './game-contract'
import type { ReplayState } from './game-contract'
import {
  acceptMoveCommand,
  createReplayState,
  GameRuleError,
  isCurrentGameVersions,
  replayGameEvents,
  settleForcedPasses,
  toGameView,
  validateReplay,
} from './game-replay'

const parts = makeProblemParts('canonical-replay')

function forcedPassState(overrides: Partial<ReplayState> = {}): ReplayState {
  return {
    ...createReplayState(),
    pieces: forcedPassPieces(),
    turn: 'white',
    outcome: null,
    ...overrides,
  }
}

describe('game provenance contract', () => {
  it('pins stable event, rules, cast, and engine identifiers', () => {
    expect(CURRENT_GAME_VERSIONS).toEqual({
      event: 1,
      rules: 'circular-direct-king-v1',
      cast: 'independent-three-shuffle-v1',
      engine: 'engine-v2',
    })
    expect(GAME_EVENT_VERSION).toBe(1)
    expect(WEBCHESS_RULES_VERSION).toBe('circular-direct-king-v1')
    expect(WEBCHESS_CAST_VERSION).toBe('independent-three-shuffle-v1')
    expect(WEBCHESS_ENGINE_VERSION).toBe('engine-v2')
    expect(isCurrentGameVersions({ ...CURRENT_GAME_VERSIONS })).toBe(true)
    expect(isCurrentGameVersions({ ...CURRENT_GAME_VERSIONS, engine: 'future' })).toBe(false)
    expect(isCurrentGameVersions(null)).toBe(false)
  })

  it('always starts replay from the canonical setup with White to move', () => {
    const state = createReplayState()

    expect(state.pieces).toHaveLength(32)
    expect(state.turn).toBe('white')
    expect(state.completedPlies).toBe(0)
    expect(state.quietPlies).toBe(0)
    expect(state.events).toEqual([])
    expect(state.captures).toEqual([])
    expect(state.outcome).toBeNull()
  })
})

describe('authoritative move acceptance', () => {
  it('derives the complete canonical move event from a small client command', () => {
    const accepted = acceptMoveCommand(
      createReplayState(),
      {
        expectedPly: 1,
        pieceId: 'white-pawn-1',
        to: { ring: 4, sector: 0 },
      },
      parts,
    )

    expect(accepted.appendedEvents).toEqual([
      {
        version: 1,
        type: 'move',
        ply: 1,
        side: 'white',
        pieceId: 'white-pawn-1',
        from: { ring: 6, sector: 0 },
        to: { ring: 4, sector: 0 },
      },
    ])
    expect(accepted.state).toMatchObject({
      turn: 'black',
      completedPlies: 1,
      quietPlies: 1,
      lastMove: {
        from: { ring: 6, sector: 0 },
        to: { ring: 4, sector: 0 },
      },
      outcome: null,
    })
  })

  it('rejects stale plies, wrong-side pieces, non-canonical coordinates, and illegal paths', () => {
    const state = createReplayState()
    const cases = [
      {
        command: { expectedPly: 2, pieceId: 'white-pawn-1', to: { ring: 5, sector: 0 } },
        code: 'stale-ply',
      },
      {
        command: { expectedPly: 0, pieceId: 'white-pawn-1', to: { ring: 5, sector: 0 } },
        code: 'stale-ply',
      },
      {
        command: { expectedPly: 1, pieceId: ' ', to: { ring: 5, sector: 0 } },
        code: 'invalid-piece',
      },
      {
        command: { expectedPly: 1, pieceId: 'missing', to: { ring: 5, sector: 0 } },
        code: 'invalid-piece',
      },
      {
        command: { expectedPly: 1, pieceId: 'black-pawn-1', to: { ring: 2, sector: 0 } },
        code: 'wrong-side',
      },
      {
        command: { expectedPly: 1, pieceId: 'white-pawn-1', to: { ring: 5, sector: 8 } },
        code: 'invalid-coordinate',
      },
      {
        command: { expectedPly: 1, pieceId: 'white-pawn-1', to: { ring: 6, sector: 1 } },
        code: 'illegal-move',
      },
    ] as const

    for (const testCase of cases) {
      try {
        acceptMoveCommand(state, testCase.command, parts)
        throw new Error(`Expected ${testCase.code}.`)
      } catch (error) {
        expect(error).toBeInstanceOf(GameRuleError)
        expect((error as GameRuleError).code).toBe(testCase.code)
      }
    }
  })

  it('derives forced passes before and after moves instead of accepting them from clients', () => {
    const openingPass = settleForcedPasses(forcedPassState())

    expect(openingPass.appendedEvents).toEqual([
      {
        version: 1,
        type: 'forced-pass',
        ply: 1,
        side: 'white',
        reason: 'no-legal-move',
      },
    ])
    expect(openingPass.state).toMatchObject({
      turn: 'black',
      completedPlies: 1,
      quietPlies: 1,
    })

    const accepted = acceptMoveCommand(
      openingPass.state,
      {
        expectedPly: 2,
        pieceId: 'black-king',
        to: { ring: 4, sector: 5 },
      },
      parts,
    )

    expect(accepted.appendedEvents.map((event) => event.type)).toEqual([
      'move',
      'forced-pass',
    ])
    expect(accepted.appendedEvents[1]).toMatchObject({
      ply: 3,
      side: 'white',
      reason: 'no-legal-move',
    })
    expect(accepted.state).toMatchObject({
      turn: 'black',
      completedPlies: 3,
      quietPlies: 3,
    })
  })

  it('increments quiet time to one when a capture is followed by a forced pass', () => {
    const state = forcedPassState({
      pieces: [
        ...forcedPassPieces(),
        pieceAt('white-target', 'white', 'rook', 4, 5),
      ],
      turn: 'black',
    })

    const accepted = acceptMoveCommand(
      state,
      {
        expectedPly: 1,
        pieceId: 'black-king',
        to: { ring: 4, sector: 5 },
      },
      parts,
    )

    expect(accepted.appendedEvents.map((event) => event.type)).toEqual([
      'move',
      'forced-pass',
    ])
    expect(accepted.state.captures).toHaveLength(1)
    expect(accepted.state.quietPlies).toBe(1)
  })

  it('ends mutual immobility without inventing a pass', () => {
    const state = forcedPassState({
      pieces: [
        pieceAt('white-king', 'white', 'king', 0, 0),
        pieceAt('white-pawn-0-7', 'white', 'pawn', 0, 7),
        pieceAt('white-pawn-0-1', 'white', 'pawn', 0, 1),
        pieceAt('white-pawn-1-7', 'white', 'pawn', 1, 7),
        pieceAt('white-pawn-1-0', 'white', 'pawn', 1, 0),
        pieceAt('white-pawn-1-1', 'white', 'pawn', 1, 1),
        pieceAt('black-king', 'black', 'king', 7, 4),
        pieceAt('black-pawn-7-3', 'black', 'pawn', 7, 3),
        pieceAt('black-pawn-7-5', 'black', 'pawn', 7, 5),
        pieceAt('black-pawn-6-3', 'black', 'pawn', 6, 3),
        pieceAt('black-pawn-6-4', 'black', 'pawn', 6, 4),
        pieceAt('black-pawn-6-5', 'black', 'pawn', 6, 5),
      ],
    })

    const settled = settleForcedPasses(state)

    expect(settled.appendedEvents).toEqual([])
    expect(settled.state.outcome).toEqual({
      winner: null,
      reason: 'no-moves',
      completedTurn: 0,
    })
  })

  it('derives capture-promotion while preserving the Pawn as capture attacker', () => {
    const state: ReplayState = {
      ...createReplayState(),
      pieces: [
        pieceAt('white-king', 'white', 'king', 7, 4),
        pieceAt('white-rook', 'white', 'rook', 7, 7),
        pieceAt('black-king', 'black', 'king', 0, 4),
        pieceAt('black-pawn', 'black', 'pawn', 6, 0),
      ],
      turn: 'black',
      outcome: null,
    }

    const accepted = acceptMoveCommand(
      state,
      {
        expectedPly: 1,
        pieceId: 'black-pawn',
        to: { ring: 7, sector: 7 },
      },
      parts,
    )

    expect(accepted.appendedEvents[0]).toMatchObject({
      type: 'move',
      capturedPieceId: 'white-rook',
      promotedTo: 'queen',
    })
    expect(accepted.state.pieces.find((piece) => piece.id === 'black-pawn')?.kind).toBe('queen')
    expect(accepted.state.captures[0]).toMatchObject({
      attacker: { id: 'black-pawn', kind: 'pawn' },
      captured: { id: 'white-rook' },
    })
  })

  it('lets a direct King capture on action 256 outrank the move-limit draw', () => {
    const state: ReplayState = {
      ...createReplayState(),
      pieces: [
        pieceAt('white-king', 'white', 'king', 7, 4),
        pieceAt('white-rook', 'white', 'rook', 4, 0),
        pieceAt('black-king', 'black', 'king', 2, 0),
      ],
      turn: 'white',
      completedPlies: 255,
      quietPlies: 99,
      outcome: null,
    }

    const accepted = acceptMoveCommand(
      state,
      {
        expectedPly: 256,
        pieceId: 'white-rook',
        to: { ring: 2, sector: 0 },
      },
      parts,
    )

    expect(accepted.state.outcome).toMatchObject({
      winner: 'white',
      reason: 'king-captured',
      completedTurn: 256,
      terminalCapture: {
        attacker: { id: 'white-rook' },
        captured: { id: 'black-king' },
      },
    })
    expect(accepted.state.quietPlies).toBe(0)
  })

  it('lets a forced pass consume the final legal action', () => {
    const settled = settleForcedPasses(forcedPassState({
      completedPlies: 255,
      quietPlies: 20,
    }))

    expect(settled.appendedEvents).toHaveLength(1)
    expect(settled.state.outcome).toEqual({
      winner: null,
      reason: 'move-limit',
      completedTurn: 256,
    })
  })

  it('uses no-progress before move-limit when a pass reaches both boundaries', () => {
    const settled = settleForcedPasses(forcedPassState({
      completedPlies: 255,
      quietPlies: 99,
    }))

    expect(settled.state.outcome).toEqual({
      winner: null,
      reason: 'no-progress',
      completedTurn: 256,
    })
  })
})

describe('event replay validation', () => {
  it('round-trips an accepted event log from the canonical initial position', () => {
    let state = createReplayState()
    const commands = [
      { expectedPly: 1, pieceId: 'white-pawn-1', to: { ring: 4, sector: 0 } },
      { expectedPly: 2, pieceId: 'black-pawn-1', to: { ring: 3, sector: 0 } },
      { expectedPly: 3, pieceId: 'white-pawn-2', to: { ring: 4, sector: 1 } },
      { expectedPly: 4, pieceId: 'black-pawn-2', to: { ring: 3, sector: 1 } },
    ]

    for (const command of commands) {
      state = acceptMoveCommand(state, command, parts).state
    }

    const replayed = replayGameEvents(state.events, parts)
    expect(replayed).toEqual(state)
    expect(validateReplay(state.events, parts)).toEqual({ valid: true, state })
  })

  it('fails closed when the immutable 64-part cast is missing', () => {
    const validation = validateReplay([], [])

    expect(validation).toMatchObject({
      valid: false,
      eventIndex: null,
      error: expect.stringMatching(/exactly 64 problem parts/i),
    })
  })

  it('rejects malformed events, forged metadata, and voluntary passes', () => {
    const accepted = acceptMoveCommand(
      createReplayState(),
      { expectedPly: 1, pieceId: 'white-pawn-1', to: { ring: 5, sector: 0 } },
      parts,
    )
    const event = accepted.state.events[0]
    expect(event?.type).toBe('move')
    if (!event || event.type !== 'move') return

    const forgedCases: unknown[][] = [
      [null],
      [{ ...event, ply: 0 }],
      [{ ...event, side: 'red' }],
      [{ ...event, from: { ring: -1, sector: 0 } }],
      [{
        version: 1,
        type: 'forced-pass',
        ply: 1,
        side: 'white',
        reason: 'manual',
      }],
      [{ ...event, type: 'castle' }],
      [{ ...event, pieceId: ' ' }],
      [{ ...event, capturedPieceId: '' }],
      [{ ...event, promotedTo: 'rook' }],
      [{ ...event, side: 'black' }],
      [{ ...event, promotedTo: 'queen' }],
      [{
        version: 1,
        type: 'forced-pass',
        ply: 2,
        side: 'white',
        reason: 'no-legal-move',
      }],
      [{
        version: 1,
        type: 'forced-pass',
        ply: 1,
        side: 'black',
        reason: 'no-legal-move',
      }],
      [{ ...event, from: { ring: 5, sector: 0 } }],
      [{ ...event, capturedPieceId: 'black-queen-1' }],
      [{ ...event, version: 2 as 1 }],
      [{
        version: 1,
        type: 'forced-pass',
        ply: 1,
        side: 'white',
        reason: 'no-legal-move',
      }],
    ]

    for (const forged of forgedCases) {
      const validation = validateReplay(forged, parts)
      expect(validation.valid).toBe(false)
      if (!validation.valid) {
        expect(validation.eventIndex).toBe(0)
      }
    }
  })

  it('rejects gaps, duplicate plies, and actions after a terminal event', () => {
    let state = createReplayState()
    state = acceptMoveCommand(
      state,
      { expectedPly: 1, pieceId: 'white-pawn-1', to: { ring: 5, sector: 0 } },
      parts,
    ).state
    state = acceptMoveCommand(
      state,
      { expectedPly: 2, pieceId: 'black-pawn-1', to: { ring: 2, sector: 0 } },
      parts,
    ).state

    const first = state.events[0]
    const second = state.events[1]
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (!first || !second) return

    expect(validateReplay([second], parts)).toMatchObject({
      valid: false,
      eventIndex: 0,
    })
    expect(validateReplay([first, first], parts)).toMatchObject({
      valid: false,
      eventIndex: 1,
    })

    const terminalState: ReplayState = {
      ...createReplayState(),
      pieces: [
        pieceAt('white-king', 'white', 'king', 7, 4),
        pieceAt('white-rook', 'white', 'rook', 4, 0),
        pieceAt('black-king', 'black', 'king', 2, 0),
      ],
      turn: 'white',
      outcome: null,
    }
    const terminal = acceptMoveCommand(
      terminalState,
      { expectedPly: 1, pieceId: 'white-rook', to: { ring: 2, sector: 0 } },
      parts,
    ).state

    try {
      acceptMoveCommand(
        terminal,
        { expectedPly: 2, pieceId: 'white-king', to: { ring: 6, sector: 4 } },
        parts,
      )
      throw new Error('Expected the terminal game to reject another move.')
    } catch (error) {
      expect(error).toBeInstanceOf(GameRuleError)
      expect((error as GameRuleError).code).toBe('game-complete')
    }
  })

  it('returns a detached game view that cannot mutate authoritative state', () => {
    const state = acceptMoveCommand(
      createReplayState(),
      { expectedPly: 1, pieceId: 'white-pawn-1', to: { ring: 5, sector: 0 } },
      parts,
    ).state
    const view = toGameView(state)

    ;(view.pieces[0].position as { ring: number }).ring = 99
    const move = view.events[0]
    if (move?.type === 'move') {
      ;(move.to as { ring: number }).ring = 99
    }

    expect(state.pieces[0].position.ring).not.toBe(99)
    expect(state.events[0]).toMatchObject({ to: { ring: 5 } })
  })
})
