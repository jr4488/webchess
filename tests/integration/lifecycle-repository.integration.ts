import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CURRENT_GAME_VERSIONS } from '../../src/lib/game-contract'
import { createReplayState, toGameView } from '../../src/lib/game-replay'
import {
  CURRENT_LIFECYCLE_VERSIONS,
  evaluateGate,
} from '../../src/lib/lifecycle'
import { PORTIA_ATTACK_TYPES } from '../../src/lib/lifecycle/contracts'
import type {
  CharlotteResult,
  PortiaReview,
  SurvivorCandidate,
} from '../../src/lib/lifecycle/contracts'
import { makeProblemFacets, makeProblemParts } from '../../src/test/fixtures'
import type { DurableGameSnapshot } from '../../src/server/games'
import { DurableLifecycleRepository } from '../../src/server/lifecycle'
import {
  createPostgresTestDatabase,
} from './postgres-test-database'
import type { PostgresTestDatabase } from './postgres-test-database'

const OWNER = 'user_lifecycle_repository_integration'
const GAME_ID = '62000000-0000-4000-8000-000000000001'
const PROBLEM = 'How should this lifecycle preserve evidence while moving toward action?'

let database: PostgresTestDatabase
let repository: DurableLifecycleRepository
let game: DurableGameSnapshot

function survivor(index: number): SurvivorCandidate {
  const part = game.division?.parts[index]
  if (!part) throw new Error('The lifecycle fixture is missing its mapped facet.')
  return {
    candidateId: `attempt-${index}:white-piece-${index}`,
    pieceId: `white-piece-${index}`,
    side: 'white',
    pieceKind: index % 2 === 0 ? 'rook' : 'bishop',
    originalPieceKind: index % 2 === 0 ? 'rook' : 'bishop',
    pieceRole: 'a distinct surviving role in the terminal evidence web',
    sidePolarity: 'outside-in evidence',
    finalCoordinate: { ring: Math.floor(index / 8), sector: index % 8 },
    facet: part,
    route: [],
    capturesMade: [],
    attackedPlies: [],
    moveCount: index + 1,
    promoted: false,
    terminalGameId: GAME_ID,
    attemptId: '62000000-0000-4000-8000-000000000002',
    sourceDigest: String(index + 1).repeat(64),
  }
}

function portiaReview(survivors: readonly SurvivorCandidate[]): PortiaReview {
  const coverage = [
    'protected_outcome',
    'evidence_or_reality',
    'risk_or_countercase',
    'agency_or_action',
  ] as const
  return {
    contractVersion: CURRENT_LIFECYCLE_VERSIONS.portiaContract,
    runSummary: 'Portia tested every survivor independently and retained explicit uncertainty boundaries.',
    assessments: survivors.map((candidate, index) => ({
      candidateId: candidate.candidateId,
      disposition: 'preserved',
      survivingInterpretation: `Candidate ${index + 1} survives only as a bounded interpretation.`,
      requiredQualification: null,
      redundancyClusterId: null,
      coverageTags: [coverage[index]!],
      missingEvidence: ['A direct observation is still required before scaling.'],
      countercase: 'A contradictory direct observation could overturn this interpretation.',
      reversalCondition: 'Reverse if the predeclared observation contradicts the expected effect.',
      attackFindings: PORTIA_ATTACK_TYPES.map((attackType) => ({
        attackType,
        severity: 'moderate',
        finding: `The ${attackType} attack found a bounded uncertainty.`,
        consequence: 'The recommendation must remain reversible.',
        requiredRevision: 'State the evidence limit and decision threshold.',
      })),
    })),
    crossCandidateContradictions: [],
    redundancyClusters: [],
    missingCoverage: [],
    unresolvedQuestions: ['Which direct observation would reduce uncertainty fastest?'],
    recommendedGateInputs: {
      tensionCandidatePairs: [[
        survivors[0]!.candidateId,
        survivors[2]!.candidateId,
      ]],
      fatalContradictionIds: [],
      fieldRepairReasons: [],
    },
  }
}

