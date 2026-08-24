import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CURRENT_LIFECYCLE_VERSIONS } from '../../src/lib/lifecycle'
import {
  RESEARCH_CONSENT_VERSION,
  type ResearchFetchFailure,
} from '../../src/lib/research'
import type { DurableGame } from '../../src/lib/webchess-api'
import { verifyCaseBundle } from '../../src/server/case-bundle'
import { hashCanonicalJson, sha256Hex } from '../../src/server/db'
import type { CanonicalJson } from '../../src/server/db'
import { DurableGameRepository } from '../../src/server/games'
import {
  createApiServicesWithDependencies,
} from '../../src/server/http/service-adapter'
import { DurableLifecycleRepository } from '../../src/server/lifecycle'
import { generateAnswer, generateDivision } from '../../src/server/openai'
import {
  DurableResearchRepository,
  RESEARCH_POLICY_VERSION,
} from '../../src/server/research'
import { createUsageController } from '../../src/server/usage'
import type { UsageConfig } from '../../src/server/usage'
import type { ProblemFacet } from '../../src/types'
import {
  createPostgresTestDatabase,
} from './postgres-test-database'
import type { PostgresTestDatabase } from './postgres-test-database'

const OWNER = 'openclaw_case_bundle_integration'
const GAME_ID = '74000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-08-24T01:00:00.000Z')
const SOURCE_COMMIT = '7'.repeat(40)
const HMAC_SECRET = 'case-bundle-integration-hmac-secret'.repeat(2)
const PRIVATE_SENTINEL = 'PRIVATE_POSTGRES_CASE_SENTINEL'
const PRIVATE_FAILURE_URL = 'https://example.edu/private-case-evidence'

const USAGE_CONFIG: UsageConfig = {
  hmacSecret: HMAC_SECRET,
  deletionHmacSecret: 'case-bundle-integration-delete-secret'.repeat(2),
  dailyGameLimit: 10,
  dailyModelRequestLimit: 20,
  dailyGlobalModelRequestLimit: 40,
  hourlyModelRequestLimit: 20,
  hourlyIpModelRequestLimit: 40,
  hourlyGameStartLimit: 20,
  hourlyIpGameStartLimit: 40,
  hourlyGameMoveLimit: 1_000,
  hourlyIpGameMoveLimit: 2_000,
  hourlyAccountExportLimit: 10,
  hourlyIpAccountExportLimit: 20,
  hourlyWilburActionLimit: 120,
  hourlyIpWilburActionLimit: 240,
  hourlyWilburObservationLimit: 60,
  hourlyIpWilburObservationLimit: 120,
  concurrentModelLimit: 1,
  globalModelConcurrentLimit: 4,
  modelLeaseSeconds: 180,
}

const FACETS: readonly ProblemFacet[] = Array.from(
  { length: 64 },
  (_, index) => ({
    id: index + 1,
    title: `${PRIVATE_SENTINEL} ${index + 1}`,
    focus: `Integration focus ${index + 1}`,
    question: `What would clarify integration facet ${index + 1}?`,
    keyword: `case-${index + 1}`,
  }),
)

const divisionGenerator: typeof generateDivision = vi.fn(async () => ({
  providerId: 'case-bundle-division-response',
  model: 'configured-default',
  prompt: `${PRIVATE_SENTINEL} division prompt`,
  result: { facets: [...FACETS] },
  usage: {
    reported: false,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    reasoningOutputTokens: 0,
  },
}))

let database: PostgresTestDatabase | null = null

beforeEach(async () => {
  database = await createPostgresTestDatabase('case_bundle')
  await database.migrate()
  vi.mocked(divisionGenerator).mockClear()
})

afterEach(async () => {
  await database?.dispose()
  database = null
})

function context(id: string) {
  return {
    idempotencyKey: id,
    ipAddress: '203.0.113.74',
    requestId: id,
    signal: new AbortController().signal,
  }
}

function stateOf(game: DurableGame) {
  if (!game.state) throw new Error('Expected a replayable integration game.')
  return game.state
}

interface MutableCaseBundle {
  format: string
  profile: string
  manifest: {
    algorithm: string
    canonicalization: string
    entries: { path: string; sha256: string }[]
    integrityRoot: string
  }
  data: Record<string, CanonicalJson>
}

