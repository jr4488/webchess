import { describe, expect, it } from 'vitest'

import { makeProblemParts } from '../../test/fixtures'
import { getLegalMoves, PIECE_VALUES } from '../game'
import type { ReplayState } from '../game-contract'
import { acceptMoveCommand, createReplayState } from '../game-replay'
import {
  buildTrajectoryDirectionalPromptProjection,
  deriveTrajectoryDirectionalRecord,
  DIRECTIONAL_EPISTEMIC_BOUNDARY,
  DIRECTIONAL_OUTCOME_WEIGHTS,
  DIRECTIONAL_PROMPT_PROJECTION_VERSION,
  DirectionalRecordVerificationError,
  scoreDirectionalContributions,
  serializeTrajectoryDirectionalRecord,
  verifyTrajectoryDirectionalRecord,
} from './trajectory-direction'
import type { TrajectoryDirectionalRecord } from './trajectory-direction'

const DIVISION_SEED = 'fixture/directional-record'
const legacyParts = makeProblemParts('directional-record')
const parts = legacyParts.map((part) => ({
  ...part,
  castApplication: `The assigned ${part.dimension} and ${part.movement} direction materially shaped facet ${part.id}.`,
}))

interface LegalChoice {
  readonly pieceId: string
  readonly to: { readonly ring: number; readonly sector: number }
}

function legalChoices(state: ReplayState): LegalChoice[] {
  return [...state.pieces]
    .filter((piece) => piece.side === state.turn)
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )
    .flatMap((piece) =>
      getLegalMoves(piece, state.pieces)
        .sort(
          (left, right) =>
            left.ring - right.ring || left.sector - right.sector,
        )
        .map((to) => ({ pieceId: piece.id, to })),
    )
}

function playToTerminal(strategy: 'first' | 'last'): ReplayState {
  let state = createReplayState()
  while (!state.outcome) {
    const choices = legalChoices(state)
    const choice = strategy === 'first' ? choices[0] : choices.at(-1)
    if (!choice) throw new Error(`No legal ${strategy} fixture move exists.`)
    state = acceptMoveCommand(
      state,
      {
        expectedPly: state.completedPlies + 1,
        pieceId: choice.pieceId,
        to: choice.to,
      },
      parts,
    ).state
    if (state.completedPlies > 256) {
      throw new Error('The directional fixture exceeded the canonical game bound.')
    }
  }
  return state
}

let firstTrajectory: ReplayState | undefined
let lastTrajectory: ReplayState | undefined

function trajectory(strategy: 'first' | 'last'): ReplayState {
  if (strategy === 'first') {
    firstTrajectory ??= playToTerminal(strategy)
    return firstTrajectory
  }
  lastTrajectory ??= playToTerminal(strategy)
  return lastTrajectory
}

function recordFor(strategy: 'first' | 'last'): TrajectoryDirectionalRecord {
  const state = trajectory(strategy)
  return deriveTrajectoryDirectionalRecord({
    divisionDigest: 'd'.repeat(64),
    divisionSeed: DIVISION_SEED,
    castSeed: 'cast-seed-for-directional-record',
    trajectorySeed: `trajectory-${strategy}`,
    versions: state.versions,
    parts,
    events: state.events,
  })
}

function expectedSource(
  strategy: 'first' | 'last',
): Parameters<typeof verifyTrajectoryDirectionalRecord>[1] {
  return {
    divisionDigest: 'd'.repeat(64),
    divisionSeed: DIVISION_SEED,
    castSeed: 'cast-seed-for-directional-record',
    trajectorySeed: `trajectory-${strategy}`,
    versions: trajectory(strategy).versions,
  }
}

