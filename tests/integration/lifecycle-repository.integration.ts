import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CURRENT_GAME_VERSIONS } from '../../src/lib/game-contract'
import { createReplayState, toGameView } from '../../src/lib/game-replay'
import {
  CURRENT_LIFECYCLE_VERSIONS,
  LEGACY_PROMPT_BOUND_PORTIA_CONTRACT_VERSION,
  deriveSurvivorCandidates,
  evaluateGate,
  terminalFingerprint,
} from '../../src/lib/lifecycle'
import { deriveTrajectoryDirectionalRecord } from '../../src/lib/lifecycle/trajectory-direction'
import { PORTIA_ATTACK_TYPES } from '../../src/lib/lifecycle/contracts'
import type {
  CharlotteResult,
  PortiaReview,
  SurvivorCandidate,
} from '../../src/lib/lifecycle/contracts'
import { RESEARCH_CONSENT_VERSION } from '../../src/lib/research'
import {
  makeProblemFacets,
  makeProblemParts,
  makeTrajectoryDirectionalFixture,
} from '../../src/test/fixtures'
import { MAX_PERSISTED_MODEL_PROMPT_CHARS } from '../../src/types'
import type { DurableGameSnapshot } from '../../src/server/games'
import { DurableLifecycleRepository } from '../../src/server/lifecycle'
import {
  createPostgresTestDatabase,
} from './postgres-test-database'
import type { PostgresTestDatabase } from './postgres-test-database'

const OWNER = 'user_lifecycle_repository_integration'
const RETRY_OWNER = 'user_lifecycle_retry_lineage_integration'
const CHARLOTTE_OWNER = 'user_lifecycle_charlotte_fence_integration'
const DIRECTIONAL_OWNER = 'user_lifecycle_directional_record_integration'
const GATE_PROMPT_OWNER = 'user_lifecycle_gate_prompt_integration'
const GAME_ID = '62000000-0000-4000-8000-0000000000a1'
const DIRECTIONAL_GAME_ID = '62000000-0000-4000-8000-0000000000d1'
const GATE_PROMPT_GAME_ID = '66000000-0000-4000-8000-000000000001'
const PROBLEM = 'How should this lifecycle preserve evidence while moving toward action?'

function utf8Bytes(values: readonly string[]): number {
  return values.reduce(
    (total, value) => total + Buffer.byteLength(value, 'utf8'),
    0,
  )
}

let database: PostgresTestDatabase
let repository: DurableLifecycleRepository
let game: DurableGameSnapshot

async function claimAndAdmitWilburMutation(input: {
  idempotencyKey: string
  operation: 'create_action' | 'update_action' | 'append_observation'
  requestDigest: string
  actionId: string | null
  rateKind: 'action' | 'observation'
  reservedFutureRows: 1 | 2
  reservedTextBytes: number
  storageRowLimit?: number
  storageTextBytesLimit?: number
}) {
  const claim = await repository.claimWilburMutation({
    ownerId: OWNER,
    gameId: GAME_ID,
    storageRowLimit: 500,
    storageTextBytesLimit: 250_000,
    ...input,
  })
  expect(claim).toEqual({ kind: 'pending' })
  await database.adapter.query({
    text: `
      UPDATE wilbur_mutation_requests
      SET rate_admitted_at = now(), updated_at = now()
      WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid
    `,
    values: [OWNER, input.idempotencyKey],
  })
}

async function readWilburStorageEnvelope(ownerId: string) {
  const result = await database.adapter.query<{
    action_rows: number
    observation_rows: number
    event_rows: number
    ledger_rows: number
    pending_future_rows: number
  }>({
    text: `
      SELECT
        (
          SELECT count(*)::integer FROM wilbur_actions
          WHERE clerk_user_id = $1::text
        ) AS action_rows,
        (
          SELECT count(*)::integer FROM wilbur_observations
          WHERE clerk_user_id = $1::text
        ) AS observation_rows,
        (
          SELECT count(*)::integer FROM lifecycle_events
          WHERE clerk_user_id = $1::text AND stage = 'wilbur'
        ) AS event_rows,
        (
          SELECT count(*)::integer FROM wilbur_mutation_requests
          WHERE clerk_user_id = $1::text
        ) AS ledger_rows,
        (
          SELECT coalesce(sum(reserved_future_rows), 0)::integer
          FROM wilbur_mutation_requests
          WHERE clerk_user_id = $1::text
            AND status = 'pending'
            AND updated_at >= now() - interval '24 hours'
        ) AS pending_future_rows
    `,
    values: [ownerId],
  })
  const row = result.rows[0]!
  const durableRows =
    row.action_rows + row.observation_rows + row.event_rows + row.ledger_rows
  return {
    ...row,
    durableRows,
    totalRows: durableRows + row.pending_future_rows,
  }
}

async function installWilburActivityFailure(): Promise<void> {
  await database.adapter.query({
    text: `
      CREATE OR REPLACE FUNCTION reject_wilbur_activity_for_test()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        RAISE EXCEPTION 'injected lifecycle activity failure';
      END
      $function$
    `,
  })
  await database.adapter.query({
    text: `
      CREATE TRIGGER reject_wilbur_activity_for_test
      BEFORE INSERT ON lifecycle_events
      FOR EACH ROW
      WHEN (NEW.stage = 'wilbur')
      EXECUTE FUNCTION reject_wilbur_activity_for_test()
    `,
  })
}

async function removeWilburActivityFailure(): Promise<void> {
  await database.adapter.query({
    text: 'DROP TRIGGER reject_wilbur_activity_for_test ON lifecycle_events',
  })
  await database.adapter.query({
    text: 'DROP FUNCTION reject_wilbur_activity_for_test()',
  })
}

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

async function markLifecycleLegacy(
  ownerId: string,
  gameId: string,
) {
  await database.adapter.query({
    text: `
      UPDATE lifecycle_runs
      SET lifecycle_version = 'webchess-lifecycle-v2.4'
      WHERE clerk_user_id = $1::text AND game_id = $2::uuid
    `,
    values: [ownerId, gameId],
  })
  const lifecycle = await repository.getForGame(ownerId, gameId)
  if (!lifecycle) throw new Error('The legacy lifecycle fixture is missing.')
  return lifecycle
}