function charlotteResult(survivors: readonly SurvivorCandidate[]): CharlotteResult {
  return {
    contractVersion: CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
    protectedOutcome: 'Protect the declared outcome while learning through a bounded and reversible action.',
    directAnswer: 'Run the smallest reversible test that preserves the protected outcome and produces a direct observation before any larger commitment.',
    supportingCandidateIds: survivors.map((candidate) => candidate.candidateId),
    qualificationsByCandidateId: {},
    centralTension: 'The need to learn promptly remains in tension with protecting affected people from avoidable downside.',
    valueConstraints: ['Keep the observation honest and preserve an explicit stop path.'],
    stakeholderConsequences: ['The accountable actor owns the test and records its effects.'],
    recommendation: 'Authorize one bounded experiment, evaluate the declared signal, and revise rather than scaling when the evidence boundary is not met.',
    communicationStrategy: 'State the assumption, reversible action, observation, and stopping rule in plain language.',
    uncertainties: ['The direct observation has not yet been collected.'],
    whatCouldChangeTheAnswer: ['A contradictory observation at the review horizon would reverse the recommendation.'],
    exactlyThreeNextActions: Array.from({ length: 3 }, (_, index) => ({
      title: `Bounded action ${index + 1}`,
      actor: 'The accountable player',
      assumptionBeingTested: 'A small reversible intervention can produce useful evidence safely.',
      smallestAction: 'Run one limited observation without expanding scope or duration.',
      expectedObservation: 'A recorded signal either supports or weakens the tested assumption.',
      decisionThreshold: 'Continue only if the declared signal appears without a stop condition.',
      reviewHorizon: 'Within fourteen days',
      reversibility: 'Stop immediately and restore the previous state without scaling.',
      risksOrAffectedParties: 'Record affected parties and stop if the protected outcome is threatened.',
      decisionRule: 'revise' as const,
    })),
  }
}

beforeAll(async () => {
  database = await createPostgresTestDatabase('lifecycle_repository')
  await database.migrate()
  repository = new DurableLifecycleRepository(database.adapter)
  const facets = makeProblemFacets('Lifecycle integration facet')
  const parts = makeProblemParts('lifecycle-integration')
  const now = new Date('2026-08-01T20:00:00.000Z')
  await database.adapter.query({
    text: `INSERT INTO user_controls (clerk_user_id) VALUES ($1::text)`,
    values: [OWNER],
  })
  await database.adapter.query({
    text: `
      INSERT INTO games (
        id, clerk_user_id, is_current, revision, status, problem,
        problem_sha256, division_seed, division_facets, problem_parts,
        division_model, division_prompt_version, division_prompt_sha256,
        division_digest, event_version, rules_version, engine_version,
        cast_version, software_version, created_at, updated_at
      )
      VALUES (
        $1::uuid, $2::text, true, 1, 'mapped', $3::text,
        repeat('a', 64), $4::text, $5::jsonb, $6::jsonb,
        'gpt-5.6-sol', 'webchess-division-v2', repeat('b', 64),
        repeat('c', 64), $7::smallint, $8::text, $9::text,
        $10::text, '2.0.0', $11::timestamptz, $11::timestamptz
      )
    `,
    values: [
      GAME_ID,
      OWNER,
      PROBLEM,
      'lifecycle-integration-seed',
      JSON.stringify(facets),
      JSON.stringify(parts),
      CURRENT_GAME_VERSIONS.event,
      CURRENT_GAME_VERSIONS.rules,
      CURRENT_GAME_VERSIONS.engine,
      CURRENT_GAME_VERSIONS.cast,
      now.toISOString(),
    ],
  })
  game = {
    id: GAME_ID,
    sourceGameId: null,
    isCurrent: true,
    revision: 1,
    status: 'mapped',
    problem: PROBLEM,
    division: {
      seed: 'lifecycle-integration-seed',
      facets,
      parts,
      model: 'gpt-5.6-sol',
      promptVersion: 'webchess-division-v2',
      promptSha256: 'b'.repeat(64),
      digest: 'c'.repeat(64),
    },
    game: toGameView(createReplayState()),
    answer: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    answeredAt: null,
  }
})

