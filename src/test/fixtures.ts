import { composeProblemParts } from '../lib/division'
import { getLegalMoves } from '../lib/game'
import type { ReplayState } from '../lib/game-contract'
import { acceptMoveCommand, createReplayState } from '../lib/game-replay'
import {
  deriveTrajectoryDirectionalRecord,
} from '../lib/lifecycle/trajectory-direction'
import type {
  TrajectoryDirectionalRecord,
} from '../lib/lifecycle/trajectory-direction'
import {
  deriveSurvivorCandidates,
  terminalFingerprint,
} from '../lib/lifecycle/survivors'
import type { SurvivorCandidate } from '../lib/lifecycle/contracts'
import type { ServerDerivedEvidence } from '../server/openai/answer'
import type { DivisionAnalysis, ProblemFacet, ProblemPart } from '../types'

export function makeProblemFacets(label = 'Facet'): ProblemFacet[] {
  return Array.from({ length: 64 }, (_, index) => ({
    id: index + 1,
    title: `${label} ${index + 1}`,
    focus: `Concrete focus ${index + 1}`,
    question: `What would clarify facet ${index + 1}?`,
    keyword: `keyword-${index + 1}`,
  }))
}

export function makeProblemParts(seed = 'test-problem'): ProblemPart[] {
  return composeProblemParts(makeProblemFacets(), `fixture/${seed}`)
}

export function makeDivisionAnalysis(seed = 'fresh-server-seed'): DivisionAnalysis {
  return {
    facets: makeProblemFacets('Sol facet'),
    seed,
    model: 'gpt-5.6-sol',
    prompt: 'Canonical semantic division prompt.',
  }
}

export interface TrajectoryDirectionalFixture {
  readonly divisionSeed: string
  readonly divisionDigest: string
  readonly castSeed: string
  readonly trajectorySeed: string
  readonly parts: readonly ProblemPart[]
  readonly state: ReplayState
  readonly record: TrajectoryDirectionalRecord
  readonly survivors: readonly SurvivorCandidate[]
  readonly terminalFingerprint: string
  readonly evidence: ServerDerivedEvidence
}

let cachedTrajectoryDirectionalFixture: TrajectoryDirectionalFixture | undefined

/** Deterministic, bounded canonical game used only by directional contract tests. */
export function makeTrajectoryDirectionalFixture(): TrajectoryDirectionalFixture {
  if (cachedTrajectoryDirectionalFixture) return cachedTrajectoryDirectionalFixture

  const divisionSeedValue = 'fixture/portia-directional-record'
  const parts = makeProblemParts('portia-directional-record').map((part) => ({
    ...part,
    castApplication:
      `The assigned ${part.dimension} and ${part.movement} direction materially shapes facet ${part.id}.`,
  }))
  let state = createReplayState()
  while (!state.outcome) {
    const choice = state.pieces
      .filter((piece) => piece.side === state.turn)
      .sort((left, right) => left.id.localeCompare(right.id))
      .flatMap((piece) =>
        getLegalMoves(piece, state.pieces)
          .sort((left, right) =>
            left.ring - right.ring || left.sector - right.sector)
          .map((to) => ({ pieceId: piece.id, to })))
      .at(0)
    if (!choice) {
      throw new Error('The directional fixture has no canonical legal move.')
    }
    state = acceptMoveCommand(state, {
      expectedPly: state.completedPlies + 1,
      pieceId: choice.pieceId,
      to: choice.to,
    }, parts).state
    if (state.completedPlies > 256) {
      throw new Error('The directional fixture exceeded the game bound.')
    }
  }

  const divisionDigest = 'd'.repeat(64)
  const castSeed = 'fixture-cast-seed'
  const trajectorySeed = 'fixture-trajectory-seed'
  const record = deriveTrajectoryDirectionalRecord({
    divisionDigest,
    divisionSeed: divisionSeedValue,
    castSeed,
    trajectorySeed,
    versions: state.versions,
    parts,
    events: state.events,
  })
  const survivors = deriveSurvivorCandidates(state, parts, {
    gameId: '00000000-0000-4000-8000-000000000201',
    attemptId: '00000000-0000-4000-8000-000000000202',
    divisionDigest,
    rulesVersion: state.versions.rules,
    engineVersion: state.versions.engine,
    castVersion: state.versions.cast,
    eventVersion: state.versions.event,
  })
  const evidence: ServerDerivedEvidence = {
    problem:
      'How should I choose a reversible next step while the available evidence is incomplete?',
    turnCount: state.completedPlies,
    outcome: {
      winner: state.outcome.winner,
      reason: state.outcome.reason,
      completedTurn: state.outcome.completedTurn,
    },
    captures: state.captures.map((capture) => ({
      turn: capture.turn,
      resonance: capture.resonance,
      cell: { ...capture.cell },
      attacker: {
        side: capture.attacker.side,
        kind: capture.attacker.kind,
      },
      captured: {
        side: capture.captured.side,
        kind: capture.captured.kind,
      },
      part: {
        id: capture.part.id,
        title: capture.part.title,
        focus: capture.part.focus,
        hexagram: capture.part.hexagram,
        hexagramName: capture.part.hexagramName,
        theme: capture.part.theme,
        dimension: capture.part.dimension,
        movement: capture.part.movement,
        prompt: capture.part.prompt,
        keyword: capture.part.keyword,
      },
    })),
  }
  cachedTrajectoryDirectionalFixture = {
    divisionSeed: divisionSeedValue,
    divisionDigest,
    castSeed,
    trajectorySeed,
    parts,
    state,
    record,
    survivors,
    terminalFingerprint: terminalFingerprint(survivors),
    evidence,
  }
  return cachedTrajectoryDirectionalFixture
}
