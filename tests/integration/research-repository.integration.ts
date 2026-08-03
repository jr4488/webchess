import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CURRENT_GAME_VERSIONS } from '../../src/lib/game-contract'
import { CURRENT_LIFECYCLE_VERSIONS } from '../../src/lib/lifecycle'
import { DurableLifecycleRepository } from '../../src/server/lifecycle'
import {
  DurableResearchRepository,
  RESEARCH_POLICY_VERSION,
} from '../../src/server/research'
import type { PostgresTestDatabase } from './postgres-test-database'
import { createPostgresTestDatabase } from './postgres-test-database'

const OWNER = 'user_research_repository_integration'
const OTHER_OWNER = 'user_other_research_repository_integration'
const GAME_ID = '72000000-0000-4000-8000-000000000001'
const RUN_ID = '73000000-0000-4000-8000-000000000001'
const PROBLEM = 'What is the latest safe way to improve a current technical system?'
const CONFIGURATION_DIGEST = 'd'.repeat(64)

let database: PostgresTestDatabase
let research: DurableResearchRepository
let lifecycle: DurableLifecycleRepository

beforeAll(async () => {
  database = await createPostgresTestDatabase('research_repository')
  await database.migrate()
  research = new DurableResearchRepository(database.adapter)
  lifecycle = new DurableLifecycleRepository(database.adapter)

  await database.adapter.query({
    text: `
      INSERT INTO user_controls (clerk_user_id)
      VALUES ($1::text), ($2::text)
    `,
    values: [OWNER, OTHER_OWNER],
  })
  await database.adapter.query({
    text: `
      WITH field AS (
        SELECT jsonb_agg(jsonb_build_object('index', item)) AS items
        FROM generate_series(0, 63) AS item
      )
      INSERT INTO games (
        id, clerk_user_id, is_current, revision, status, problem,
        problem_sha256, division_seed, division_facets, problem_parts,
        division_model, division_prompt_version, division_prompt_sha256,
        division_digest, rules_version, engine_version, cast_version,
        event_version, software_version
      )
      SELECT
        $1::uuid, $2::text, true, 3, 'mapped', $3::text,
        repeat('a', 64), 'research-field-seed', field.items, field.items,
        'configured OpenClaw model', 'webchess-division-v2', repeat('b', 64),
        repeat('c', 64), $4::text, $5::text, $6::text,
        $7::smallint, '2.0.0'
      FROM field
    `,
    values: [
      GAME_ID,
      OWNER,
      PROBLEM,
      CURRENT_GAME_VERSIONS.rules,
      CURRENT_GAME_VERSIONS.engine,
      CURRENT_GAME_VERSIONS.cast,
      CURRENT_GAME_VERSIONS.event,
    ],
  })
  await database.adapter.query({
    text: `
      INSERT INTO lifecycle_runs (
        id, clerk_user_id, game_id, root_run_id, state, revision,
        division_seed, cast_seed, trajectory_seed,
        software_version, lifecycle_version, rules_version, engine_version,
        cast_version, event_version, portia_prompt_version,
        portia_contract_version, gate_algorithm_version,
        retry_policy_version, charlotte_prompt_version,
        charlotte_contract_version, wilbur_record_version
      )
      VALUES (
        $1::uuid, $2::text, $3::uuid, $1::uuid, 'portia_pending', 7,
        'research-field-seed', 'research-cast-seed', 'research-trajectory-seed',
        $4::text, $5::text, $6::text, $7::text, $8::text, $9::smallint,
        $10::text, $11::text, $12::text, $13::text, $14::text, $15::text,
        $16::text
      )
    `,
    values: [
      RUN_ID,
      OWNER,
      GAME_ID,
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
})

afterAll(async () => {
  await database.dispose()
})

describe('durable visible research repository on PostgreSQL 17', () => {
  it('records searching, citations, and completion without changing lifecycle fences', async () => {
    const before = await lifecycle.getForGame(OWNER, GAME_ID)
    expect(before).toMatchObject({ state: 'portia_pending', revision: 7 })
    expect(before?.research).toEqual([])

    const startResult = await research.start({
      ownerId: OWNER,
      gameId: GAME_ID,
      lifecycleRunId: RUN_ID,
      lifecycleState: 'portia_pending',
      stage: 'portia',
      problem: PROBLEM,
      policyVersion: RESEARCH_POLICY_VERSION,
      materiality: 'required',
      reason: 'Portia needs current external evidence before validating this time-sensitive answer prompt.',
      query: `${PROBLEM} authoritative current evidence`,
      timeoutMs: 90_000,
      configurationDigest: CONFIGURATION_DIGEST,
    })
    expect(startResult.created).toBe(true)
    const started = startResult.record
    expect(started).toMatchObject({
      status: 'searching',
      provider: 'codex',
      transport: 'local',
      attemptCount: 1,
      directPageTextFetched: false,
      retrievedFacts: [],
      bounds: expect.objectContaining({ timeoutMs: 90_000 }),
    })

    const completed = await research.complete({
      ownerId: OWNER,
      requestId: started.id,
      lifecycleState: 'portia_pending',
      model: 'gpt-5.6-sol',
      executedQueries: [
        `${PROBLEM} authoritative current evidence`,
        'current technical system primary source',
      ],
      searchSynthesis:
        'Codex Search found a current official source and a university source. This remains a model-generated synthesis for Portia to assess.',
      sources: [
        {
          citationId: 'R1',
          ordinal: 1,
          title: 'Official current guidance',
          url: 'https://example.gov/current-guidance',
          hostname: 'example.gov',
          trust: 'government_or_education',
          discoveredFrom: 'synthesis_link',
        },
        {
          citationId: 'R2',
          ordinal: 2,
          title: 'University evidence review',
          url: 'https://example.edu/evidence-review',
          hostname: 'example.edu',
          trust: 'government_or_education',
          discoveredFrom: 'search_activity',
        },
      ],
      omittedSourceCount: 0,
      injectionSignalsDetected: [],
      contentDigest: 'e'.repeat(64),
      configurationDigest: CONFIGURATION_DIGEST,
    })

    expect(completed).toMatchObject({
      id: started.id,
      status: 'completed',
      model: 'gpt-5.6-sol',
      contentDigest: 'e'.repeat(64),
    })
    expect(completed.sources.map((source) => source.citationId)).toEqual([
      'R1',
      'R2',
    ])

    const aggregate = await lifecycle.getForGame(OWNER, GAME_ID)
    expect(aggregate).toMatchObject({ state: 'portia_pending', revision: 7 })
    expect(aggregate?.research).toHaveLength(1)
    expect(aggregate?.research[0]).toMatchObject({ status: 'completed' })
    expect(aggregate?.activities.slice(-2).map((activity) => ({
      activityType: activity.activityType,
      stateFrom: activity.stateFrom,
      stateTo: activity.stateTo,
    }))).toEqual([
      {
        activityType: 'research_search_started',
        stateFrom: 'portia_pending',
        stateTo: 'portia_pending',
      },
      {
        activityType: 'research_search_completed',
        stateFrom: 'portia_pending',
        stateTo: 'portia_pending',
      },
    ])

    const duplicateResult = await research.start({
      ownerId: OWNER,
      gameId: GAME_ID,
      lifecycleRunId: RUN_ID,
      lifecycleState: 'portia_pending',
      stage: 'portia',
      problem: PROBLEM,
      policyVersion: RESEARCH_POLICY_VERSION,
      materiality: 'required',
      reason: completed.reason,
      query: completed.query!,
      timeoutMs: 90_000,
      configurationDigest: CONFIGURATION_DIGEST,
    })
    expect(duplicateResult.created).toBe(false)
    const duplicate = duplicateResult.record
    expect(duplicate.id).toBe(completed.id)
    expect(duplicate.status).toBe('completed')
  })

  it('persists bounded terminal failures and not-needed decisions visibly', async () => {
    const failedStartResult = await research.start({
      ownerId: OWNER,
      gameId: GAME_ID,
      lifecycleRunId: RUN_ID,
      lifecycleState: 'portia_pending',
      stage: 'charlotte',
      problem: PROBLEM,
      policyVersion: RESEARCH_POLICY_VERSION,
      materiality: 'helpful',
      reason: 'Charlotte requested a bounded evidence check for a current audience qualification.',
      query: 'current audience qualification evidence',
      timeoutMs: 30_000,
      configurationDigest: CONFIGURATION_DIGEST,
    })
    expect(failedStartResult.created).toBe(true)
    const failedStart = failedStartResult.record
    const failed = await research.fail({
      ownerId: OWNER,
      requestId: failedStart.id,
      lifecycleState: 'portia_pending',
      status: 'timed_out',
      failureCode: 'codex_search_timeout',
      configurationDigest: CONFIGURATION_DIGEST,
    })
    expect(failed).toMatchObject({
      status: 'timed_out',
      failureCode: 'codex_search_timeout',
      completedAt: expect.any(String),
    })

    const notNeeded = await research.recordNotNeeded({
      ownerId: OWNER,
      gameId: GAME_ID,
      lifecycleRunId: RUN_ID,
      lifecycleState: 'portia_pending',
      stage: 'wilbur',
      problem: PROBLEM,
      policyVersion: RESEARCH_POLICY_VERSION,
      reason: 'Wilbur has no material external fact gap for this saved observation step.',
      configurationDigest: CONFIGURATION_DIGEST,
    })
    expect(notNeeded).toMatchObject({
      status: 'not_needed',
      query: null,
      materiality: null,
      attemptCount: 0,
    })
    expect(await research.getForGame(OTHER_OWNER, GAME_ID)).toEqual([])

    const aggregate = await lifecycle.getForGame(OWNER, GAME_ID)
    expect(aggregate?.revision).toBe(7)
    expect(aggregate?.research.map((record) => record.status)).toEqual([
      'completed',
      'timed_out',
      'not_needed',
    ])
  })

  it('rejects direct-fact laundering at the database boundary', async () => {
    await expect(database.adapter.query({
      text: `
        UPDATE research_requests
        SET retrieved_facts = '[{"claim":"not fetched"}]'::jsonb
        WHERE id = (SELECT id FROM research_requests LIMIT 1)
      `,
    })).rejects.toThrow()
  })
})