afterAll(async () => {
  await database.dispose()
})

describe('durable WebChess 2.0 lifecycle repository', () => {
  it('bootstraps versioned provenance and advances with compare-and-swap', async () => {
    const created = await repository.ensureForGame({
      ownerId: OWNER,
      game,
      trajectorySeed: randomUUID(),
    })
    expect(created).toMatchObject({
      gameId: GAME_ID,
      rootRunId: created.id,
      parentRunId: null,
      state: 'chess_ready',
      revision: 0,
      fieldGeneration: 1,
      gameAttempt: 1,
      versions: {
        software: CURRENT_LIFECYCLE_VERSIONS.software,
        lifecycle: CURRENT_LIFECYCLE_VERSIONS.lifecycle,
        rules: CURRENT_GAME_VERSIONS.rules,
        engine: CURRENT_GAME_VERSIONS.engine,
        cast: CURRENT_GAME_VERSIONS.cast,
        event: CURRENT_GAME_VERSIONS.event,
      },
    })
    expect(created.activities.map((activity) => activity.stateTo)).toEqual([
      'anansi_running',
      'field_ready',
      'chess_ready',
    ])

    const playing = await repository.transition({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: created.revision,
      to: 'chess_playing',
      stage: 'chess',
      activityType: 'game_started',
      inputEntityIds: [GAME_ID],
      outputEntityIds: [GAME_ID],
      responsibleAgentIds: ['player', 'webchess-engine'],
      configurationDigest: 'd'.repeat(64),
    })
    expect(playing.state).toBe('chess_playing')
    expect(playing.revision).toBe(1)
    expect(playing.activities.at(-1)).toMatchObject({
      sequence: 4,
      stateFrom: 'chess_ready',
      stateTo: 'chess_playing',
    })

    await expect(repository.transition({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: 0,
      to: 'chess_terminal',
      stage: 'chess',
      activityType: 'stale_transition',
      configurationDigest: 'd'.repeat(64),
    })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('persists immutable Portia, Gate, Charlotte, and append-only Wilbur artifacts', async () => {
    await database.adapter.query({
      text: `
        INSERT INTO model_requests (
          id, clerk_user_id, game_id, operation, idempotency_key,
          request_sha256, status, model, prompt_version, software_version
        )
        VALUES
          ('62000000-0000-4000-8000-000000000003', $1::text, $2::uuid,
            'portia', '62000000-0000-4000-8000-000000000009', repeat('1', 64),
            'reserved', 'gpt-5.6-sol', $3::text, '2.0.0'),
          ('62000000-0000-4000-8000-000000000004', $1::text, $2::uuid,
            'charlotte', '62000000-0000-4000-8000-000000000010', repeat('3', 64),
            'reserved', 'gpt-5.6-sol', $4::text, '2.0.0')
      `,
      values: [
        OWNER,
        GAME_ID,
        CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
        CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
      ],
    })
    const current = await repository.getForGame(OWNER, GAME_ID)
    expect(current?.state).toBe('chess_playing')
    const survivors = Array.from({ length: 4 }, (_, index) => survivor(index))
    let lifecycle = await repository.transition({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: current!.revision,
      to: 'chess_terminal',
      stage: 'chess',
      activityType: 'terminal_replay_verified',
      terminalFingerprint: 'f'.repeat(64),
      survivors,
      configurationDigest: 'd'.repeat(64),
    })
    lifecycle = await repository.transition({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      to: 'portia_pending',
      stage: 'portia',
      activityType: 'adversarial_review_authorized',
      configurationDigest: 'd'.repeat(64),
    })
    lifecycle = await repository.transition({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      to: 'portia_running',
      stage: 'portia',
      activityType: 'adversarial_review_started',
      configurationDigest: 'd'.repeat(64),
    })
    const review = portiaReview(survivors)
    lifecycle = await repository.storePortia({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      modelRequestId: '62000000-0000-4000-8000-000000000003',
      inputDigest: '1'.repeat(64),
      outputDigest: '2'.repeat(64),
      review,
      configurationDigest: 'd'.repeat(64),
    })
    expect(lifecycle.portia).toEqual(review)

    const gate = evaluateGate(review)
    expect(gate.passed).toBe(true)
    lifecycle = await repository.storeGate({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      result: gate,
      configurationDigest: 'd'.repeat(64),
    })
    lifecycle = await repository.transition({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      to: 'charlotte_pending',
      stage: 'charlotte',
      activityType: 'synthesis_authorized',
      configurationDigest: 'd'.repeat(64),
    })
    lifecycle = await repository.transition({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      to: 'charlotte_running',
      stage: 'charlotte',
      activityType: 'synthesis_started',
      configurationDigest: 'd'.repeat(64),
    })
    const charlotte = charlotteResult(survivors)
    lifecycle = await repository.storeCharlotte({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      modelRequestId: '62000000-0000-4000-8000-000000000004',
      inputDigest: '3'.repeat(64),
      outputDigest: '4'.repeat(64),
      result: charlotte,
      renderedAnswer: `${charlotte.directAnswer} ${charlotte.recommendation}`,
      configurationDigest: 'd'.repeat(64),
    })
    expect(lifecycle).toMatchObject({
      state: 'charlotte_complete',
      gate: { passed: true },
      charlotte,
    })

    const action = await repository.createWilburAction({
      ownerId: OWNER,
      gameId: GAME_ID,
      id: '62000000-0000-4000-8000-000000000005',
      idempotencyKey: '62000000-0000-4000-8000-000000000006',
      requestDigest: '5'.repeat(64),
      charlotteActionIndex: 0,
      actor: charlotte.exactlyThreeNextActions[0].actor,
      action: charlotte.exactlyThreeNextActions[0].smallestAction,
      testedAssumption: charlotte.exactlyThreeNextActions[0].assumptionBeingTested,
      expectedObservation: charlotte.exactlyThreeNextActions[0].expectedObservation,
      decisionThreshold: charlotte.exactlyThreeNextActions[0].decisionThreshold,
      reviewHorizon: charlotte.exactlyThreeNextActions[0].reviewHorizon,
      configurationDigest: 'd'.repeat(64),
    })
    const started = await repository.updateWilburAction({
      ownerId: OWNER,
      gameId: GAME_ID,
      actionId: action.id,
      expectedRevision: action.revision,
      status: 'in_progress',
      configurationDigest: 'd'.repeat(64),
    })
    expect(started).toMatchObject({ status: 'in_progress', revision: 1 })

    const observationInput = {
      ownerId: OWNER,
      gameId: GAME_ID,
      actionId: action.id,
      id: '62000000-0000-4000-8000-000000000007',
      idempotencyKey: '62000000-0000-4000-8000-000000000008',
      requestDigest: '6'.repeat(64),
      observedAt: '2026-08-02T20:00:00.000Z',
      observation: 'The bounded signal appeared without threatening the protected outcome.',
      evidenceClassification: 'Direct observation recorded by the accountable player.',
      expectedEffect: 'A useful signal appears inside the declared horizon.',
      unexpectedEffect: 'No material unexpected effect was observed.',
      stakeholderResponse: 'Affected people retained the stop path.',
      assumptionResult: 'supported' as const,
      nextDecision: 'Continue only within the original bound and review again.',
      configurationDigest: 'd'.repeat(64),
    }
    const observation = await repository.appendWilburObservation(observationInput)
    expect(observation.assumptionResult).toBe('supported')
    await expect(repository.appendWilburObservation(observationInput)).resolves.toEqual(observation)

    const complete = await repository.getForGame(OWNER, GAME_ID)
    expect(complete).toMatchObject({
      state: 'wilbur_observed',
      wilburActions: [{ id: action.id, status: 'in_progress' }],
      wilburObservations: [{ id: observation.id }],
    })
  })

  it('is deleted through the existing owner cascade', async () => {
    await database.adapter.query({
      text: `DELETE FROM user_controls WHERE clerk_user_id = $1::text`,
      values: [OWNER],
    })
    await expect(repository.getForGame(OWNER, GAME_ID)).resolves.toBeNull()
  })
})