function rebuildCaseManifest(value: MutableCaseBundle): void {
  value.manifest.entries = value.manifest.entries.map(({ path }) => ({
    path,
    sha256: hashCanonicalJson(value.data[path.slice('/data/'.length)]!),
  }))
  value.manifest.integrityRoot = hashCanonicalJson({
    format: value.format,
    profile: value.profile,
    algorithm: value.manifest.algorithm,
    canonicalization: value.manifest.canonicalization,
    entries: value.manifest.entries,
  })
}

function services() {
  if (!database) throw new Error('The disposable case database is unavailable.')
  const repository = new DurableGameRepository(database.adapter)
  return createApiServicesWithDependencies({
    accountExportMaxBytes: 3_000_000,
    answerGenerator: vi.fn<typeof generateAnswer>(),
    database: database.adapter,
    divisionGenerator,
    hmacSecret: HMAC_SECRET,
    lifecycleRepository: new DurableLifecycleRepository(database.adapter),
    modelName: 'configured-default',
    modelProvider: 'openclaw',
    repository,
    softwareVersion: 'webchess@2.2.0-rc.1-openclaw',
    sourceCommit: SOURCE_COMMIT,
    usage: createUsageController({
      db: database.adapter,
      config: USAGE_CONFIG,
      now: () => new Date(NOW),
    }),
    wilburStorageRowLimit: 500,
    wilburStorageTextBytesLimit: 250_000,
  })
}

function directPageFetchFailure(retrievedAt: string): ResearchFetchFailure {
  return {
    citationId: 'R1',
    requestedUrl: PRIVATE_FAILURE_URL,
    finalUrl: PRIVATE_FAILURE_URL,
    status: 'failed',
    failureCode: 'page_fetch_http_status',
    httpStatus: 503,
    fetchVersion: 'webchess-direct-page-fetch-v1',
    extractor: 'webchess-readable-text-v1',
    rawByteLength: 0,
    rawContentDigest: null,
    rawDigestAlgorithm: 'sha256-raw-response-bytes-v1',
    acceptedCharacterLength: 0,
    truncated: false,
    contentDigest: null,
    digestAlgorithm: 'sha256-utf8-accepted-text-v1',
    redirectChain: [PRIVATE_FAILURE_URL],
    injectionSignalsDetected: [],
    retrievedAt,
  }
}

async function persistDirectPageFetchFailure(game: DurableGame): Promise<void> {
  if (!database) throw new Error('The disposable case database is unavailable.')
  if (game.researchConsent.recordedAt === null) {
    throw new Error('Expected recorded consent for direct-page research.')
  }
  const runResult = await database.adapter.query({
    text: `
      SELECT id::text, state
      FROM lifecycle_runs
      WHERE clerk_user_id = $1::text AND game_id = $2::uuid
    `,
    values: [OWNER, game.id],
  })
  const run = runResult.rows[0]
  if (!run || run.state !== 'chess_terminal') {
    throw new Error(`Expected chess_terminal lifecycle, received ${String(run?.state)}.`)
  }
  const research = new DurableResearchRepository(database.adapter)
  const started = await research.start({
    ownerId: OWNER,
    gameId: game.id,
    lifecycleRunId: String(run.id),
    lifecycleState: 'chess_terminal',
    stage: 'portia',
    problem: game.problem,
    researchConsent: game.researchConsent,
    policyVersion: RESEARCH_POLICY_VERSION,
    materiality: 'required',
    reason: `${PRIVATE_SENTINEL} requires a direct-page provenance check.`,
    query: `${PRIVATE_SENTINEL} authoritative direct-page evidence`,
    timeoutMs: 90_000,
    configurationDigest: '3'.repeat(64),
  })
  const failure = directPageFetchFailure(game.researchConsent.recordedAt)
  const completed = await research.complete({
    ownerId: OWNER,
    requestId: started.record.id,
    lifecycleState: 'chess_terminal',
    model: 'gpt-5.6-sol',
    executedQueries: [`${PRIVATE_SENTINEL} authoritative direct-page evidence`],
    searchSynthesis: `${PRIVATE_SENTINEL} synthesis retained only in the private bundle.`,
    directPageTextFetched: false,
    retrievedFacts: [],
    fetchFailures: [failure],
    sources: [{
      citationId: 'R1',
      ordinal: 1,
      title: `${PRIVATE_SENTINEL} source title`,
      url: PRIVATE_FAILURE_URL,
      hostname: 'example.edu',
      trust: 'government_or_education',
      discoveredFrom: 'search_activity',
    }],
    omittedSourceCount: 0,
    injectionSignalsDetected: [],
    contentDigest: '8'.repeat(64),
    configurationDigest: '3'.repeat(64),
  })
  expect(completed).toMatchObject({
    consent: game.researchConsent,
    fetchFailures: [failure],
    directPageTextFetched: false,
  })
}