async function createDirectionalTerminalFixture() {
  const fixture = makeTrajectoryDirectionalFixture()
  const now = new Date('2026-08-01T20:30:00.000Z')
  const facets = fixture.parts.map((part) => ({
    id: part.id,
    title: part.title,
    focus: part.focus,
    question: part.prompt,
    keyword: part.keyword,
    castApplication: part.castApplication,
  }))
  await database.adapter.query({
    text: `INSERT INTO user_controls (clerk_user_id) VALUES ($1::text)`,
    values: [DIRECTIONAL_OWNER],
  })
  await database.adapter.query({
    text: `
      INSERT INTO games (
        id, clerk_user_id, is_current, revision, status, problem,
        problem_sha256, research_consent_version,
        research_consent_decision, research_consent_recorded_at,
        division_seed, division_facets, problem_parts,
        division_model, division_prompt_version, division_prompt_sha256,
        division_digest, event_version, rules_version, engine_version,
        cast_version, software_version, created_at, updated_at
      )
      VALUES (
        $1::uuid, $2::text, false, 1, 'playing', $3::text,
        repeat('a', 64), 'webchess-research-consent-v1',
        'no_external_research', $11::timestamptz,
        $4::text, $5::jsonb, $6::jsonb,
        'gpt-5.6-sol', 'webchess-division-v4', repeat('b', 64),
        $7::char(64), $8::smallint, $9::text, $10::text,
        $12::text, '2.2.0-rc.1', $11::timestamptz, $11::timestamptz
      )
    `,
    values: [
      DIRECTIONAL_GAME_ID,
      DIRECTIONAL_OWNER,
      PROBLEM,
      fixture.divisionSeed,
      JSON.stringify(facets),
      JSON.stringify(fixture.parts),
      fixture.divisionDigest,
      CURRENT_GAME_VERSIONS.event,
      CURRENT_GAME_VERSIONS.rules,
      CURRENT_GAME_VERSIONS.engine,
      now.toISOString(),
      CURRENT_GAME_VERSIONS.cast,
    ],
  })
  const snapshot: DurableGameSnapshot = {
    id: DIRECTIONAL_GAME_ID,
    sourceGameId: null,
    isCurrent: false,
    revision: 1,
    status: 'playing',
    problem: PROBLEM,
    researchConsent: {
      version: RESEARCH_CONSENT_VERSION,
      decision: 'no_external_research',
      recordedAt: now.toISOString(),
    },
    division: {
      seed: fixture.divisionSeed,
      facets,
      parts: fixture.parts,
      model: 'gpt-5.6-sol',
      promptVersion: 'webchess-division-v4',
      promptSha256: 'b'.repeat(64),
      digest: fixture.divisionDigest,
    },
    game: toGameView(createReplayState()),
    answer: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    answeredAt: null,
  }
  const lifecycle = await repository.ensureForGame({
    ownerId: DIRECTIONAL_OWNER,
    game: snapshot,
    trajectorySeed: fixture.trajectorySeed,
  })
  const eventRows = fixture.state.events.map((event) => ({
    ply: event.ply,
    kind: event.type === 'move' ? 'move' : 'pass',
    source: event.type === 'move' ? 'client' : 'server',
    side: event.side,
    piece_id: event.type === 'move' ? event.pieceId : null,
    captured_piece_id:
      event.type === 'move' ? event.capturedPieceId ?? null : null,
    promoted_to: event.type === 'move' ? event.promotedTo ?? null : null,
    from_ring: event.type === 'move' ? event.from.ring : null,
    from_sector: event.type === 'move' ? event.from.sector : null,
    to_ring: event.type === 'move' ? event.to.ring : null,
    to_sector: event.type === 'move' ? event.to.sector : null,
    idempotency_key:
      event.type === 'move'
        ? `62000000-0000-4001-8000-${String(event.ply).padStart(12, '0')}`
        : null,
    request_sha256: event.type === 'move' ? 'e'.repeat(64) : null,
    game_revision: event.ply,
  }))
  await database.adapter.transaction([
    {
      text: `
        UPDATE games
        SET status = 'completed', revision = $3::bigint,
            outcome = $4::jsonb, completed_at = $5::timestamptz,
            updated_at = $5::timestamptz
        WHERE id = $1::uuid AND clerk_user_id = $2::text
      `,
      values: [
        DIRECTIONAL_GAME_ID,
        DIRECTIONAL_OWNER,
        fixture.state.completedPlies,
        JSON.stringify(fixture.state.outcome),
        now.toISOString(),
      ],
    },
    {
      text: `
        INSERT INTO game_events (
          game_id, ply, kind, source, side, piece_id,
          captured_piece_id, promoted_to, from_ring, from_sector,
          to_ring, to_sector, idempotency_key, request_sha256, game_revision
        )
        SELECT $1::uuid, event.ply, event.kind, event.source, event.side,
          event.piece_id, event.captured_piece_id, event.promoted_to,
          event.from_ring, event.from_sector, event.to_ring, event.to_sector,
          event.idempotency_key, event.request_sha256, event.game_revision
        FROM jsonb_to_recordset($2::jsonb) AS event(
          ply smallint, kind text, source text, side text, piece_id text,
          captured_piece_id text, promoted_to text, from_ring smallint,
          from_sector smallint, to_ring smallint, to_sector smallint,
          idempotency_key uuid, request_sha256 char(64), game_revision bigint
        )
      `,
      values: [DIRECTIONAL_GAME_ID, JSON.stringify(eventRows)],
    },
  ])
  const survivors = deriveSurvivorCandidates(
    fixture.state,
    fixture.parts,
    {
      gameId: DIRECTIONAL_GAME_ID,
      attemptId: lifecycle.id,
      divisionDigest: fixture.divisionDigest,
      rulesVersion: fixture.state.versions.rules,
      engineVersion: fixture.state.versions.engine,
      castVersion: fixture.state.versions.cast,
      eventVersion: fixture.state.versions.event,
    },
  )
  const record = deriveTrajectoryDirectionalRecord({
    divisionDigest: fixture.divisionDigest,
    divisionSeed: lifecycle.divisionSeed,
    castSeed: lifecycle.castSeed,
    trajectorySeed: lifecycle.trajectorySeed,
    versions: fixture.state.versions,
    parts: fixture.parts,
    events: fixture.state.events,
  })
  return {
    lifecycle,
    record,
    survivors,
    terminalFingerprint: terminalFingerprint(survivors),
  }
}

