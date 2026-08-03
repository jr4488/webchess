import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CURRENT_GAME_VERSIONS } from '../../src/lib/game-contract'
import { createReplayState, toGameView } from '../../src/lib/game-replay'
import {
  CURRENT_LIFECYCLE_VERSIONS,
  evaluateGate,
  terminalFingerprint,
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
const RETRY_OWNER = 'user_lifecycle_retry_lineage_integration'
const CHARLOTTE_OWNER = 'user_lifecycle_charlotte_fence_integration'
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
    reviewedAnswerPromptDigest: 'a'.repeat(64),
    promptDecision: 'permit',
    promptDecisionRationale:
      'The exact board-derived prompt is reasonable under explicit qualifications.',
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
        outcome: 'passed',
        severity: 'low',
        finding: `The ${attackType} attack found a bounded uncertainty.`,
        consequence: 'The recommendation must remain reversible.',
        requiredRevision: null,
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

async function insertMappedRetryGame(
  id: string,
  sourceGameId: string | null,
  divisionSeed: string,
  ownerId = RETRY_OWNER,
): Promise<DurableGameSnapshot> {
  const facets = makeProblemFacets(`Retry lineage facet ${id}`)
  const parts = makeProblemParts(`retry-lineage-${id}`)
  const now = new Date('2026-08-01T21:00:00.000Z')

  await database.adapter.query({
    text: `
      INSERT INTO games (
        id, clerk_user_id, source_game_id, is_current, revision, status,
        problem, problem_sha256, division_seed, division_facets, problem_parts,
        division_model, division_prompt_version, division_prompt_sha256,
        division_digest, event_version, rules_version, engine_version,
        cast_version, software_version, created_at, updated_at
      )
      VALUES (
        $1::uuid, $2::text, $3::uuid, false, 1, 'mapped',
        $4::text, repeat('a', 64), $5::text, $6::jsonb, $7::jsonb,
        'gpt-5.6-sol', 'webchess-division-v2', repeat('b', 64),
        repeat('c', 64), $8::smallint, $9::text, $10::text,
        $11::text, '2.0.0', $12::timestamptz, $12::timestamptz
      )
    `,
    values: [
      id,
      ownerId,
      sourceGameId,
      PROBLEM,
      divisionSeed,
      JSON.stringify(facets),
      JSON.stringify(parts),
      CURRENT_GAME_VERSIONS.event,
      CURRENT_GAME_VERSIONS.rules,
      CURRENT_GAME_VERSIONS.engine,
      CURRENT_GAME_VERSIONS.cast,
      now.toISOString(),
    ],
  })

  return {
    id,
    sourceGameId,
    isCurrent: false,
    revision: 1,
    status: 'mapped',
    problem: PROBLEM,
    division: {
      seed: divisionSeed,
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
}

async function advanceToGateFailure(
  gameId: string,
  terminalEvidence?: {
    readonly fingerprint: string
    readonly survivors: readonly SurvivorCandidate[]
  },
) {
  let lifecycle = await repository.getForGame(RETRY_OWNER, gameId)
  if (!lifecycle) throw new Error('The retry lineage fixture has no lifecycle run.')

  const transitions = [
    ['chess_playing', 'chess', 'game_started'],
    ['chess_terminal', 'chess', 'terminal_replay_verified'],
    ['portia_pending', 'portia', 'adversarial_review_authorized'],
    ['portia_running', 'portia', 'adversarial_review_started'],
    ['portia_complete', 'portia', 'adversarial_review_completed'],
    ['gate_failed', 'gate', 'sufficiency_gate_failed'],
  ] as const

  for (const [to, stage, activityType] of transitions) {
    lifecycle = await repository.transition({
      ownerId: RETRY_OWNER,
      gameId,
      expectedRevision: lifecycle.revision,
      to,
      stage,
      activityType,
      ...(to === 'chess_terminal' && terminalEvidence
        ? {
            terminalFingerprint: terminalEvidence.fingerprint,
            survivors: terminalEvidence.survivors,
          }
        : {}),
      configurationDigest: 'e'.repeat(64),
    })
  }

  return lifecycle
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
            'in_progress', 'gpt-5.6-sol', $3::text, '2.0.0'),
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
    const review = portiaReview(survivors)
    await database.adapter.query({
      text: `
        UPDATE model_requests
        SET status = 'in_progress', provider_started_at = now(), updated_at = now()
        WHERE id = '62000000-0000-4000-8000-000000000003'::uuid
      `,
    })
    lifecycle = await repository.beginPortiaAttempt({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      modelRequestId: '62000000-0000-4000-8000-000000000003',
      requestDigest: '1'.repeat(64),
      answerPromptDigest: review.reviewedAnswerPromptDigest,
      activityType: 'adversarial_review_started',
      configurationDigest: 'd'.repeat(64),
    })
    expect(lifecycle).toMatchObject({
      portiaActiveModelRequestId: '62000000-0000-4000-8000-000000000003',
      portiaFailedAttemptCount: 0,
      portiaFailureLimit: 3,
    })
    lifecycle = await repository.updatePortiaProgress({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      modelRequestId: '62000000-0000-4000-8000-000000000003',
      answerPromptDigest: review.reviewedAnswerPromptDigest,
      currentCandidateId: survivors[0]!.candidateId,
      completedCandidateIds: [],
      completedAssessments: [],
    })
    expect(lifecycle).toMatchObject({
      answerPromptDigest: review.reviewedAnswerPromptDigest,
      portiaProgress: {
        currentCandidateId: survivors[0]!.candidateId,
        completedCandidateIds: [],
      },
    })
    await database.adapter.query({
      text: `
        UPDATE model_requests
        SET status = 'succeeded',
            response_sha256 = repeat('2', 64),
            result_payload = $2::jsonb,
            completed_at = now(),
            updated_at = now()
        WHERE id = $1::uuid
      `,
      values: [
        '62000000-0000-4000-8000-000000000003',
        JSON.stringify({
          format: 'webchess-portia-result/1',
          review,
        }),
      ],
    })
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
    expect(lifecycle).toMatchObject({
      portia: review,
      answerPromptDigest: review.reviewedAnswerPromptDigest,
      portiaProgress: {
        currentCandidateId: null,
        completedCandidateIds: review.assessments.map(
          (assessment) => assessment.candidateId,
        ),
        completedAssessments: review.assessments,
      },
    })

    const gate = evaluateGate(review)
    expect(gate.passed).toBe(true)
    expect(gate.recommendedNextTransition).toBe('answer')
    await expect(repository.storeGate({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      result: gate,
      answerUserPrompt: null,
      configurationDigest: 'd'.repeat(64),
    })).rejects.toMatchObject({ code: 'invalid-input' })
    lifecycle = await repository.storeGate({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      result: gate,
      answerUserPrompt: '{\n  "reviewed_prompt": "exact player-visible input"\n}',
      configurationDigest: 'd'.repeat(64),
    })
    expect(lifecycle.answerUserPrompt).toBe(
      '{\n  "reviewed_prompt": "exact player-visible input"\n}',
    )
    expect(lifecycle.answerUserPromptSha256).toMatch(/^[0-9a-f]{64}$/u)
    await expect(new DurableLifecycleRepository(database.adapter).getForGame(
      OWNER,
      GAME_ID,
    )).resolves.toMatchObject({
      answerUserPrompt:
        '{\n  "reviewed_prompt": "exact player-visible input"\n}',
      answerUserPromptSha256: lifecycle.answerUserPromptSha256,
    })
    const gateRevision = lifecycle.revision
    await database.adapter.query({
      text: `
        UPDATE gate_decisions
        SET answer_user_prompt = NULL,
            answer_user_prompt_sha256 = NULL
        WHERE clerk_user_id = $1::text
          AND lifecycle_run_id = $2::uuid
      `,
      values: [OWNER, lifecycle.id],
    })
    await expect(repository.getForGame(OWNER, GAME_ID)).resolves.toMatchObject({
      revision: gateRevision,
      state: 'gate_passed',
      answerUserPrompt: null,
      answerUserPromptSha256: null,
    })
    const historicalGateBackfill = {
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: gateRevision,
      result: gate,
      answerUserPrompt: '{\n  "reviewed_prompt": "exact player-visible input"\n}',
      configurationDigest: 'd'.repeat(64),
    } as const
    const [firstBackfill, concurrentBackfill] = await Promise.all([
      repository.storeGate(historicalGateBackfill),
      repository.storeGate(historicalGateBackfill),
    ])
    lifecycle = firstBackfill
    expect(lifecycle).toMatchObject({
      revision: gateRevision,
      state: 'gate_passed',
      answerUserPrompt: '{\n  "reviewed_prompt": "exact player-visible input"\n}',
      answerUserPromptSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    })
    expect(concurrentBackfill).toMatchObject({
      revision: gateRevision,
      answerUserPrompt: lifecycle.answerUserPrompt,
      answerUserPromptSha256: lifecycle.answerUserPromptSha256,
    })
    await expect(repository.storeGate({
      ...historicalGateBackfill,
      answerUserPrompt: '{"reviewed_prompt":"competing value"}',
    })).rejects.toMatchObject({ code: 'conflict' })
    lifecycle = await repository.transition({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      to: 'charlotte_pending',
      stage: 'charlotte',
      activityType: 'qualification_authorized',
      configurationDigest: 'd'.repeat(64),
    })
    await database.adapter.query({
      text: `
        UPDATE model_requests
        SET status = 'in_progress', provider_started_at = now(), updated_at = now()
        WHERE id = '62000000-0000-4000-8000-000000000004'::uuid
      `,
    })
    lifecycle = await repository.beginCharlotteAttempt({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      modelRequestId: '62000000-0000-4000-8000-000000000004',
      requestDigest: '3'.repeat(64),
      activityType: 'qualification_started',
      configurationDigest: 'd'.repeat(64),
    })
    expect(lifecycle).toMatchObject({
      state: 'charlotte_running',
      charlotteActiveModelRequestId:
        '62000000-0000-4000-8000-000000000004',
      charlotteFailedAttemptCount: 0,
      charlotteFailureLimit: 3,
    })
    const charlotte = charlotteResult(survivors)
    const renderedCharlotte = `${charlotte.directAnswer} ${charlotte.recommendation}`
    await database.adapter.query({
      text: `
        UPDATE model_requests
        SET status = 'succeeded',
            response_sha256 = repeat('4', 64),
            result_payload = $2::jsonb,
            completed_at = now(),
            updated_at = now()
        WHERE id = $1::uuid
      `,
      values: [
        '62000000-0000-4000-8000-000000000004',
        JSON.stringify({
          format: 'webchess-charlotte-result/3',
          structured: charlotte,
          renderedAnswer: renderedCharlotte,
          wordCount: 450,
          source: {
            lifecycleRunId: lifecycle.id,
            boardAnswerDigest: '5'.repeat(64),
            reviewedPromptDigest: review.reviewedAnswerPromptDigest,
            gateInputDigest: gate.inputDigest,
          },
        }),
      ],
    })
    await expect(repository.storeCharlotte({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      modelRequestId: '62000000-0000-4000-8000-000000000004',
      inputDigest: '9'.repeat(64),
      outputDigest: '4'.repeat(64),
      result: charlotte,
      renderedAnswer: renderedCharlotte,
      configurationDigest: 'd'.repeat(64),
    })).rejects.toMatchObject({ code: 'conflict' })
    lifecycle = await repository.storeCharlotte({
      ownerId: OWNER,
      gameId: GAME_ID,
      expectedRevision: lifecycle.revision,
      modelRequestId: '62000000-0000-4000-8000-000000000004',
      inputDigest: '3'.repeat(64),
      outputDigest: '4'.repeat(64),
      result: charlotte,
      renderedAnswer: renderedCharlotte,
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

  it('preserves bounded Retry counters across a complete root lineage', async () => {
    await database.adapter.query({
      text: `INSERT INTO user_controls (clerk_user_id) VALUES ($1::text)`,
      values: [RETRY_OWNER],
    })

    const rootGame = await insertMappedRetryGame(
      '63000000-0000-4000-8000-000000000001',
      null,
      'retry-lineage-root-field',
    )
    const firstReplayGame = await insertMappedRetryGame(
      '63000000-0000-4000-8000-000000000002',
      rootGame.id,
      rootGame.division!.seed,
    )
    const secondReplayGame = await insertMappedRetryGame(
      '63000000-0000-4000-8000-000000000003',
      firstReplayGame.id,
      rootGame.division!.seed,
    )
    const regeneratedFieldGame = await insertMappedRetryGame(
      '63000000-0000-4000-8000-000000000004',
      secondReplayGame.id,
      'retry-lineage-regenerated-field',
    )

    const root = await repository.ensureForGame({
      ownerId: RETRY_OWNER,
      game: rootGame,
      trajectorySeed: 'retry-lineage-trajectory-root',
    })
    const repeatedEcology = Array.from({ length: 4 }, (_, index) => survivor(index))
    await advanceToGateFailure(rootGame.id, {
      fingerprint: 'f'.repeat(64),
      survivors: repeatedEcology,
    })

    const firstReplay = await repository.createRetryRun({
      ownerId: RETRY_OWNER,
      parentGameId: rootGame.id,
      childGame: firstReplayGame,
      trajectorySeed: 'retry-lineage-trajectory-replay-one',
      mode: 'replay_game',
      reason: 'The first independent trajectory is authorized.',
      configurationDigest: 'e'.repeat(64),
    })
    expect(firstReplay).toMatchObject({
      rootRunId: root.id,
      parentRunId: root.id,
      fieldGeneration: 1,
      gameAttempt: 2,
      sameFieldRetryCount: 1,
      fieldRegenerationCount: 0,
    })
    const firstReplayFailure = await advanceToGateFailure(firstReplayGame.id, {
      fingerprint: terminalFingerprint(repeatedEcology),
      survivors: repeatedEcology,
    })
    await expect(repository.hasPriorTerminalFingerprint(
      RETRY_OWNER,
      firstReplayFailure.rootRunId,
      firstReplayFailure.terminalFingerprint!,
      firstReplayFailure.id,
    )).resolves.toBe(true)

    const secondReplay = await repository.createRetryRun({
      ownerId: RETRY_OWNER,
      parentGameId: firstReplayGame.id,
      childGame: secondReplayGame,
      trajectorySeed: 'retry-lineage-trajectory-replay-two',
      mode: 'replay_game',
      reason: 'The second independent trajectory is authorized.',
      configurationDigest: 'e'.repeat(64),
    })
    expect(secondReplay).toMatchObject({
      rootRunId: root.id,
      parentRunId: firstReplay.id,
      fieldGeneration: 1,
      gameAttempt: 3,
      sameFieldRetryCount: 2,
      fieldRegenerationCount: 0,
    })
    await advanceToGateFailure(secondReplayGame.id)

    const regeneratedField = await repository.createRetryRun({
      ownerId: RETRY_OWNER,
      parentGameId: secondReplayGame.id,
      childGame: regeneratedFieldGame,
      trajectorySeed: 'retry-lineage-trajectory-regenerated-field',
      mode: 'regenerate_field',
      reason: 'The one bounded semantic field regeneration is authorized.',
      configurationDigest: 'e'.repeat(64),
    })
    expect(regeneratedField).toMatchObject({
      rootRunId: root.id,
      parentRunId: secondReplay.id,
      fieldGeneration: 2,
      gameAttempt: 1,
      sameFieldRetryCount: 2,
      fieldRegenerationCount: 1,
    })

    const boundedGame = await insertMappedRetryGame(
      '63000000-0000-4000-8000-000000000005',
      null,
      'portia-bounded-failure-field',
    )
    let bounded = await repository.ensureForGame({
      ownerId: RETRY_OWNER,
      game: boundedGame,
      trajectorySeed: 'portia-bounded-failure-trajectory',
    })
    bounded = await repository.transition({
      ownerId: RETRY_OWNER,
      gameId: boundedGame.id,
      expectedRevision: bounded.revision,
      to: 'chess_playing',
      stage: 'chess',
      activityType: 'game_started',
      configurationDigest: 'e'.repeat(64),
    })
    const boundedSurvivors = Array.from({ length: 4 }, (_, index) => ({
      ...survivor(index),
      candidateId: `bounded-${index}:white-piece-${index}`,
      terminalGameId: boundedGame.id,
      attemptId: bounded.id,
    }))
    bounded = await repository.transition({
      ownerId: RETRY_OWNER,
      gameId: boundedGame.id,
      expectedRevision: bounded.revision,
      to: 'chess_terminal',
      stage: 'chess',
      activityType: 'terminal_replay_verified',
      terminalFingerprint: terminalFingerprint(boundedSurvivors),
      survivors: boundedSurvivors,
      configurationDigest: 'e'.repeat(64),
    })
    bounded = await repository.transition({
      ownerId: RETRY_OWNER,
      gameId: boundedGame.id,
      expectedRevision: bounded.revision,
      to: 'portia_pending',
      stage: 'portia',
      activityType: 'adversarial_review_authorized',
      configurationDigest: 'e'.repeat(64),
    })
    const boundedReview = portiaReview(boundedSurvivors)
    const firstAssessment = boundedReview.assessments[0]!
    let firstFailedRequestId = ''
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const requestId = `64000000-0000-4000-8000-${String(attempt).padStart(12, '0')}`
      const idempotencyKey = `64000000-0000-4000-8001-${String(attempt).padStart(12, '0')}`
      const requestDigest = String(attempt).repeat(64)
      await database.adapter.query({
        text: `
          INSERT INTO model_requests (
            id, clerk_user_id, game_id, operation, idempotency_key,
            request_sha256, status, model, prompt_version, software_version,
            provider_started_at
          )
          VALUES (
            $1::uuid, $2::text, $3::uuid, 'portia', $4::uuid,
            $5::char(64), 'in_progress', 'gpt-5.6-sol', $6::text,
            '2.0.0', now()
          )
        `,
        values: [
          requestId,
          RETRY_OWNER,
          boundedGame.id,
          idempotencyKey,
          requestDigest,
          CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
        ],
      })
      bounded = await repository.beginPortiaAttempt({
        ownerId: RETRY_OWNER,
        gameId: boundedGame.id,
        expectedRevision: bounded.revision,
        modelRequestId: requestId,
        requestDigest,
        answerPromptDigest: boundedReview.reviewedAnswerPromptDigest,
        activityType: 'adversarial_review_started',
        configurationDigest: 'e'.repeat(64),
      })
      if (attempt === 1) {
        firstFailedRequestId = requestId
        bounded = await repository.updatePortiaProgress({
          ownerId: RETRY_OWNER,
          gameId: boundedGame.id,
          expectedRevision: bounded.revision,
          modelRequestId: requestId,
          answerPromptDigest: boundedReview.reviewedAnswerPromptDigest,
          currentCandidateId: boundedSurvivors[1]!.candidateId,
          completedCandidateIds: [boundedSurvivors[0]!.candidateId],
          completedAssessments: [firstAssessment],
        })
      } else if (attempt === 2) {
        await expect(repository.updatePortiaProgress({
          ownerId: RETRY_OWNER,
          gameId: boundedGame.id,
          expectedRevision: bounded.revision,
          modelRequestId: firstFailedRequestId,
          answerPromptDigest: boundedReview.reviewedAnswerPromptDigest,
          currentCandidateId: boundedSurvivors[2]!.candidateId,
          completedCandidateIds: [
            boundedSurvivors[0]!.candidateId,
            boundedSurvivors[1]!.candidateId,
          ],
          completedAssessments: [
            firstAssessment,
            boundedReview.assessments[1]!,
          ],
        })).rejects.toMatchObject({ code: 'conflict' })
      }
      await database.adapter.query({
        text: `
          UPDATE model_requests
          SET status = 'failed', failure_code = 'provider_contract_invalid',
              completed_at = now(), updated_at = now()
          WHERE id = $1::uuid
        `,
        values: [requestId],
      })
      bounded = await repository.failPortiaAttempt({
        ownerId: RETRY_OWNER,
        gameId: boundedGame.id,
        expectedRevision: bounded.revision,
        modelRequestId: requestId,
        requestDigest,
        activityType: 'adversarial_review_failed',
        configurationDigest: 'e'.repeat(64),
      })
      expect(bounded.portiaFailedAttemptCount).toBe(attempt)
      expect(bounded.portiaProgress.completedAssessments).toEqual([firstAssessment])
      expect(bounded.state).toBe(attempt === 3 ? 'portia_unavailable' : 'portia_pending')
    }
    const reloaded = await new DurableLifecycleRepository(database.adapter)
      .getForGame(RETRY_OWNER, boundedGame.id)
    expect(reloaded).toMatchObject({
      state: 'portia_unavailable',
      portiaActiveModelRequestId: null,
      portiaFailedAttemptCount: 3,
      portiaFailureLimit: 3,
      portia: null,
      gate: null,
    })
  })

  it('fences Charlotte to three exact failed provider attempts and refuses a fourth', async () => {
    await database.adapter.query({
      text: `INSERT INTO user_controls (clerk_user_id) VALUES ($1::text)`,
      values: [CHARLOTTE_OWNER],
    })
    const boundedGame = await insertMappedRetryGame(
      '65000000-0000-4000-8000-000000000001',
      null,
      'charlotte-bounded-failure-field',
      CHARLOTTE_OWNER,
    )
    let bounded = await repository.ensureForGame({
      ownerId: CHARLOTTE_OWNER,
      game: boundedGame,
      trajectorySeed: 'charlotte-bounded-failure-trajectory',
    })
    for (const [to, stage, activityType] of [
      ['chess_playing', 'chess', 'game_started'],
      ['chess_terminal', 'chess', 'terminal_replay_verified'],
      ['portia_pending', 'portia', 'adversarial_review_authorized'],
      ['portia_running', 'portia', 'adversarial_review_started'],
      ['portia_complete', 'portia', 'adversarial_review_completed'],
      ['gate_passed', 'gate', 'sufficiency_passed'],
      ['charlotte_pending', 'charlotte', 'qualification_authorized'],
    ] as const) {
      bounded = await repository.transition({
        ownerId: CHARLOTTE_OWNER,
        gameId: boundedGame.id,
        expectedRevision: bounded.revision,
        to,
        stage,
        activityType,
        configurationDigest: '6'.repeat(64),
      })
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const suffix = String(attempt).padStart(12, '0')
      const requestId = `65000000-0000-4000-8001-${suffix}`
      const requestDigest = String(attempt).repeat(64)
      await database.adapter.query({
        text: `
          INSERT INTO model_requests (
            id, clerk_user_id, game_id, operation, idempotency_key,
            request_sha256, status, model, prompt_version, software_version,
            provider_started_at
          )
          VALUES (
            $1::uuid, $2::text, $3::uuid, 'charlotte', $4::uuid,
            $5::char(64), 'in_progress', 'gpt-5.6-sol', $6::text,
            '2.0.0', now()
          )
        `,
        values: [
          requestId,
          CHARLOTTE_OWNER,
          boundedGame.id,
          `65000000-0000-4000-8002-${suffix}`,
          requestDigest,
          CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
        ],
      })
      bounded = await repository.beginCharlotteAttempt({
        ownerId: CHARLOTTE_OWNER,
        gameId: boundedGame.id,
        expectedRevision: bounded.revision,
        modelRequestId: requestId,
        requestDigest,
        activityType: 'qualification_started',
        configurationDigest: '6'.repeat(64),
      })
      expect(bounded).toMatchObject({
        state: 'charlotte_running',
        charlotteActiveModelRequestId: requestId,
        charlotteFailedAttemptCount: attempt - 1,
        charlotteFailureLimit: 3,
      })

      await database.adapter.query({
        text: `
          UPDATE model_requests
          SET status = 'failed', failure_code = 'provider_contract_invalid',
              completed_at = now(), updated_at = now()
          WHERE id = $1::uuid
        `,
        values: [requestId],
      })
      bounded = await repository.failCharlotteAttempt({
        ownerId: CHARLOTTE_OWNER,
        gameId: boundedGame.id,
        expectedRevision: bounded.revision,
        modelRequestId: requestId,
        requestDigest,
        activityType: 'qualification_failed',
        configurationDigest: '6'.repeat(64),
      })
      expect(bounded).toMatchObject({
        state: attempt === 3
          ? 'charlotte_unavailable'
          : 'charlotte_pending',
        charlotteActiveModelRequestId: null,
        charlotteFailedAttemptCount: attempt,
        charlotteFailureLimit: 3,
        charlotte: null,
      })
    }

    const fourthRequestId = '65000000-0000-4000-8001-000000000004'
    await database.adapter.query({
      text: `
        INSERT INTO model_requests (
          id, clerk_user_id, game_id, operation, idempotency_key,
          request_sha256, status, model, prompt_version, software_version,
          provider_started_at
        )
        VALUES (
          $1::uuid, $2::text, $3::uuid, 'charlotte',
          '65000000-0000-4000-8002-000000000004'::uuid,
          repeat('4', 64), 'in_progress', 'gpt-5.6-sol', $4::text,
          '2.0.0', now()
        )
      `,
      values: [
        fourthRequestId,
        CHARLOTTE_OWNER,
        boundedGame.id,
        CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
      ],
    })
    await expect(repository.beginCharlotteAttempt({
      ownerId: CHARLOTTE_OWNER,
      gameId: boundedGame.id,
      expectedRevision: bounded.revision,
      modelRequestId: fourthRequestId,
      requestDigest: '4'.repeat(64),
      activityType: 'qualification_started',
      configurationDigest: '6'.repeat(64),
    })).rejects.toMatchObject({ code: 'conflict' })

    const reloaded = await new DurableLifecycleRepository(database.adapter)
      .getForGame(CHARLOTTE_OWNER, boundedGame.id)
    expect(reloaded).toMatchObject({
      state: 'charlotte_unavailable',
      charlotteActiveModelRequestId: null,
      charlotteFailedAttemptCount: 3,
      charlotteFailureLimit: 3,
      charlotte: null,
    })
    expect(reloaded?.activities.at(-1)).toMatchObject({
      activityType: 'qualification_attempt_budget_exhausted',
      stateFrom: 'charlotte_running',
      stateTo: 'charlotte_unavailable',
      status: 'refused',
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