async function persistCompletedLifecycle(gameId: string): Promise<void> {
  if (!database) throw new Error('The disposable case database is unavailable.')
  const runResult = await database.adapter.query({
    text: `
      SELECT runs.id::text, runs.state,
        coalesce(max(events.sequence), 0)::text AS "lastSequence"
      FROM lifecycle_runs AS runs
      LEFT JOIN lifecycle_events AS events ON events.lifecycle_run_id = runs.id
      WHERE runs.clerk_user_id = $1::text AND runs.game_id = $2::uuid
      GROUP BY runs.id, runs.state
    `,
    values: [OWNER, gameId],
  })
  const run = runResult.rows[0]
  if (!run || run.state !== 'chess_terminal') {
    throw new Error(`Expected chess_terminal lifecycle, received ${String(run?.state)}.`)
  }
  const runId = String(run.id)
  const firstSequence = Number(run.lastSequence) + 1
  const portiaModelId = '74000000-0000-4000-8000-000000000030'
  const charlotteModelId = '74000000-0000-4000-8000-000000000031'
  const portiaInput = '5'.repeat(64)
  const portiaOutput = '6'.repeat(64)
  const charlotteInput = '9'.repeat(64)
  const charlotteOutput = '0'.repeat(64)
  const answerPrompt = `${PRIVATE_SENTINEL} approved persisted Gate prompt.`
  const actionId = '74000000-0000-4000-8000-000000000050'
  const transitions = [
    ['chess_terminal', 'portia_pending', 'portia'],
    ['portia_pending', 'portia_running', 'portia'],
    ['portia_running', 'portia_complete', 'portia'],
    ['portia_complete', 'gate_passed', 'gate'],
    ['gate_passed', 'charlotte_pending', 'charlotte'],
    ['charlotte_pending', 'charlotte_running', 'charlotte'],
    ['charlotte_running', 'charlotte_complete', 'charlotte'],
    ['charlotte_complete', 'wilbur_planning', 'wilbur'],
    ['wilbur_planning', 'wilbur_in_progress', 'wilbur'],
    ['wilbur_in_progress', 'wilbur_observed', 'wilbur'],
  ] as const

  await database.adapter.transaction([{
    text: `
      INSERT INTO model_requests (
        id, clerk_user_id, game_id, operation, idempotency_key,
        request_sha256, status, provider, model, prompt_version,
        software_version, provider_response_id, response_sha256,
        result_payload, provider_started_at, completed_at
      ) VALUES
        ($1::uuid, $2::text, $3::uuid, 'portia', $4::uuid,
          $5::char(64), 'succeeded', 'openclaw', 'configured-default',
          $6::text, 'webchess@2.2.0-rc.1-openclaw', 'fixture-portia-response',
          $7::char(64), $8::jsonb, $9::timestamptz, $9::timestamptz),
        ($10::uuid, $2::text, $3::uuid, 'charlotte', $11::uuid,
          $12::char(64), 'succeeded', 'openclaw', 'configured-default',
          $13::text, 'webchess@2.2.0-rc.1-openclaw', 'fixture-charlotte-response',
          $14::char(64), $15::jsonb, $9::timestamptz, $9::timestamptz)
    `,
    values: [
      portiaModelId,
      OWNER,
      gameId,
      '74000000-0000-4000-8000-000000000032',
      portiaInput,
      CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
      portiaOutput,
      JSON.stringify({ fixture: `${PRIVATE_SENTINEL} Portia provider payload.` }),
      NOW,
      charlotteModelId,
      '74000000-0000-4000-8000-000000000033',
      charlotteInput,
      CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
      charlotteOutput,
      JSON.stringify({ fixture: `${PRIVATE_SENTINEL} Charlotte provider payload.` }),
    ],
  }, {
    text: `
      INSERT INTO portia_reviews (
        id, clerk_user_id, lifecycle_run_id, model_request_id,
        input_digest, output_digest, prompt_version, contract_version, review
      ) VALUES ($1::uuid, $2::text, $3::uuid, $4::uuid,
        $5::char(64), $6::char(64), $7::text, $8::text, $9::jsonb)
    `,
    values: [
      '74000000-0000-4000-8000-000000000040',
      OWNER,
      runId,
      portiaModelId,
      portiaInput,
      portiaOutput,
      CURRENT_LIFECYCLE_VERSIONS.portiaPrompt,
      CURRENT_LIFECYCLE_VERSIONS.portiaContract,
      JSON.stringify({ narrative: `${PRIVATE_SENTINEL} persisted Portia review.` }),
    ],
  }, {
    text: `
      INSERT INTO gate_decisions (
        id, clerk_user_id, lifecycle_run_id, algorithm_version,
        input_digest, passed, result, answer_user_prompt,
        answer_user_prompt_sha256
      ) VALUES ($1::uuid, $2::text, $3::uuid, $4::text,
        $5::char(64), true, $6::jsonb, $7::text, $8::char(64))
    `,
    values: [
      '74000000-0000-4000-8000-000000000041',
      OWNER,
      runId,
      CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm,
      '7'.repeat(64),
      JSON.stringify({ narrative: `${PRIVATE_SENTINEL} persisted Gate result.` }),
      answerPrompt,
      sha256Hex(answerPrompt),
    ],
  }, {
    text: `
      INSERT INTO charlotte_results (
        id, clerk_user_id, lifecycle_run_id, model_request_id,
        input_digest, output_digest, prompt_version, contract_version,
        result, rendered_answer
      ) VALUES ($1::uuid, $2::text, $3::uuid, $4::uuid,
        $5::char(64), $6::char(64), $7::text, $8::text,
        $9::jsonb, $10::text)
    `,
    values: [
      '74000000-0000-4000-8000-000000000042',
      OWNER,
      runId,
      charlotteModelId,
      charlotteInput,
      charlotteOutput,
      CURRENT_LIFECYCLE_VERSIONS.charlottePrompt,
      CURRENT_LIFECYCLE_VERSIONS.charlotteContract,
      JSON.stringify({ narrative: `${PRIVATE_SENTINEL} persisted Charlotte result.` }),
      `${PRIVATE_SENTINEL} persisted Charlotte rendered answer. `.repeat(4),
    ],
  }, {
    text: `
      INSERT INTO wilbur_actions (
        id, clerk_user_id, lifecycle_run_id, charlotte_action_index,
        idempotency_key, request_digest, actor, action, tested_assumption,
        expected_observation, decision_threshold, review_horizon,
        status, revision, record_version
      ) VALUES ($1::uuid, $2::text, $3::uuid, 0,
        $4::uuid, $5::char(64), $6::text, $7::text, $8::text,
        $9::text, $10::text, $11::text, 'planned', 0, $12::text)
    `,
    values: [
      actionId,
      OWNER,
      runId,
      '74000000-0000-4000-8000-000000000052',
      'a'.repeat(64),
      'Integration researcher',
      `${PRIVATE_SENTINEL} run one bounded integration action.`,
      `${PRIVATE_SENTINEL} the bounded action yields a direct signal.`,
      `${PRIVATE_SENTINEL} one direct signal is recorded.`,
      `${PRIVATE_SENTINEL} stop when the signal is absent.`,
      'Within one integration run',
      CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
    ],
  }, {
    text: `
      UPDATE wilbur_actions
      SET status = 'completed', revision = 1, updated_at = now()
      WHERE id = $1::uuid AND clerk_user_id = $2::text
    `,
    values: [actionId, OWNER],
  }, {
    text: `
      INSERT INTO wilbur_observations (
        id, clerk_user_id, action_id, idempotency_key, request_digest,
        observed_at, observation, evidence_classification, expected_effect,
        unexpected_effect, stakeholder_response, assumption_result,
        next_decision, record_version
      ) VALUES ($1::uuid, $2::text, $3::uuid, $4::uuid, $5::char(64),
        $6::timestamptz, $7::text, $8::text, $9::text, $10::text,
        $11::text, 'supported', $12::text, $13::text)
    `,
    values: [
      '74000000-0000-4000-8000-000000000051',
      OWNER,
      actionId,
      '74000000-0000-4000-8000-000000000053',
      'b'.repeat(64),
      NOW,
      `${PRIVATE_SENTINEL} the bounded signal was observed.`,
      'direct integration observation',
      'The expected bounded signal appeared.',
      'No unexpected effect was recorded.',
      'The integration fixture recorded no stakeholder harm.',
      `${PRIVATE_SENTINEL} retain the bounded evidence boundary.`,
      CURRENT_LIFECYCLE_VERSIONS.wilburRecord,
    ],
  }, ...transitions.map(([stateFrom, stateTo, stage], index) => ({
    text: `
      INSERT INTO lifecycle_events (
        id, clerk_user_id, lifecycle_run_id, sequence, stage,
        activity_type, state_from, state_to, input_entity_ids,
        output_entity_ids, responsible_agent_ids, configuration_digest,
        status, event_version
      ) VALUES ($1::uuid, $2::text, $3::uuid, $4::bigint, $5::text,
        $6::text, $7::text, $8::text, $9::jsonb,
        $10::jsonb, $11::jsonb, $12::char(64), 'completed', $13::smallint)
    `,
    values: [
      `74000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`,
      OWNER,
      runId,
      firstSequence + index,
      stage,
      `integration_${stateTo}`,
      stateFrom,
      stateTo,
      JSON.stringify([gameId]),
      JSON.stringify([runId]),
      JSON.stringify(['deterministic-integration-fixture']),
      '3'.repeat(64),
      CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent,
    ],
  })), {
    text: `
      UPDATE lifecycle_runs
      SET state = 'wilbur_observed', revision = revision + $3::bigint,
        answer_prompt_digest = $4::char(64),
        portia_current_candidate_id = NULL,
        portia_active_model_request_id = NULL,
        portia_completed_candidate_ids = '[]'::jsonb,
        portia_assessment_drafts = '[]'::jsonb,
        charlotte_active_model_request_id = NULL,
        updated_at = $5::timestamptz
      WHERE id = $1::uuid AND clerk_user_id = $2::text
    `,
    values: [runId, OWNER, transitions.length, 'f'.repeat(64), NOW],
  }])
}