function portiaReview(
  survivors: readonly SurvivorCandidate[],
  contractVersion:
    | typeof CURRENT_LIFECYCLE_VERSIONS.portiaContract
    | typeof LEGACY_PROMPT_BOUND_PORTIA_CONTRACT_VERSION =
      CURRENT_LIFECYCLE_VERSIONS.portiaContract,
): PortiaReview {
  const coverage = [
    'protected_outcome',
    'evidence_or_reality',
    'risk_or_countercase',
    'agency_or_action',
  ] as const
  return {
    contractVersion,
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
        problem, problem_sha256, research_consent_version,
        research_consent_decision, research_consent_recorded_at,
        division_seed, division_facets, problem_parts,
        division_model, division_prompt_version, division_prompt_sha256,
        division_digest, event_version, rules_version, engine_version,
        cast_version, software_version, created_at, updated_at
      )
      VALUES (
        $1::uuid, $2::text, $3::uuid, false, 1, 'mapped',
        $4::text, repeat('a', 64), 'webchess-research-consent-v1',
        'allow_search_and_page_fetch', $12::timestamptz,
        $5::text, $6::jsonb, $7::jsonb,
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
    researchConsent: {
      version: RESEARCH_CONSENT_VERSION,
      decision: 'allow_search_and_page_fetch',
      recordedAt: now.toISOString(),
    },
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
  if (lifecycle.versions.lifecycle === CURRENT_LIFECYCLE_VERSIONS.lifecycle) {
    lifecycle = await markLifecycleLegacy(RETRY_OWNER, gameId)
  }

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
        problem_sha256, research_consent_version,
        research_consent_decision, research_consent_recorded_at,
        division_seed, division_facets, problem_parts,
        division_model, division_prompt_version, division_prompt_sha256,
        division_digest, event_version, rules_version, engine_version,
        cast_version, software_version, created_at, updated_at
      )
      VALUES (
        $1::uuid, $2::text, true, 1, 'mapped', $3::text,
        repeat('a', 64), 'webchess-research-consent-v1',
        'allow_search_and_page_fetch', $11::timestamptz,
        $4::text, $5::jsonb, $6::jsonb,
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
    researchConsent: {
      version: RESEARCH_CONSENT_VERSION,
      decision: 'allow_search_and_page_fetch',
      recordedAt: now.toISOString(),
    },
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

  it('atomically binds, verifies, and preserves current trajectory direction evidence', async () => {
    const fixture = await createDirectionalTerminalFixture()
    const transitionInput = {
      ownerId: DIRECTIONAL_OWNER,
      gameId: DIRECTIONAL_GAME_ID,
      expectedRevision: fixture.lifecycle.revision,
      to: 'chess_terminal' as const,
      stage: 'chess' as const,
      activityType: 'terminal_directional_record_bound',
      terminalFingerprint: fixture.terminalFingerprint,
      survivors: fixture.survivors,
      trajectoryDirectionalRecord: fixture.record,
      configurationDigest: '9'.repeat(64),
    }

    await expect(repository.transition({
      ...transitionInput,
      trajectoryDirectionalRecord: undefined,
    })).rejects.toMatchObject({ code: 'invalid-input' })

    const mismatchedParts = fixture.record.field.parts.map((entry) => ({
      ...entry.part,
      castApplication:
        `${entry.part.castApplication} This trusted-source mismatch must fail.`,
    }))
    const sourceMismatchedRecord = deriveTrajectoryDirectionalRecord({
      divisionDigest: fixture.record.division.digest,
      divisionSeed: fixture.record.division.seed,
      castSeed: fixture.record.cast.lifecycleSeed,
      trajectorySeed: fixture.record.trajectory.seed,
      versions: makeTrajectoryDirectionalFixture().state.versions,
      parts: mismatchedParts,
      events: fixture.record.trajectory.events.map((entry) => entry.event),
    })
    await expect(repository.transition({
      ...transitionInput,
      trajectoryDirectionalRecord: sourceMismatchedRecord,
    })).rejects.toMatchObject({ code: 'invalid-input' })

    const survivorMutations: readonly {
      readonly label: string
      readonly survivors: readonly SurvivorCandidate[]
    }[] = [
      {
        label: 'final facet',
        survivors: fixture.survivors.map((candidate, index) =>
          index === 0
            ? {
                ...candidate,
                facet: {
                  ...candidate.facet,
                  title: `${candidate.facet.title} changed`,
                },
              }
            : candidate),
      },
      {
        label: 'candidate identity and role',
        survivors: fixture.survivors.map((candidate, index) =>
          index === 0
            ? {
                ...candidate,
                candidateId: `${candidate.candidateId}-changed`,
                pieceRole: `${candidate.pieceRole} changed`,
              }
            : candidate),
      },
      {
        label: 'capture lineage',
        survivors: fixture.survivors.map((candidate, index) =>
          index === 0
            ? {
                ...candidate,
                capturesMade: [
                  ...candidate.capturesMade,
                  'tampered-capture-id',
                ],
              }
            : candidate),
      },
      {
        label: 'attacked plies',
        survivors: fixture.survivors.map((candidate, index) =>
          index === 0
            ? {
                ...candidate,
                attackedPlies: [...candidate.attackedPlies, 256],
              }
            : candidate),
      },
      {
        label: 'source digest',
        survivors: fixture.survivors.map((candidate, index) =>
          index === 0
            ? { ...candidate, sourceDigest: '0'.repeat(64) }
            : candidate),
      },
    ]
    for (const mutation of survivorMutations) {
      await expect(
        repository.transition({
          ...transitionInput,
          survivors: mutation.survivors,
          terminalFingerprint: terminalFingerprint(mutation.survivors),
        }),
        mutation.label,
      ).rejects.toMatchObject({ code: 'invalid-input' })
    }

    await database.adapter.query({
      text: `
        CREATE FUNCTION reject_directional_activity_for_test()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $function$
        BEGIN
          RAISE EXCEPTION 'injected directional activity failure';
        END
        $function$
      `,
    })
    await database.adapter.query({
      text: `
        CREATE TRIGGER reject_directional_activity_for_test
        BEFORE INSERT ON lifecycle_events
        FOR EACH ROW
        WHEN (NEW.activity_type = 'terminal_directional_record_bound')
        EXECUTE FUNCTION reject_directional_activity_for_test()
      `,
    })
    await expect(repository.transition(transitionInput)).rejects.toThrow(
      'injected directional activity failure',
    )
    await database.adapter.query({
      text: 'DROP TRIGGER reject_directional_activity_for_test ON lifecycle_events',
    })
    await database.adapter.query({
      text: 'DROP FUNCTION reject_directional_activity_for_test()',
    })

    const afterRollback = await repository.getForGame(
      DIRECTIONAL_OWNER,
      DIRECTIONAL_GAME_ID,
    )
    expect(afterRollback).toMatchObject({
      state: 'chess_playing',
      revision: fixture.lifecycle.revision,
      terminalFingerprint: null,
      trajectoryDirectionalRecord: null,
      trajectoryDirectionalRecordStatus: 'not_terminal',
    })

    const terminal = await repository.transition(transitionInput)
    expect(terminal).toMatchObject({
      state: 'chess_terminal',
      revision: fixture.lifecycle.revision + 1,
      terminalFingerprint: fixture.terminalFingerprint,
      trajectoryDirectionalRecordStatus: 'bound',
      versions: {
        lifecycle: 'webchess-lifecycle-v2.5',
        trajectoryDirectionalRecord: fixture.record.version,
      },
    })
    expect(terminal.trajectoryDirectionalRecord).toEqual(fixture.record)
    expect(terminal.survivors).toEqual(fixture.survivors)

    const exactRetry = await repository.transition(transitionInput)
    expect(exactRetry.revision).toBe(terminal.revision)
    expect(exactRetry.activities).toHaveLength(terminal.activities.length)

    const tampered = structuredClone(fixture.record) as unknown as {
      explanation: string[]
    } & typeof fixture.record
    tampered.explanation[0] = `${tampered.explanation[0]} changed`
    await expect(repository.transition({
      ...transitionInput,
      trajectoryDirectionalRecord: tampered,
    })).rejects.toMatchObject({ code: 'invalid-input' })

    await expect(database.adapter.query({
      text: `
        UPDATE lifecycle_runs
        SET trajectory_directional_record_digest = repeat('0', 64)
        WHERE clerk_user_id = $1::text AND game_id = $2::uuid
      `,
      values: [DIRECTIONAL_OWNER, DIRECTIONAL_GAME_ID],
    })).rejects.toMatchObject({ code: '23514' })

    const persisted = await database.adapter.query<{
      terminal_fingerprint: string
      trajectory_directional_record_version: string
      trajectory_directional_record_digest: string
      trajectory_directional_record: Record<string, unknown>
      survivor_set: readonly unknown[]
    }>({
      text: `
        SELECT terminal_fingerprint,
          trajectory_directional_record_version,
          trajectory_directional_record_digest,
          trajectory_directional_record,
          survivor_set
        FROM lifecycle_runs
        WHERE clerk_user_id = $1::text AND game_id = $2::uuid
      `,
      values: [DIRECTIONAL_OWNER, DIRECTIONAL_GAME_ID],
    })
    expect(persisted.rows).toEqual([{
      terminal_fingerprint: fixture.terminalFingerprint,
      trajectory_directional_record_version: fixture.record.version,
      trajectory_directional_record_digest: fixture.record.digest,
      trajectory_directional_record: fixture.record,
      survivor_set: fixture.survivors,
    }])

    const storedTamper = fixture.survivors.map((candidate, index) =>
      index === 0
        ? { ...candidate, sourceDigest: '0'.repeat(64) }
        : candidate)
    await database.adapter.query({
      text: `
        ALTER TABLE lifecycle_runs
        DISABLE TRIGGER lifecycle_runs_trajectory_directional_record_guard
      `,
    })
    try {
      await database.adapter.query({
        text: `
          UPDATE lifecycle_runs
          SET survivor_set = $3::jsonb
          WHERE clerk_user_id = $1::text AND game_id = $2::uuid
        `,
        values: [
          DIRECTIONAL_OWNER,
          DIRECTIONAL_GAME_ID,
          JSON.stringify(storedTamper),
        ],
      })
      await database.adapter.query({
        text: `
          ALTER TABLE lifecycle_runs
          ENABLE TRIGGER lifecycle_runs_trajectory_directional_record_guard
        `,
      })
      await expect(repository.getForGame(
        DIRECTIONAL_OWNER,
        DIRECTIONAL_GAME_ID,
      )).rejects.toMatchObject({ code: 'invalid-state' })
    } finally {
      await database.adapter.query({
        text: `
          ALTER TABLE lifecycle_runs
          DISABLE TRIGGER lifecycle_runs_trajectory_directional_record_guard
        `,
      })
      await database.adapter.query({
        text: `
          UPDATE lifecycle_runs
          SET survivor_set = $3::jsonb
          WHERE clerk_user_id = $1::text AND game_id = $2::uuid
        `,
        values: [
          DIRECTIONAL_OWNER,
          DIRECTIONAL_GAME_ID,
          JSON.stringify(fixture.survivors),
        ],
      })
      await database.adapter.query({
        text: `
          ALTER TABLE lifecycle_runs
          ENABLE TRIGGER lifecycle_runs_trajectory_directional_record_guard
        `,
      })
    }
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
    const current = await markLifecycleLegacy(OWNER, GAME_ID)
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
    expect(lifecycle).toMatchObject({
      trajectoryDirectionalRecord: null,
      trajectoryDirectionalRecordStatus: 'legacy_pre_directional_generation',
      versions: {
        lifecycle: 'webchess-lifecycle-v2.4',
        trajectoryDirectionalRecord: null,
      },
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
    const review = portiaReview(
      survivors,
      LEGACY_PROMPT_BOUND_PORTIA_CONTRACT_VERSION,
    )
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
    const preservedLegacyContracts = await database.adapter.query<{
      contract_version: string
      algorithm_version: string
    }>({
      text: `
        SELECT review.contract_version, decision.algorithm_version
        FROM portia_reviews AS review
        INNER JOIN gate_decisions AS decision
          ON decision.lifecycle_run_id = review.lifecycle_run_id
        WHERE review.clerk_user_id = $1::text
          AND review.lifecycle_run_id = $2::uuid
      `,
      values: [OWNER, lifecycle.id],
    })
    expect(preservedLegacyContracts.rows).toEqual([{
      contract_version: LEGACY_PROMPT_BOUND_PORTIA_CONTRACT_VERSION,
      algorithm_version: 'webchess-gate-v4',
    }])
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

    const faultSuggestion = charlotte.exactlyThreeNextActions[1]
    const faultActionBytes = utf8Bytes([
      faultSuggestion.actor,
      faultSuggestion.smallestAction,
      faultSuggestion.assumptionBeingTested,
      faultSuggestion.expectedObservation,
      faultSuggestion.decisionThreshold,
      faultSuggestion.reviewHorizon,
    ])
    await database.adapter.query({
      text: `
        INSERT INTO wilbur_mutation_requests (
          clerk_user_id, idempotency_key, operation, request_digest,
          target_game_id, target_action_id, rate_kind,
          reserved_future_rows, reserved_text_bytes, created_at, updated_at
        )
        VALUES (
          $1::text, $2::uuid, 'create_action', $3::char(64),
          $4::uuid, NULL, 'action', 2, $5::bigint,
          now() - interval '25 hours', now() - interval '25 hours'
        )
      `,
      values: [
        OWNER,
        '62000000-0000-4000-8000-000000000012',
        '9'.repeat(64),
        GAME_ID,
        faultActionBytes,
      ],
    })
    await database.adapter.query({
      text: `
        UPDATE wilbur_mutation_requests
        SET rate_admitted_at = now() - interval '25 hours'
        WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid
      `,
      values: [OWNER, '62000000-0000-4000-8000-000000000012'],
    })
    await installWilburActivityFailure()
    try {
      await expect(repository.createWilburAction({
        ownerId: OWNER,
        gameId: GAME_ID,
        id: '62000000-0000-4000-8000-000000000013',
        idempotencyKey: '62000000-0000-4000-8000-000000000012',
        requestDigest: '9'.repeat(64),
        charlotteActionIndex: 1,
        actor: faultSuggestion.actor,
        action: faultSuggestion.smallestAction,
        testedAssumption: faultSuggestion.assumptionBeingTested,
        expectedObservation: faultSuggestion.expectedObservation,
        decisionThreshold: faultSuggestion.decisionThreshold,
        reviewHorizon: faultSuggestion.reviewHorizon,
        configurationDigest: 'd'.repeat(64),
      })).rejects.toThrow(/injected lifecycle activity failure/u)
    } finally {
      await removeWilburActivityFailure()
    }
    expect(await repository.getForGame(OWNER, GAME_ID)).toMatchObject({
      state: 'charlotte_complete',
      wilburActions: [],
    })
    const firstSuggestion = charlotte.exactlyThreeNextActions[0]
    const firstActionBytes = utf8Bytes([
      firstSuggestion.actor,
      firstSuggestion.smallestAction,
      firstSuggestion.assumptionBeingTested,
      firstSuggestion.expectedObservation,
      firstSuggestion.decisionThreshold,
      firstSuggestion.reviewHorizon,
    ])
    await claimAndAdmitWilburMutation({
      idempotencyKey: '62000000-0000-4000-8000-000000000006',
      operation: 'create_action',
      requestDigest: '5'.repeat(64),
      actionId: null,
      rateKind: 'action',
      reservedFutureRows: 2,
      reservedTextBytes: firstActionBytes,
    })
    await expect(repository.claimWilburMutation({
      ownerId: OWNER,
      gameId: GAME_ID.toUpperCase(),
      actionId: null,
      idempotencyKey: '62000000-0000-4000-8000-000000000006',
      operation: 'create_action',
      requestDigest: '5'.repeat(64),
      rateKind: 'action',
      reservedFutureRows: 2,
      reservedTextBytes: firstActionBytes,
      storageRowLimit: 1,
      storageTextBytesLimit: 1,
    })).resolves.toEqual({ kind: 'pending' })
    await expect(repository.claimWilburMutation({
      ownerId: OWNER,
      gameId: '62000000-0000-4000-8000-0000000000ff',
      actionId: null,
      idempotencyKey: '62000000-0000-4000-8000-000000000006',
      operation: 'create_action',
      requestDigest: '5'.repeat(64),
      rateKind: 'action',
      reservedFutureRows: 2,
      reservedTextBytes: firstActionBytes,
      storageRowLimit: 500,
      storageTextBytesLimit: 250_000,
    })).rejects.toMatchObject({ code: 'conflict' })
    await expect(repository.claimWilburMutation({
      ownerId: OWNER,
      gameId: GAME_ID,
      actionId: null,
      idempotencyKey: '62000000-0000-4000-8000-000000000006',
      operation: 'create_action',
      requestDigest: '5'.repeat(64),
      rateKind: 'action',
      reservedFutureRows: 2,
      reservedTextBytes: firstActionBytes + 1,
      storageRowLimit: 500,
      storageTextBytesLimit: 250_000,
    })).rejects.toMatchObject({ code: 'conflict' })
    const expiredClaim = await database.adapter.query<{
      status: string
      denial_code: string | null
      reserved_future_rows: number
      reserved_text_bytes: string
    }>({
      text: `
        SELECT status, denial_code, reserved_future_rows,
          reserved_text_bytes::text
        FROM wilbur_mutation_requests
        WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid
      `,
      values: [OWNER, '62000000-0000-4000-8000-000000000012'],
    })
    expect(expiredClaim.rows[0]).toMatchObject({
      status: 'denied',
      denial_code: 'WILBUR_MUTATION_EXPIRED',
      reserved_future_rows: 0,
      reserved_text_bytes: '0',
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
      followUpAt: '2026-08-09T20:00:00.000Z',
      configurationDigest: 'd'.repeat(64),
    })
    expect(action.charlotteBindingVersion).toBe(
      'webchess-charlotte-action-binding-v1',
    )
    await expect(repository.claimWilburMutation({
      ownerId: OWNER,
      gameId: GAME_ID,
      actionId: null,
      idempotencyKey: '62000000-0000-4000-8000-000000000006',
      operation: 'create_action',
      requestDigest: '5'.repeat(64),
      rateKind: 'action',
      reservedFutureRows: 2,
      reservedTextBytes: firstActionBytes,
      storageRowLimit: 500,
      storageTextBytesLimit: 250_000,
    })).resolves.toEqual({ kind: 'committed', action })
    await expect(repository.claimWilburMutation({
      ownerId: OWNER,
      gameId: GAME_ID,
      actionId: null,
      idempotencyKey: '62000000-0000-4000-8000-000000000018',
      operation: 'create_action',
      requestDigest: 'd'.repeat(64),
      rateKind: 'action',
      reservedFutureRows: 2,
      reservedTextBytes: 1,
      storageRowLimit: 1,
      storageTextBytesLimit: 250_000,
    })).rejects.toMatchObject({ code: 'storage-limit' })
    await expect(repository.claimWilburMutation({
      ownerId: OWNER,
      gameId: GAME_ID,
      actionId: null,
      idempotencyKey: '62000000-0000-4000-8000-000000000019',
      operation: 'create_action',
      requestDigest: 'e'.repeat(64),
      rateKind: 'action',
      reservedFutureRows: 2,
      reservedTextBytes: 2,
      storageRowLimit: 500,
      storageTextBytesLimit: 1,
    })).rejects.toMatchObject({ code: 'storage-limit' })
    await claimAndAdmitWilburMutation({
      idempotencyKey: '62000000-0000-4000-8000-000000000010',
      operation: 'create_action',
      requestDigest: '7'.repeat(64),
      actionId: null,
      rateKind: 'action',
      reservedFutureRows: 2,
      reservedTextBytes: firstActionBytes,
    })
    await expect(repository.createWilburAction({
      ownerId: OWNER,
      gameId: GAME_ID,
      id: '62000000-0000-4000-8000-000000000009',
      idempotencyKey: '62000000-0000-4000-8000-000000000010',
      requestDigest: '7'.repeat(64),
      charlotteActionIndex: 0,
      actor: charlotte.exactlyThreeNextActions[0].actor,
      action: charlotte.exactlyThreeNextActions[0].smallestAction,
      testedAssumption: charlotte.exactlyThreeNextActions[0].assumptionBeingTested,
      expectedObservation: charlotte.exactlyThreeNextActions[0].expectedObservation,
      decisionThreshold: charlotte.exactlyThreeNextActions[0].decisionThreshold,
      reviewHorizon: charlotte.exactlyThreeNextActions[0].reviewHorizon,
      configurationDigest: 'd'.repeat(64),
    })).rejects.toMatchObject({ code: 'conflict' })
    await repository.settleWilburMutationConflict({
      ownerId: OWNER,
      gameId: GAME_ID,
      actionId: null,
      idempotencyKey: '62000000-0000-4000-8000-000000000010',
      operation: 'create_action',
      requestDigest: '7'.repeat(64),
      rateKind: 'action',
      reservedFutureRows: 2,
      reservedTextBytes: firstActionBytes,
    })
    const settledConflict = await database.adapter.query<{
      status: string
      denial_code: string | null
      reserved_future_rows: number
      reserved_text_bytes: bigint
    }>({
      text: `
        SELECT status, denial_code, reserved_future_rows,
          reserved_text_bytes
        FROM wilbur_mutation_requests
        WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid
      `,
      values: [OWNER, '62000000-0000-4000-8000-000000000010'],
    })
    expect(settledConflict.rows[0]).toMatchObject({
      status: 'denied',
      denial_code: 'WILBUR_MUTATION_CONFLICT',
      reserved_future_rows: 0,
      reserved_text_bytes: '0',
    })
    await claimAndAdmitWilburMutation({
      idempotencyKey: '62000000-0000-4000-8000-000000000014',
      operation: 'update_action',
      requestDigest: 'a'.repeat(64),
      actionId: action.id,
      rateKind: 'action',
      reservedFutureRows: 1,
      reservedTextBytes: 0,
    })
    await installWilburActivityFailure()
    try {
      await expect(repository.updateWilburAction({
        ownerId: OWNER,
        gameId: GAME_ID,
        actionId: action.id,
        idempotencyKey: '62000000-0000-4000-8000-000000000014',
        requestDigest: 'a'.repeat(64),
        expectedRevision: action.revision,
        status: 'in_progress',
        configurationDigest: 'd'.repeat(64),
      })).rejects.toThrow(/injected lifecycle activity failure/u)
    } finally {
      await removeWilburActivityFailure()
    }
    expect(await repository.getForGame(OWNER, GAME_ID)).toMatchObject({
      state: 'wilbur_planning',
      wilburActions: [{ id: action.id, status: 'planned', revision: 0 }],
    })
    await claimAndAdmitWilburMutation({
      idempotencyKey: '62000000-0000-4000-8000-000000000011',
      operation: 'update_action',
      requestDigest: '8'.repeat(64),
      actionId: action.id,
      rateKind: 'action',
      reservedFutureRows: 1,
      reservedTextBytes: 0,
    })
    const started = await repository.updateWilburAction({
      ownerId: OWNER,
      gameId: GAME_ID,
      actionId: action.id,
      idempotencyKey: '62000000-0000-4000-8000-000000000011',
      requestDigest: '8'.repeat(64),
      expectedRevision: action.revision,
      status: 'in_progress',
      followUpAt: '2026-08-10T20:00:00.000Z',
      configurationDigest: 'd'.repeat(64),
    })
    expect(started).toMatchObject({
      status: 'in_progress',
      revision: 1,
      followUpAt: '2026-08-10T20:00:00.000Z',
    })
    await expect(repository.claimWilburMutation({
      ownerId: OWNER,
      gameId: GAME_ID,
      actionId: action.id,
      idempotencyKey: '62000000-0000-4000-8000-000000000011',
      operation: 'update_action',
      requestDigest: '8'.repeat(64),
      rateKind: 'action',
      reservedFutureRows: 1,
      reservedTextBytes: 0,
      storageRowLimit: 1,
      storageTextBytesLimit: 1,
    })).resolves.toEqual({ kind: 'committed', action: started })
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
    const faultObservation = {
      ...observationInput,
      id: '62000000-0000-4000-8000-000000000016',
      idempotencyKey: '62000000-0000-4000-8000-000000000015',
      requestDigest: 'b'.repeat(64),
    }
    const observationBytes = utf8Bytes([
      observationInput.observation,
      observationInput.evidenceClassification,
      observationInput.expectedEffect,
      observationInput.unexpectedEffect,
      observationInput.stakeholderResponse,
      observationInput.assumptionResult,
      observationInput.nextDecision,
    ])
    await claimAndAdmitWilburMutation({
      idempotencyKey: faultObservation.idempotencyKey,
      operation: 'append_observation',
      requestDigest: faultObservation.requestDigest,
      actionId: action.id,
      rateKind: 'observation',
      reservedFutureRows: 2,
      reservedTextBytes: observationBytes,
    })
    await installWilburActivityFailure()
    try {
      await expect(repository.appendWilburObservation(faultObservation))
        .rejects.toThrow(/injected lifecycle activity failure/u)
    } finally {
      await removeWilburActivityFailure()
    }
    expect(await repository.getForGame(OWNER, GAME_ID)).toMatchObject({
      state: 'wilbur_in_progress',
      wilburObservations: [],
    })
    await claimAndAdmitWilburMutation({
      idempotencyKey: observationInput.idempotencyKey,
      operation: 'append_observation',
      requestDigest: observationInput.requestDigest,
      actionId: action.id,
      rateKind: 'observation',
      reservedFutureRows: 2,
      reservedTextBytes: observationBytes,
    })
    const observation = await repository.appendWilburObservation(observationInput)
    expect(observation.assumptionResult).toBe('supported')
    await expect(repository.claimWilburMutation({
      ownerId: OWNER,
      gameId: GAME_ID,
      actionId: action.id,
      idempotencyKey: observationInput.idempotencyKey,
      operation: 'append_observation',
      requestDigest: observationInput.requestDigest,
      rateKind: 'observation',
      reservedFutureRows: 2,
      reservedTextBytes: observationBytes,
      storageRowLimit: 500,
      storageTextBytesLimit: 250_000,
    })).resolves.toEqual({ kind: 'committed', observation })

    await claimAndAdmitWilburMutation({
      idempotencyKey: '62000000-0000-4000-8000-000000000017',
      operation: 'update_action',
      requestDigest: 'c'.repeat(64),
      actionId: action.id,
      rateKind: 'action',
      reservedFutureRows: 1,
      reservedTextBytes: 0,
    })
    const completedAction = await repository.updateWilburAction({
      ownerId: OWNER,
      gameId: GAME_ID,
      actionId: action.id,
      idempotencyKey: '62000000-0000-4000-8000-000000000017',
      requestDigest: 'c'.repeat(64),
      expectedRevision: started.revision,
      status: 'completed',
      configurationDigest: 'd'.repeat(64),
    })
    expect(completedAction).toMatchObject({ status: 'completed', revision: 2 })
    await expect(repository.claimWilburMutation({
      ownerId: OWNER,
      gameId: GAME_ID,
      actionId: action.id,
      idempotencyKey: '62000000-0000-4000-8000-000000000011',
      operation: 'update_action',
      requestDigest: '8'.repeat(64),
      rateKind: 'action',
      reservedFutureRows: 1,
      reservedTextBytes: 0,
      storageRowLimit: 1,
      storageTextBytesLimit: 1,
    })).resolves.toEqual({ kind: 'committed', action: started })
    await expect(repository.claimWilburMutation({
      ownerId: OWNER,
      gameId: GAME_ID.toUpperCase(),
      actionId: null,
      idempotencyKey: '62000000-0000-4000-8000-000000000006',
      operation: 'create_action',
      requestDigest: '5'.repeat(64),
      rateKind: 'action',
      reservedFutureRows: 2,
      reservedTextBytes: firstActionBytes,
      storageRowLimit: 1,
      storageTextBytesLimit: 1,
    })).resolves.toEqual({ kind: 'committed', action })

    const complete = await repository.getForGame(OWNER, GAME_ID)
    expect(complete).toMatchObject({
      state: 'wilbur_observed',
      wilburActions: [{ id: action.id, status: 'completed', revision: 2 }],
      wilburObservations: [{ id: observation.id }],
    })

    const legacyObservationText = [
      'A direct café signal appeared.',
      'Direct field note.',
      'The expected effect appeared.',
      'No unexpected effect appeared.',
      'The stakeholder response stayed bounded.',
      'unresolved',
      'Review the evidence again.',
    ] as const
    await database.adapter.query({
      text: `
        INSERT INTO wilbur_observations (
          id, clerk_user_id, action_id, idempotency_key, request_digest,
          observed_at, observation, evidence_classification,
          expected_effect, unexpected_effect, stakeholder_response,
          assumption_result, next_decision, record_version
        )
        VALUES (
          $1::uuid, $2::text, $3::uuid, $4::uuid, $5::char(64), now(),
          $6::text, $7::text, $8::text, $9::text, $10::text,
          $11::text, $12::text, $13::text
        )
      `,
      values: [
        '62000000-0000-4000-8000-000000000020',
        OWNER,
        action.id,
        '62000000-0000-4000-8000-000000000021',
        'f'.repeat(64),
        ...legacyObservationText,
        CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
      ],
    })
    const occupiedText = await database.adapter.query<{
      artifact_text_bytes: string
      pending_text_bytes: string
    }>({
      text: `
        SELECT
          (
            (
              SELECT coalesce(sum(
                octet_length(actor) + octet_length(action) +
                octet_length(tested_assumption) +
                octet_length(expected_observation) +
                octet_length(decision_threshold) +
                octet_length(review_horizon)
              ), 0)
              FROM wilbur_actions
              WHERE clerk_user_id = $1::text
            ) +
            (
              SELECT coalesce(sum(
                octet_length(observation) +
                octet_length(evidence_classification) +
                octet_length(expected_effect) +
                octet_length(unexpected_effect) +
                octet_length(stakeholder_response) +
                octet_length(assumption_result) +
                octet_length(next_decision)
              ), 0)
              FROM wilbur_observations
              WHERE clerk_user_id = $1::text
            )
          )::text AS artifact_text_bytes,
          (
            SELECT coalesce(sum(reserved_text_bytes), 0)
            FROM wilbur_mutation_requests
            WHERE clerk_user_id = $1::text
              AND status = 'pending'
              AND updated_at >= now() - interval '24 hours'
          )::text AS pending_text_bytes
      `,
      values: [OWNER],
    })
    const exactLegacyTextBytes = utf8Bytes(legacyObservationText)
    expect(Number(occupiedText.rows[0]!.artifact_text_bytes)).toBe(
      firstActionBytes + observationBytes + exactLegacyTextBytes,
    )
    expect(Number(occupiedText.rows[0]!.pending_text_bytes)).toBe(
      observationBytes,
    )
    const exactOccupiedTextBytes =
      Number(occupiedText.rows[0]!.artifact_text_bytes) +
      Number(occupiedText.rows[0]!.pending_text_bytes)
    await expect(repository.claimWilburMutation({
      ownerId: OWNER,
      gameId: GAME_ID,
      actionId: action.id,
      idempotencyKey: '62000000-0000-4000-8000-000000000022',
      operation: 'append_observation',
      requestDigest: '0'.repeat(64),
      rateKind: 'observation',
      reservedFutureRows: 2,
      reservedTextBytes: 1,
      storageRowLimit: 500,
      storageTextBytesLimit: exactOccupiedTextBytes,
    })).rejects.toMatchObject({ code: 'storage-limit' })

    const memory = await repository.listWebMemory(OWNER)
    expect(memory.carriedObservationIds).toEqual([])
    expect(memory.cases).toHaveLength(1)
    expect(memory.cases[0]).toMatchObject({
      gameId: GAME_ID,
      problem: PROBLEM,
      actions: [{
        action: { id: action.id, followUpAt: null },
        observations: expect.any(Array),
      }],
    })
    expect(memory.cases[0]!.actions[0]!.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: observation.id }),
      ]),
    )
    const evidence = await repository.getWebMemoryEvidence(
      OWNER,
      [observation.id],
    )
    expect(evidence).toEqual([expect.objectContaining({
      observationId: observation.id,
      sourceGameId: GAME_ID,
      sourceActionId: action.id,
      sourceProblem: PROBLEM,
      action: action.action,
      observation: observation.observation,
      expectedEffect: observation.expectedEffect,
      assumptionResult: 'supported',
      selectionOrdinal: 0,
      consentVersion: 'webchess-web-memory-consent-v1',
      attachedAt: null,
    })])

    const target = await insertMappedRetryGame(
      '62000000-0000-4000-8000-000000000009',
      null,
      'web-memory-target-field',
      OWNER,
    )
    await repository.attachWebMemoryEvidence(OWNER, target.id, [observation.id])
    await expect(
      repository.getWebMemoryEvidenceForGame(OWNER, target.id),
    ).resolves.toEqual([
      expect.objectContaining({
        ...evidence[0],
        attachedAt: expect.any(String),
      }),
    ])
    await expect(
      repository.attachWebMemoryEvidence(OWNER, target.id, [observation.id]),
    ).resolves.toBeUndefined()
    await expect(
      repository.attachWebMemoryEvidence(
        OWNER,
        target.id,
        ['62000000-0000-4000-8000-000000000020'],
      ),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(
      repository.attachWebMemoryEvidence(
        'user_wrong_owner',
        target.id,
        [observation.id],
      ),
    ).rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('keeps the Wilbur row envelope exact under concurrent updates and stale-key floods', async () => {
    const owner = 'user_wilbur_storage_envelope_integration'
    const gameId = '62ab0000-0000-4000-8000-0000000000a1'
    const runId = '62ab0000-0000-4000-8000-0000000000a2'
    const actionId = '62ab0000-0000-4000-8000-0000000000a3'

    await database.adapter.query({
      text: `INSERT INTO user_controls (clerk_user_id) VALUES ($1::text)`,
      values: [owner],
    })
    await database.adapter.query({
      text: `
        INSERT INTO games (
          id, clerk_user_id, is_current, revision, status, problem,
          problem_sha256, research_consent_version,
          research_consent_decision, research_consent_recorded_at,
          division_seed, division_facets, problem_parts,
          division_model, division_prompt_version, division_prompt_sha256,
          division_digest, event_version, rules_version, engine_version,
          cast_version, software_version, created_at, updated_at
        )
        SELECT
          $1::uuid, $2::text, true, 1, status, problem, problem_sha256,
          research_consent_version, research_consent_decision,
          research_consent_recorded_at, division_seed, division_facets,
          problem_parts, division_model,
          division_prompt_version, division_prompt_sha256, division_digest,
          event_version, rules_version, engine_version, cast_version,
          software_version, now(), now()
        FROM games
        WHERE id = $3::uuid
      `,
      values: [gameId, owner, GAME_ID],
    })
    await database.adapter.query({
      text: `
        INSERT INTO lifecycle_runs (
          id, clerk_user_id, game_id, root_run_id, state,
          division_seed, cast_seed, trajectory_seed,
          software_version, lifecycle_version, rules_version, engine_version,
          cast_version, event_version, portia_prompt_version,
          portia_contract_version, gate_algorithm_version, retry_policy_version,
          charlotte_prompt_version, charlotte_contract_version,
          wilbur_record_version
        )
        VALUES (
          $1::uuid, $2::text, $3::uuid, $1::uuid, 'wilbur_planning',
          'storage-division', 'storage-cast', 'storage-trajectory',
          $4::text, $5::text, $6::text, $7::text, $8::text, $9::smallint,
          $10::text, $11::text, $12::text, $13::text, $14::text,
          $15::text, $16::text
        )
      `,
      values: [
        runId,
        owner,
        gameId,
        CURRENT_LIFECYCLE_VERSIONS.software,
        CURRENT_LIFECYCLE_VERSIONS.lifecycle,
        CURRENT_GAME_VERSIONS.rules,
        CURRENT_GAME_VERSIONS.engine,
        CURRENT_GAME_VERSIONS.cast,
        CURRENT_GAME_VERSIONS.event,
        CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
        CURRENT_LIFECYCLE_VERSIONS.portiaContract,
        CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm,
        CURRENT_LIFECYCLE_VERSIONS.retryPolicy,
        CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
        CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
        CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
      ],
    })
    await database.adapter.query({
      text: `
        INSERT INTO wilbur_actions (
          id, clerk_user_id, lifecycle_run_id, charlotte_action_index,
          idempotency_key, request_digest, actor, action,
          tested_assumption, expected_observation, decision_threshold,
          review_horizon, status, revision, record_version
        )
        VALUES (
          $1::uuid, $2::text, $3::uuid, 0, $4::uuid, repeat('1', 64),
          'Storage owner', 'Perform the bounded storage-envelope action.',
          'The row envelope remains exact under concurrent requests.',
          'Only one request reserves the last available event row.',
          'Durable rows and pending future rows never exceed the cap.',
          'Within one integration test', 'planned', 0, $5::text
        )
      `,
      values: [
        actionId,
        owner,
        runId,
        '62ab0000-0000-4000-8000-0000000000a4',
        CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
      ],
    })

    expect(await readWilburStorageEnvelope(owner)).toMatchObject({
      action_rows: 1,
      observation_rows: 0,
      event_rows: 0,
      ledger_rows: 0,
      pending_future_rows: 0,
      durableRows: 1,
      totalRows: 1,
    })

    const concurrentClaims = [
      {
        idempotencyKey: '62ab0000-0000-4000-8000-0000000000b1',
        requestDigest: '2'.repeat(64),
      },
      {
        idempotencyKey: '62ab0000-0000-4000-8000-0000000000b2',
        requestDigest: '3'.repeat(64),
      },
    ] as const
    const results = await Promise.allSettled(concurrentClaims.map((claim) =>
      repository.claimWilburMutation({
        ownerId: owner,
        gameId,
        actionId,
        operation: 'update_action',
        rateKind: 'action',
        reservedFutureRows: 1,
        reservedTextBytes: 0,
        storageRowLimit: 3,
        storageTextBytesLimit: 250_000,
        ...claim,
      })))
    const acceptedIndex = results.findIndex((result) => result.status === 'fulfilled')
    const rejected = results.find((result) => result.status === 'rejected')
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results[acceptedIndex]).toMatchObject({
      status: 'fulfilled',
      value: { kind: 'pending' },
    })
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'storage-limit' },
    })
    const accepted = concurrentClaims[acceptedIndex]!
    expect(await readWilburStorageEnvelope(owner)).toMatchObject({
      action_rows: 1,
      event_rows: 0,
      ledger_rows: 1,
      pending_future_rows: 1,
      durableRows: 2,
      totalRows: 3,
    })

    await expect(repository.claimWilburMutation({
      ownerId: owner,
      gameId: gameId.toUpperCase(),
      actionId: actionId.toUpperCase(),
      idempotencyKey: accepted.idempotencyKey.toUpperCase(),
      operation: 'update_action',
      requestDigest: accepted.requestDigest,
      rateKind: 'action',
      reservedFutureRows: 1,
      reservedTextBytes: 0,
      storageRowLimit: 1,
      storageTextBytesLimit: 1,
    })).resolves.toEqual({ kind: 'pending' })
    await expect(repository.claimWilburMutation({
      ownerId: owner,
      gameId,
      actionId: '62ab0000-0000-4000-8000-0000000000ff',
      idempotencyKey: accepted.idempotencyKey,
      operation: 'update_action',
      requestDigest: accepted.requestDigest,
      rateKind: 'action',
      reservedFutureRows: 1,
      reservedTextBytes: 0,
      storageRowLimit: 3,
      storageTextBytesLimit: 250_000,
    })).rejects.toMatchObject({ code: 'conflict' })
    await expect(repository.claimWilburMutation({
      ownerId: owner,
      gameId,
      actionId,
      idempotencyKey: accepted.idempotencyKey,
      operation: 'update_action',
      requestDigest: accepted.requestDigest,
      rateKind: 'observation',
      reservedFutureRows: 1,
      reservedTextBytes: 0,
      storageRowLimit: 3,
      storageTextBytesLimit: 250_000,
    })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(repository.claimWilburMutation({
      ownerId: owner,
      gameId,
      actionId,
      idempotencyKey: accepted.idempotencyKey,
      operation: 'update_action',
      requestDigest: accepted.requestDigest,
      rateKind: 'action',
      reservedFutureRows: 2,
      reservedTextBytes: 0,
      storageRowLimit: 3,
      storageTextBytesLimit: 250_000,
    })).rejects.toMatchObject({ code: 'invalid-input' })

    await database.adapter.query({
      text: `
        UPDATE wilbur_mutation_requests
        SET rate_admitted_at = now(), updated_at = now()
        WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid
      `,
      values: [owner, accepted.idempotencyKey],
    })
    const updated = await repository.updateWilburAction({
      ownerId: owner,
      gameId: gameId.toUpperCase(),
      actionId: actionId.toUpperCase(),
      idempotencyKey: accepted.idempotencyKey.toUpperCase(),
      requestDigest: accepted.requestDigest,
      expectedRevision: 0,
      status: 'in_progress',
      configurationDigest: 'a'.repeat(64),
    })
    expect(updated).toMatchObject({ status: 'in_progress', revision: 1 })
    expect(await readWilburStorageEnvelope(owner)).toMatchObject({
      action_rows: 1,
      event_rows: 1,
      ledger_rows: 1,
      pending_future_rows: 0,
      durableRows: 3,
      totalRows: 3,
    })
    await expect(repository.claimWilburMutation({
      ownerId: owner,
      gameId,
      actionId,
      idempotencyKey: accepted.idempotencyKey,
      operation: 'update_action',
      requestDigest: accepted.requestDigest,
      rateKind: 'action',
      reservedFutureRows: 1,
      reservedTextBytes: 0,
      storageRowLimit: 1,
      storageTextBytesLimit: 1,
    })).resolves.toEqual({ kind: 'committed', action: updated })
    await expect(repository.claimWilburMutation({
      ownerId: owner,
      gameId,
      actionId,
      idempotencyKey: '62ab0000-0000-4000-8000-0000000000c1',
      operation: 'update_action',
      requestDigest: '4'.repeat(64),
      rateKind: 'action',
      reservedFutureRows: 1,
      reservedTextBytes: 0,
      storageRowLimit: 3,
      storageTextBytesLimit: 250_000,
    })).rejects.toMatchObject({ code: 'storage-limit' })

    const staleClaims = [
      ['62ab0000-0000-4000-8000-0000000000d1', '5'.repeat(64)],
      ['62ab0000-0000-4000-8000-0000000000d2', '6'.repeat(64)],
    ] as const
    for (const [idempotencyKey, requestDigest] of staleClaims) {
      await expect(repository.claimWilburMutation({
        ownerId: owner,
        gameId,
        actionId,
        idempotencyKey,
        operation: 'update_action',
        requestDigest,
        rateKind: 'action',
        reservedFutureRows: 1,
        reservedTextBytes: 0,
        storageRowLimit: 6,
        storageTextBytesLimit: 250_000,
      })).resolves.toEqual({ kind: 'pending' })
      expect((await readWilburStorageEnvelope(owner)).totalRows).toBeLessThanOrEqual(6)
      await database.adapter.query({
        text: `
          UPDATE wilbur_mutation_requests
          SET rate_admitted_at = now(), updated_at = now()
          WHERE clerk_user_id = $1::text AND idempotency_key = $2::uuid
        `,
        values: [owner, idempotencyKey],
      })
      await expect(repository.updateWilburAction({
        ownerId: owner,
        gameId,
        actionId,
        idempotencyKey,
        requestDigest,
        expectedRevision: 0,
        status: 'completed',
        configurationDigest: 'b'.repeat(64),
      })).rejects.toMatchObject({ code: 'conflict' })
      await repository.settleWilburMutationConflict({
        ownerId: owner,
        gameId,
        actionId,
        idempotencyKey,
        operation: 'update_action',
        requestDigest,
        rateKind: 'action',
        reservedFutureRows: 1,
        reservedTextBytes: 0,
      })
      expect((await readWilburStorageEnvelope(owner)).totalRows).toBeLessThanOrEqual(6)
    }
    await expect(repository.claimWilburMutation({
      ownerId: owner,
      gameId,
      actionId,
      idempotencyKey: '62ab0000-0000-4000-8000-0000000000d3',
      operation: 'update_action',
      requestDigest: '7'.repeat(64),
      rateKind: 'action',
      reservedFutureRows: 1,
      reservedTextBytes: 0,
      storageRowLimit: 6,
      storageTextBytesLimit: 250_000,
    })).rejects.toMatchObject({ code: 'storage-limit' })
    expect(await readWilburStorageEnvelope(owner)).toMatchObject({
      action_rows: 1,
      observation_rows: 0,
      event_rows: 1,
      ledger_rows: 3,
      pending_future_rows: 0,
      durableRows: 5,
      totalRows: 5,
    })
    const ledgerStatuses = await database.adapter.query<{
      status: string
      row_count: number
    }>({
      text: `
        SELECT status, count(*)::integer AS row_count
        FROM wilbur_mutation_requests
        WHERE clerk_user_id = $1::text
        GROUP BY status
        ORDER BY status
      `,
      values: [owner],
    })
    expect(ledgerStatuses.rows).toEqual([
      { status: 'committed', row_count: 1 },
      { status: 'denied', row_count: 2 },
    ])

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
      versions: {
        lifecycle: 'webchess-lifecycle-v2.4',
        trajectoryDirectionalRecord: null,
      },
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
      versions: {
        lifecycle: 'webchess-lifecycle-v2.4',
        trajectoryDirectionalRecord: null,
      },
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
      versions: {
        lifecycle: CURRENT_LIFECYCLE_VERSIONS.lifecycle,
        trajectoryDirectionalRecord: null,
      },
    })

    const boundedGame = await insertMappedRetryGame(
      '63000000-0000-4000-8000-000000000005',
      null,
      'portia-bounded-failure-field',
    )
    await repository.ensureForGame({
      ownerId: RETRY_OWNER,
      game: boundedGame,
      trajectorySeed: 'portia-bounded-failure-trajectory',
    })
    let bounded = await markLifecycleLegacy(RETRY_OWNER, boundedGame.id)
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
    await repository.ensureForGame({
      ownerId: CHARLOTTE_OWNER,
      game: boundedGame,
      trajectorySeed: 'charlotte-bounded-failure-trajectory',
    })
    let bounded = await markLifecycleLegacy(CHARLOTTE_OWNER, boundedGame.id)
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

  it('enforces the shared durable Answer prompt boundary and Gate consistency', async () => {
    await database.adapter.query({
      text: `INSERT INTO user_controls (clerk_user_id) VALUES ($1::text)`,
      values: [GATE_PROMPT_OWNER],
    })
    const boundedGame = await insertMappedRetryGame(
      GATE_PROMPT_GAME_ID,
      null,
      'gate-answer-prompt-boundary-field',
      GATE_PROMPT_OWNER,
    )
    await repository.ensureForGame({
      ownerId: GATE_PROMPT_OWNER,
      game: boundedGame,
      trajectorySeed: 'gate-answer-prompt-boundary-trajectory',
    })
    let bounded = await markLifecycleLegacy(
      GATE_PROMPT_OWNER,
      GATE_PROMPT_GAME_ID,
    )
    for (const [to, stage, activityType] of [
      ['chess_playing', 'chess', 'game_started'],
      ['chess_terminal', 'chess', 'terminal_replay_verified'],
      ['portia_pending', 'portia', 'adversarial_review_authorized'],
      ['portia_running', 'portia', 'adversarial_review_started'],
      ['portia_complete', 'portia', 'adversarial_review_completed'],
    ] as const) {
      bounded = await repository.transition({
        ownerId: GATE_PROMPT_OWNER,
        gameId: GATE_PROMPT_GAME_ID,
        expectedRevision: bounded.revision,
        to,
        stage,
        activityType,
        configurationDigest: '7'.repeat(64),
      })
    }

    const survivors = Array.from({ length: 4 }, (_, index) => survivor(index))
    const passedGate = evaluateGate(portiaReview(
      survivors,
      LEGACY_PROMPT_BOUND_PORTIA_CONTRACT_VERSION,
    ))
    const failedGate = {
      ...passedGate,
      passed: false,
      recommendedNextTransition: 'insufficient_basis',
    } as const
    const storeGateInput = {
      ownerId: GATE_PROMPT_OWNER,
      gameId: GATE_PROMPT_GAME_ID,
      expectedRevision: bounded.revision,
      result: passedGate,
      configurationDigest: '7'.repeat(64),
    } as const

    await expect(repository.storeGate({
      ...storeGateInput,
      answerUserPrompt: '',
    })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(repository.storeGate({
      ...storeGateInput,
      answerUserPrompt: 'x'.repeat(MAX_PERSISTED_MODEL_PROMPT_CHARS + 1),
    })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(repository.storeGate({
      ...storeGateInput,
      result: failedGate,
      answerUserPrompt: 'A failed Gate must not authorize Answer input.',
    })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(repository.storeGate({
      ...storeGateInput,
      answerUserPrompt: null,
    })).rejects.toMatchObject({ code: 'invalid-input' })

    const maximumPrompt = 'x'.repeat(MAX_PERSISTED_MODEL_PROMPT_CHARS)
    bounded = await repository.storeGate({
      ...storeGateInput,
      answerUserPrompt: maximumPrompt,
    })
    expect(bounded).toMatchObject({
      state: 'gate_passed',
      answerUserPrompt: maximumPrompt,
      answerUserPromptSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    })
    await expect(repository.storeGate({
      ...storeGateInput,
      answerUserPrompt: maximumPrompt,
    })).resolves.toMatchObject({
      revision: bounded.revision,
      answerUserPromptSha256: bounded.answerUserPromptSha256,
    })
    const persisted = await database.adapter.query<{
      prompt_chars: number
      answer_user_prompt_sha256: string
    }>({
      text: `
        SELECT char_length(answer_user_prompt)::integer AS prompt_chars,
          answer_user_prompt_sha256
        FROM gate_decisions
        WHERE clerk_user_id = $1::text
          AND lifecycle_run_id = $2::uuid
      `,
      values: [GATE_PROMPT_OWNER, bounded.id],
    })
    expect(persisted.rows).toEqual([{
      prompt_chars: MAX_PERSISTED_MODEL_PROMPT_CHARS,
      answer_user_prompt_sha256: bounded.answerUserPromptSha256,
    }])
  })

  it('is deleted through the existing owner cascade', async () => {
    await database.adapter.query({
      text: `DELETE FROM user_controls WHERE clerk_user_id = $1::text`,
      values: [OWNER],
    })
    await expect(repository.getForGame(OWNER, GAME_ID)).resolves.toBeNull()
  })
})