describe('full-trajectory directional record', () => {
  it('is byte-identical for the same canonical replay and verifies against its trusted source', () => {
    const state = trajectory('first')
    const input = {
      divisionDigest: 'd'.repeat(64),
      divisionSeed: DIVISION_SEED,
      castSeed: 'cast-seed-for-directional-record',
      trajectorySeed: 'trajectory-first',
      versions: state.versions,
      parts,
      events: state.events,
    } as const
    const first = deriveTrajectoryDirectionalRecord(input)
    const replay = deriveTrajectoryDirectionalRecord({
      ...input,
      parts: parts.map((part) => ({ ...part })),
      events: state.events.map((event) => ({
        ...event,
        ...(event.type === 'move'
          ? { from: { ...event.from }, to: { ...event.to } }
          : {}),
      })),
    })

    expect(serializeTrajectoryDirectionalRecord(replay)).toBe(
      serializeTrajectoryDirectionalRecord(first),
    )
    expect(first.version).toBe('webchess-directional-record-v1')
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/u)
    expect(first.digest).toBe(
      '593cc5065add510fd035bd422512ddd753e5f12dae545f7114e8db1ad7bb5d2f',
    )
    expect({
      eventStream: first.trajectory.eventStreamDigest,
      factors: first.trajectory.factorDigest,
      assignments: first.cast.assignmentsDigest,
      parts: first.field.partsDigest,
      plies: first.trajectory.completedPlies,
      moves: first.trajectory.moveCount,
      passes: first.trajectory.forcedPassCount,
      promotions: first.trajectory.promotionCount,
      captures: first.captures.length,
      outcome: first.outcome,
    }).toEqual({
      eventStream: '42d849d585034c69cfcb0b85d91f273f92d6914fd4faad036d7b4ef4af18507e',
      factors: '8ffaf332a3a0c02a117719bf7150620d411e2940aca620b8c79cbbdb38ab3178',
      assignments: 'fd2d8c738def99f651633aca3ddd9ccaf8881d809f1110b302037a850aeb424b',
      parts: 'c797d44b9f0b3fb732791459cd46082a06cef70b56e471db077decdab41d3d46',
      plies: 107,
      moves: 107,
      passes: 0,
      promotions: 0,
      captures: 2,
      outcome: {
        winner: null,
        reason: 'no-progress',
        completedTurn: 107,
        terminalCaptureId: null,
      },
    })
    expect(first.field.parts).toHaveLength(64)
    expect(first.field.parts.every((entry) =>
      typeof entry.part.castApplication === 'string' &&
      entry.part.castApplication.length >= 20 &&
      entry.castAssignment.directionalCue.length > 0,
    )).toBe(true)
    expect(first.cast.assignmentVersion).toBe(
      'webchess-division-cast-binding-v1',
    )
    expect(first.cast.assignmentsDigest).toMatch(/^[0-9a-f]{64}$/u)
    expect(first.directions).toHaveLength(64)
    expect(first.survivingDirectionKeys).toHaveLength(8)
    expect(first.trajectory.completedPlies).toBe(state.completedPlies)
    expect(first.trajectory.events).toHaveLength(state.events.length)
    expect(first.captures).toHaveLength(state.captures.length)
    expect(first.survivors).toHaveLength(state.pieces.length)
    expect(first.epistemicBoundary).toEqual(DIRECTIONAL_EPISTEMIC_BOUNDARY)
    expect(verifyTrajectoryDirectionalRecord(first, expectedSource('first'))).toEqual(first)
  })

  it('changes the record and ranked directions for materially different legal trajectories', () => {
    const first = recordFor('first')
    const last = recordFor('last')

    expect(first.trajectory.eventStreamDigest).not.toBe(
      last.trajectory.eventStreamDigest,
    )
    expect(first.trajectory.factorDigest).not.toBe(last.trajectory.factorDigest)
    expect(first.digest).not.toBe(last.digest)
    expect(first.directions.map((direction) => [
      direction.lens.key,
      direction.score,
    ])).not.toEqual(last.directions.map((direction) => [
      direction.lens.key,
      direction.score,
    ]))
  })

  it('projects the same replay deterministically and only retains its eight selected signals', () => {
    const record = recordFor('first')
    const first = buildTrajectoryDirectionalPromptProjection(record)
    const replay = buildTrajectoryDirectionalPromptProjection(
      structuredClone(record),
    )
    const different = buildTrajectoryDirectionalPromptProjection(
      recordFor('last'),
    )

    expect(JSON.stringify(replay)).toBe(JSON.stringify(first))
    expect(first.projection_version).toBe(
      DIRECTIONAL_PROMPT_PROJECTION_VERSION,
    )
    expect(first.record_version).toBe(record.version)
    expect(first.record_digest).toBe(record.digest)
    expect(first.surviving_direction_keys).toEqual(
      record.survivingDirectionKeys,
    )
    expect(first.surviving_directions).toEqual(record.directions.slice(0, 8))
    expect(first.surviving_directions).toHaveLength(8)
    const selectedSurvivorIds = new Set(
      record.directions.slice(0, 8)
        .flatMap((direction) => direction.survivorPieceIds),
    )
    const expectedSupportingSurvivors = record.survivors.filter((survivor) =>
      selectedSurvivorIds.has(survivor.piece.pieceId))
    const selectedCaptureIds = new Set([
      ...record.directions.slice(0, 8)
        .flatMap((direction) => direction.captureIds),
      ...expectedSupportingSurvivors.flatMap((survivor) => survivor.captureIds),
    ])
    expect(selectedCaptureIds.size).toBeGreaterThan(0)
    expect(selectedSurvivorIds.size).toBeGreaterThan(0)
    expect(first.supporting_captures).toEqual(
      record.captures.filter((capture) =>
        selectedCaptureIds.has(capture.captureId)),
    )
    expect(first.supporting_captures.map((capture) => capture.sequence)).toEqual(
      [...first.supporting_captures]
        .map((capture) => capture.sequence)
        .sort((left, right) => left - right),
    )
    expect(first.supporting_survivors).toEqual(
      expectedSupportingSurvivors,
    )
    expect(first.supporting_survivors.map((survivor) =>
      survivor.piece.pieceId)).toEqual(
      [...selectedSurvivorIds].sort(),
    )
    const projectedCaptureIds = new Set(
      first.supporting_captures.map((capture) => capture.captureId),
    )
    expect(first.supporting_survivors.every((survivor) =>
      survivor.captureIds.every((captureId) =>
        projectedCaptureIds.has(captureId)),
    )).toBe(true)
    expect(first).not.toHaveProperty('field')
    expect(first).not.toHaveProperty('trajectory')
    expect(first).not.toHaveProperty('directions')
    expect(JSON.stringify(first)).not.toContain('"parts":')
    expect(JSON.stringify(first)).not.toContain('"events":')
    expect(different.record_digest).not.toBe(first.record_digest)
    expect(different.surviving_directions).not.toEqual(
      first.surviving_directions,
    )

    const duplicateDirections = [...record.directions]
    duplicateDirections[63] = {
      ...duplicateDirections[63]!,
      lens: record.directions[0]!.lens,
    }
    expect(() => buildTrajectoryDirectionalPromptProjection({
      ...record,
      directions: duplicateDirections,
    })).toThrow(/unique ranked direction keys/u)
  })

  it('fails closed on missing or duplicate selected support referents', () => {
    const record = recordFor('first')
    const selected = record.directions.slice(0, 8)
    const captureId = selected.flatMap((direction) => direction.captureIds)[0]
    const survivorId = selected
      .flatMap((direction) => direction.survivorPieceIds)[0]
    if (!captureId || !survivorId || !record.captures[0] || !record.survivors[0]) {
      throw new Error('Directional support fixture is incomplete.')
    }

    expect(() => buildTrajectoryDirectionalPromptProjection({
      ...record,
      captures: record.captures.filter((capture) =>
        capture.captureId !== captureId),
    })).toThrow(/missing capture referent/u)
    expect(() => buildTrajectoryDirectionalPromptProjection({
      ...record,
      captures: [...record.captures, structuredClone(record.captures[0])],
    })).toThrow(/unique capture referents/u)
    expect(() => buildTrajectoryDirectionalPromptProjection({
      ...record,
      survivors: record.survivors.filter((survivor) =>
        survivor.piece.pieceId !== survivorId),
    })).toThrow(/missing survivor referent/u)
    expect(() => buildTrajectoryDirectionalPromptProjection({
      ...record,
      survivors: record.survivors.map((survivor) =>
        survivor.piece.pieceId === survivorId
          ? {
              ...survivor,
              captureIds: [
                ...survivor.captureIds,
                'missing-supporting-survivor-capture',
              ],
            }
          : survivor),
    })).toThrow(/missing capture referent/u)
    expect(() => buildTrajectoryDirectionalPromptProjection({
      ...record,
      survivors: [...record.survivors, structuredClone(record.survivors[0])],
    })).toThrow(/unique survivor referents/u)
  })

  it('records captured Queen material as nine and captured Pawn material as one', () => {
    const records = [recordFor('first'), recordFor('last')]
    const captures = records.flatMap((record) => record.captures)
    const queen = captures.find((capture) => capture.captured.kind === 'queen')
    const pawn = captures.find((capture) => capture.captured.kind === 'pawn')

    expect(queen, 'fixture must include a legal Queen capture').toBeDefined()
    expect(pawn, 'fixture must include a legal Pawn capture').toBeDefined()
    expect(queen?.capturedMaterialValue).toBe(9)
    expect(pawn?.capturedMaterialValue).toBe(1)
    expect(queen?.capturedMaterialValue).not.toBe(pawn?.capturedMaterialValue)
  })

  it('binds ordered captures and survivor routes to the canonical replay', () => {
    const state = trajectory('first')
    const record = recordFor('first')

    expect(record.captures.map((capture) => ({
      sequence: capture.sequence,
      id: capture.captureId,
      ply: capture.ply,
      attacker: capture.attacker.pieceId,
      attackerKind: capture.attacker.kind,
      attackerValue: capture.attackerMaterialValue,
      captured: capture.captured.pieceId,
      capturedKind: capture.captured.kind,
      capturedValue: capture.capturedMaterialValue,
      cell: capture.cell,
      partId: capture.lens.partId,
    }))).toEqual(state.captures.map((capture, index) => ({
      sequence: index + 1,
      id: capture.id,
      ply: capture.turn,
      attacker: capture.attacker.id,
      attackerKind: capture.attacker.kind,
      attackerValue: PIECE_VALUES[capture.attacker.kind],
      captured: capture.captured.id,
      capturedKind: capture.captured.kind,
      capturedValue: PIECE_VALUES[capture.captured.kind],
      cell: capture.cell,
      partId: capture.part.id,
    })))

    for (const survivor of record.survivors) {
      const replayPiece = state.pieces.find(
        (piece) => piece.id === survivor.piece.pieceId,
      )
      expect(replayPiece).toMatchObject({
        side: survivor.piece.side,
        kind: survivor.piece.kind,
        position: survivor.finalCoordinate,
      })
      expect(survivor.route.map((move) => move.ply)).toEqual(
        state.events.flatMap((event) =>
          event.type === 'move' && event.pieceId === survivor.piece.pieceId
            ? [event.ply]
            : [],
        ),
      )
    }
  })

  it('makes the versioned terminal outcome an immutable ranking contribution', () => {
    const record = recordFor('first')
    const outcomeDirections = record.directions.filter(
      (direction) => direction.contributions.terminalOutcomeWeight > 0,
    )

    expect(Object.isFrozen(DIRECTIONAL_OUTCOME_WEIGHTS)).toBe(true)
    expect(Object.isFrozen(DIRECTIONAL_OUTCOME_WEIGHTS.reason)).toBe(true)
    expect(outcomeDirections).not.toHaveLength(0)
    for (const direction of outcomeDirections) {
      expect(direction.score).toBeGreaterThan(
        scoreDirectionalContributions({
          ...direction.contributions,
          terminalOutcomeWeight: 0,
        }),
      )
    }
  })

  it('does not relabel a legacy field without durable cast applications as current direction', () => {
    expect(() =>
      deriveTrajectoryDirectionalRecord({
        divisionDigest: 'd'.repeat(64),
        divisionSeed: DIVISION_SEED,
        castSeed: 'legacy-cast-seed',
        trajectorySeed: 'legacy-trajectory-seed',
        versions: trajectory('first').versions,
        parts: legacyParts,
        events: trajectory('first').events,
      }),
    ).toThrow(/legacy pre-directional/i)
  })

  it('keeps derive and import verification coherent at the cast-application bound', () => {
    const state = trajectory('first')
    const boundedParts = parts.map((part) => ({
      ...part,
      castApplication: 'x'.repeat(480),
    }))
    const source = expectedSource('first')
    const record = deriveTrajectoryDirectionalRecord({
      ...source,
      parts: boundedParts,
      events: state.events,
    })

    expect(verifyTrajectoryDirectionalRecord(record, source)).toEqual(record)
  })

  it('rejects event, field, score, and digest tampering instead of trusting them', () => {
    const original = recordFor('first')
    const moveIndex = original.trajectory.events.findIndex(
      (event) => event.type === 'move',
    )
    const changedEvents = [...original.trajectory.events]
    const move = changedEvents[moveIndex]
    if (!move || move.type !== 'move') throw new Error('Fixture has no move.')
    changedEvents[moveIndex] = {
      ...move,
      event: {
        ...move.event,
        to: {
          ring: move.event.to.ring,
          sector: (move.event.to.sector + 1) % 8,
        },
      },
    }
    expect(() =>
      verifyTrajectoryDirectionalRecord({
        ...original,
        trajectory: { ...original.trajectory, events: changedEvents },
      }, expectedSource('first')),
    ).toThrow(/event|illegal|replay|verification/i)

    const changedParts = [...original.field.parts]
    changedParts[0] = {
      ...changedParts[0],
      part: { ...changedParts[0].part, theme: 'tampered cast theme' },
    }
    expect(() =>
      verifyTrajectoryDirectionalRecord({
        ...original,
        field: { ...original.field, parts: changedParts },
      }, expectedSource('first')),
    ).toThrow(/canonical|shuffle/i)

    const changedDirections = [...original.directions]
    changedDirections[0] = {
      ...changedDirections[0],
      score: changedDirections[0].score + 1,
    }
    expect(() =>
      verifyTrajectoryDirectionalRecord({
        ...original,
        directions: changedDirections,
      }, expectedSource('first')),
    ).toThrow(/verification failed/i)
    expect(() =>
      verifyTrajectoryDirectionalRecord({
        ...original,
        digest: '0'.repeat(64),
      }, expectedSource('first')),
    ).toThrow(/verification failed/i)
  })

  it('rejects relabeled source provenance and malformed import envelopes', () => {
    const original = recordFor('first')
    const source = expectedSource('first')
    expect(() =>
      verifyTrajectoryDirectionalRecord({
        ...original,
        trajectory: { ...original.trajectory, seed: 'relabeled-game-id' },
      }, source),
    ).toThrow(/trusted source provenance/i)

    const cases: unknown[] = [
      null,
      { ...original, unsupported: true },
      { ...original, explanation: ['x'.repeat(1_000_001)] },
    ]
    const cyclic: Record<string, unknown> = { ...original }
    cyclic.cycle = cyclic
    cases.push(cyclic)
    for (const candidate of cases) {
      try {
        verifyTrajectoryDirectionalRecord(candidate, source)
        throw new Error('Expected malformed record rejection.')
      } catch (error) {
        expect(error).toBeInstanceOf(DirectionalRecordVerificationError)
      }
    }
  })
})