describe('single-lifecycle case export against PostgreSQL', () => {
  it('exports, redacts, and verifies a local OpenClaw-owned case read-only', async () => {
    const api = services()
    let game = await api.divide({
      ownerId: OWNER,
      problem: `Which bounded decision contains ${PRIVATE_SENTINEL} for export?`,
      researchConsent: {
        version: RESEARCH_CONSENT_VERSION,
        decision: 'allow_search_and_page_fetch',
      },
      ...context(GAME_ID),
    })
    game = await api.startGame({
      ownerId: OWNER,
      gameId: game.id,
      expectedRevision: game.revision,
      ...context('74000000-0000-4000-8000-000000000002'),
    })
    const kingCaptureMoves = [
      ['white-knight-1', 5, 2],
      ['black-pawn-1', 3, 0],
      ['white-knight-1', 3, 3],
      ['black-pawn-2', 3, 1],
      ['white-knight-1', 2, 5],
      ['black-pawn-3', 3, 2],
      ['white-knight-1', 0, 4],
    ] as const
    for (const [moveIndex, [pieceId, ring, sector]] of kingCaptureMoves.entries()) {
      game = await api.move({
        ownerId: OWNER,
        gameId: game.id,
        expectedRevision: game.revision,
        pieceId,
        to: { ring, sector },
        ...context(
          `74000000-0000-4000-8000-${String(100 + moveIndex).padStart(12, '0')}`,
        ),
      })
    }
    expect(stateOf(game).outcome).toMatchObject({
      reason: 'king-captured',
      completedTurn: kingCaptureMoves.length,
      terminalCapture: { captured: { kind: 'king' } },
    })
    await persistDirectPageFetchFailure(game)
    await persistCompletedLifecycle(game.id)
    const providerCallsBeforeExport = vi.mocked(divisionGenerator).mock.calls.length

    const exportedByProfile = new Map()
    for (const [index, profile] of ([
      'private-full-v1',
      'research-redacted-v1',
      'metadata-only-v1',
    ] as const).entries()) {
      const exported = await api.exportCase({
        ownerId: OWNER,
        gameId: game.id,
        profile,
        ipAddress: '203.0.113.74',
        requestId: `74000000-0000-4000-8000-${String(60 + index).padStart(12, '0')}`,
        signal: new AbortController().signal,
      })
      const reloaded = JSON.parse(JSON.stringify(exported)) as unknown
      const verified = verifyCaseBundle(reloaded)
      expect(verified).toMatchObject({
        ok: true,
        replay: {
          checked: true,
          completedPlies: stateOf(game).completedPlies,
          terminal: true,
        },
      })
      expect(exported).toMatchObject({
        format: 'webchess-case-bundle/1',
        profile,
        data: {
          identity: {
            gameId: game.id,
            source: { sourceCommit: SOURCE_COMMIT },
          },
          lifecycle: {
            run: { state: 'wilbur_observed' },
            portiaReviews: [expect.any(Object)],
            gateDecisions: [expect.any(Object)],
            charlotteResults: [expect.any(Object)],
            wilburActions: [expect.any(Object)],
            wilburObservations: [expect.any(Object)],
          },
        },
      })
      exportedByProfile.set(profile, exported)
    }
    expect(JSON.stringify(exportedByProfile.get('private-full-v1')))
      .toContain(PRIVATE_SENTINEL)
    expect(JSON.stringify(exportedByProfile.get('research-redacted-v1')))
      .not.toContain(PRIVATE_SENTINEL)
    expect(JSON.stringify(exportedByProfile.get('metadata-only-v1')))
      .not.toContain(PRIVATE_SENTINEL)
    expect(JSON.stringify(exportedByProfile.get('research-redacted-v1')))
      .not.toContain(PRIVATE_FAILURE_URL)
    expect(JSON.stringify(exportedByProfile.get('metadata-only-v1')))
      .not.toContain(PRIVATE_FAILURE_URL)
    expect(exportedByProfile.get('private-full-v1')).toMatchObject({
      data: {
        game: {
          record: {
            researchConsentVersion: RESEARCH_CONSENT_VERSION,
            researchConsentDecision: 'allow_search_and_page_fetch',
            researchConsentRecordedAt: game.researchConsent.recordedAt,
          },
        },
        lifecycle: {
          researchRequests: [{
            researchConsentVersion: RESEARCH_CONSENT_VERSION,
            researchConsentDecision: 'allow_search_and_page_fetch',
            researchConsentRecordedAt: game.researchConsent.recordedAt,
            fetchFailures: [{
              citationId: 'R1',
              requestedUrl: PRIVATE_FAILURE_URL,
              failureCode: 'page_fetch_http_status',
            }],
          }],
        },
      },
    })
    for (const profile of ['research-redacted-v1', 'metadata-only-v1'] as const) {
      const exported = exportedByProfile.get(profile)
      expect(exported).toMatchObject({
        data: {
          game: {
            record: {
              researchConsentVersion: RESEARCH_CONSENT_VERSION,
              researchConsentDecision: 'allow_search_and_page_fetch',
              researchConsentRecordedAt: game.researchConsent.recordedAt,
            },
          },
          lifecycle: {
            researchRequests: [{
              researchConsentVersion: RESEARCH_CONSENT_VERSION,
              researchConsentDecision: 'allow_search_and_page_fetch',
              researchConsentRecordedAt: game.researchConsent.recordedAt,
            }],
          },
        },
      })
      const lifecycle = exported.data.lifecycle as {
        researchRequests: Record<string, unknown>[]
      }
      expect(lifecycle.researchRequests[0]).not.toHaveProperty('fetchFailures')
      expect(exported.data.redaction.omissions).toContainEqual(
        expect.objectContaining({
          path: '/data/lifecycle/researchRequests/*/fetchFailures',
          omittedCount: 1,
        }),
      )
    }
    expect(exportedByProfile.get('research-redacted-v1')).toMatchObject({
      data: {
        game: {
          replay: {
            partsMode: 'deterministic-neutral-redaction-substitute',
          },
        },
      },
    })

    const detachedEvidence = structuredClone(
      exportedByProfile.get('private-full-v1'),
    ) as unknown as MutableCaseBundle
    const detachedLifecycle = detachedEvidence.data.lifecycle as Record<
      string,
      CanonicalJson
    >
    const detachedRequest = (
      detachedLifecycle.researchRequests as Record<string, CanonicalJson>[]
    )[0]!
    const detachedFailure = (
      detachedRequest.fetchFailures as Record<string, CanonicalJson>[]
    )[0]!
    detachedFailure.citationId = 'R2'
    rebuildCaseManifest(detachedEvidence)
    expect(verifyCaseBundle(detachedEvidence).errors).toContain(
      'researchRequests[0] direct-page evidence does not match its disclosed source citation and URL.',
    )
    expect(vi.mocked(divisionGenerator)).toHaveBeenCalledTimes(
      providerCallsBeforeExport,
    )

    await expect(api.exportCase({
      ownerId: 'openclaw_different_local_owner',
      gameId: game.id,
      profile: 'metadata-only-v1',
      ipAddress: '203.0.113.75',
      requestId: '74000000-0000-4000-8000-000000000070',
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'GAME_NOT_FOUND', status: 404 })
  })
})
