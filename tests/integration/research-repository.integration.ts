import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CURRENT_GAME_VERSIONS } from '../../src/lib/game-contract'
import { CURRENT_LIFECYCLE_VERSIONS } from '../../src/lib/lifecycle'
import {
  LEGACY_RESEARCH_CONSENT_VERSION,
  RESEARCH_CONSENT_VERSION,
  type ResearchConsent,
  type ResearchFetchFailure,
  type ResearchRetrievedFact,
  type ResearchStage,
} from '../../src/lib/research'
import { DurableGameRepository } from '../../src/server/games'
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
const PRECISION_GAME_ID = '72000000-0000-4000-8000-000000000002'
const PRECISION_RUN_ID = '73000000-0000-4000-8000-000000000002'
const PROBLEM = 'What is the latest safe way to improve a current technical system?'
const PRECISION_PROBLEM = 'Can service consent preserve authoritative timestamp precision?'
const CONFIGURATION_DIGEST = 'd'.repeat(64)
const CONSENT_RECORDED_AT = '2026-08-02T16:00:00.000Z'
const RESEARCH_CONSENT = {
  version: RESEARCH_CONSENT_VERSION,
  decision: 'allow_search_and_page_fetch',
  recordedAt: CONSENT_RECORDED_AT,
} as const

const START_CONSENT_MISMATCHES = [
  {
    label: 'decision',
    stage: 'chess',
    consent: {
      ...RESEARCH_CONSENT,
      decision: 'no_external_research',
    },
  },
  {
    label: 'version',
    stage: 'anansi',
    consent: {
      version: LEGACY_RESEARCH_CONSENT_VERSION,
      decision: 'no_external_research',
      recordedAt: null,
    },
  },
  {
    label: 'recording timestamp',
    stage: 'answer',
    consent: {
      ...RESEARCH_CONSENT,
      recordedAt: '2026-08-02T16:00:00.001Z',
    },
  },
] satisfies readonly {
  readonly label: string
  readonly stage: ResearchStage
  readonly consent: ResearchConsent
}[]

const STORED_CONSENT_MISMATCHES = [
  {
    label: 'decision',
    consent: {
      ...RESEARCH_CONSENT,
      decision: 'no_external_research',
    },
  },
  {
    label: 'timestamp',
    consent: {
      ...RESEARCH_CONSENT,
      recordedAt: '2026-08-02T16:00:00.001Z',
    },
  },
  {
    label: 'legacy version',
    consent: {
      version: LEGACY_RESEARCH_CONSENT_VERSION,
      decision: 'no_external_research',
      recordedAt: null,
    },
  },
] satisfies readonly {
  readonly label: string
  readonly consent: ResearchConsent
}[]

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function retrievedFact(): ResearchRetrievedFact {
  const requestedUrl = 'https://example.gov/current-guidance'
  const finalUrl = 'https://example.gov/current-guidance-v2'
  const text = 'Deterministic directly retrieved official guidance.'
  return {
    citationId: 'R1',
    requestedUrl,
    finalUrl,
    title: 'Official current guidance',
    provider: 'webchess-direct-https',
    fetchVersion: 'webchess-direct-page-fetch-v1',
    retrievedAt: CONSENT_RECORDED_AT,
    httpStatus: 200,
    contentType: 'text/html',
    extractor: 'webchess-readable-text-v1',
    rawByteLength: Buffer.byteLength(text, 'utf8'),
    rawContentDigest: sha256(text),
    rawDigestAlgorithm: 'sha256-raw-response-bytes-v1',
    acceptedCharacterLength: text.length,
    contentDigest: sha256(text),
    digestAlgorithm: 'sha256-utf8-accepted-text-v1',
    redirectChain: [requestedUrl, finalUrl],
    text,
    truncated: false,
    untrusted: true,
    contentKind: 'direct_page_text',
  }
}

function fetchFailure(): ResearchFetchFailure {
  const requestedUrl = 'https://example.edu/evidence-review'
  return {
    citationId: 'R2',
    requestedUrl,
    finalUrl: requestedUrl,
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
    redirectChain: [requestedUrl],
    injectionSignalsDetected: [],
    retrievedAt: CONSENT_RECORDED_AT,
  }
}

let database: PostgresTestDatabase
let games: DurableGameRepository
let research: DurableResearchRepository
let lifecycle: DurableLifecycleRepository

beforeAll(async () => {
  database = await createPostgresTestDatabase('research_repository')
  await database.migrate()
  games = new DurableGameRepository(database.adapter)
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
        event_version, software_version, research_consent_version,
        research_consent_decision, research_consent_recorded_at
      )
      SELECT
        $1::uuid, $2::text, true, 3, 'mapped', $3::text,
        repeat('a', 64), 'research-field-seed', field.items, field.items,
        'configured OpenClaw model', 'webchess-division-v2', repeat('b', 64),
        repeat('c', 64), $4::text, $5::text, $6::text,
        $7::smallint, '2.0.0', $8::text, $9::text, $10::timestamptz
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
      RESEARCH_CONSENT.version,
      RESEARCH_CONSENT.decision,
      RESEARCH_CONSENT.recordedAt,
    ],
  })
  await database.adapter.query({
    text: `
      INSERT INTO games (
        id, clerk_user_id, is_current, revision, status, problem,
        problem_sha256, rules_version, engine_version, cast_version,
        event_version, software_version, research_consent_version,
        research_consent_decision, research_consent_recorded_at
      ) VALUES (
        $1::uuid, $2::text, false, 0, 'dividing', $3::text,
        $4::char(64), $5::text, $6::text, $7::text,
        $8::smallint, '2.0.0', $9::text, $10::text,
        date_trunc('milliseconds', clock_timestamp()) + interval '999 microseconds'
      )
    `,
    values: [
      PRECISION_GAME_ID,
      OWNER,
      PRECISION_PROBLEM,
      sha256(PRECISION_PROBLEM),
      CURRENT_GAME_VERSIONS.rules,
      CURRENT_GAME_VERSIONS.engine,
      CURRENT_GAME_VERSIONS.cast,
      CURRENT_GAME_VERSIONS.event,
      RESEARCH_CONSENT.version,
      RESEARCH_CONSENT.decision,
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
      SELECT
        $1::uuid, clerk_user_id, $2::uuid, $1::uuid, state, revision,
        'precision-field-seed', 'precision-cast-seed',
        'precision-trajectory-seed', software_version, lifecycle_version,
        rules_version, engine_version, cast_version, event_version,
        portia_prompt_version, portia_contract_version,
        gate_algorithm_version, retry_policy_version,
        charlotte_prompt_version, charlotte_contract_version,
        wilbur_record_version
      FROM lifecycle_runs
      WHERE id = $3::uuid AND clerk_user_id = $4::text
    `,
    values: [PRECISION_RUN_ID, PRECISION_GAME_ID, RUN_ID, OWNER],
  })
})

afterAll(async () => {
  await database.dispose()
})

describe('durable visible research repository on PostgreSQL 17', () => {
  it('binds repository-serialized consent to authoritative sub-millisecond precision', async () => {
    const serviceGame = await games.getOwnedGame(OWNER, PRECISION_GAME_ID)
    expect(serviceGame).toMatchObject({
      id: PRECISION_GAME_ID,
      status: 'dividing',
      researchConsent: {
        version: RESEARCH_CONSENT.version,
        decision: RESEARCH_CONSENT.decision,
        recordedAt: expect.stringMatching(/\.\d{3}Z$/u),
      },
    })

    const started = await research.start({
      ownerId: OWNER,
      gameId: PRECISION_GAME_ID,
      lifecycleRunId: PRECISION_RUN_ID,
      lifecycleState: 'portia_pending',
      stage: 'web',
      problem: PRECISION_PROBLEM,
      researchConsent: serviceGame.researchConsent,
      policyVersion: `${RESEARCH_POLICY_VERSION}-precision-start`,
      materiality: 'required',
      reason: 'Service-returned consent must bind to the authoritative game timestamp.',
      query: 'authoritative consent timestamp precision',
      timeoutMs: 30_000,
      configurationDigest: CONFIGURATION_DIGEST,
    })
    expect(started).toMatchObject({
      created: true,
      record: { consent: serviceGame.researchConsent },
    })

    const notNeededInput = {
      ownerId: OWNER,
      gameId: PRECISION_GAME_ID,
      lifecycleRunId: PRECISION_RUN_ID,
      lifecycleState: 'portia_pending',
      stage: 'chess',
      problem: PRECISION_PROBLEM,
      researchConsent: serviceGame.researchConsent,
      policyVersion: `${RESEARCH_POLICY_VERSION}-precision-not-needed`,
      reason: 'The same service consent must bind to a not-needed decision.',
      configurationDigest: CONFIGURATION_DIGEST,
    } as const
    const notNeeded = await research.recordNotNeeded(notNeededInput)
    expect(notNeeded).toMatchObject({
      status: 'not_needed',
      consent: serviceGame.researchConsent,
    })
    await expect(research.recordNotNeeded(notNeededInput)).resolves.toEqual(
      notNeeded,
    )

    const storedConsentPrecision = await database.adapter.query({
      text: `
        SELECT
          requests.stage,
          to_char(
            games.research_consent_recorded_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ) AS game_recorded_at,
          to_char(
            requests.research_consent_recorded_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ) AS request_recorded_at,
          games.research_consent_recorded_at =
            requests.research_consent_recorded_at AS copied_from_game
        FROM games
        INNER JOIN research_requests AS requests
          ON requests.game_id = games.id
        WHERE games.clerk_user_id = $1::text
          AND games.id = $2::uuid
          AND requests.id IN ($3::uuid, $4::uuid)
        ORDER BY requests.stage
      `,
      values: [
        OWNER,
        PRECISION_GAME_ID,
        started.record.id,
        notNeeded.id,
      ],
    })
    expect(storedConsentPrecision.rows).toHaveLength(2)
    const exactGameTimestamp = String(
      storedConsentPrecision.rows[0]?.game_recorded_at,
    )
    expect(exactGameTimestamp).toMatch(/\.\d{3}999Z$/u)
    expect(exactGameTimestamp.replace(/999Z$/u, 'Z')).toBe(
      serviceGame.researchConsent.recordedAt,
    )
    expect(storedConsentPrecision.rows).toEqual([
      {
        stage: 'chess',
        game_recorded_at: exactGameTimestamp,
        request_recorded_at: exactGameTimestamp,
        copied_from_game: true,
      },
      {
        stage: 'web',
        game_recorded_at: exactGameTimestamp,
        request_recorded_at: exactGameTimestamp,
        copied_from_game: true,
      },
    ])
  })

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
      researchConsent: RESEARCH_CONSENT,
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
      fetchFailures: [],
      consent: RESEARCH_CONSENT,
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
      directPageTextFetched: true,
      retrievedFacts: [retrievedFact()],
      fetchFailures: [fetchFailure()],
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
      consent: RESEARCH_CONSENT,
      directPageTextFetched: true,
    })
    expect(completed.retrievedFacts).toEqual([retrievedFact()])
    expect(completed.fetchFailures).toEqual([fetchFailure()])
    expect(sha256(completed.retrievedFacts[0]!.text)).toBe(
      completed.retrievedFacts[0]!.contentDigest,
    )
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
      researchConsent: RESEARCH_CONSENT,
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

  it('rejects mismatched consent before returning an existing policy claim', async () => {
    await expect(research.start({
      ownerId: OWNER,
      gameId: GAME_ID,
      lifecycleRunId: RUN_ID,
      lifecycleState: 'portia_pending',
      stage: 'portia',
      problem: PROBLEM,
      researchConsent: {
        ...RESEARCH_CONSENT,
        decision: 'no_external_research',
      },
      policyVersion: RESEARCH_POLICY_VERSION,
      materiality: 'required',
      reason: 'This mismatched consent must not recover the existing durable research claim.',
      query: 'mismatched consent must not begin external research',
      timeoutMs: 30_000,
      configurationDigest: CONFIGURATION_DIGEST,
    })).rejects.toMatchObject({
      code: 'conflict',
      message: 'The supplied research consent does not match the owning game.',
    })

    const persisted = await research.getForGame(OWNER, GAME_ID)
    expect(persisted.filter((record) =>
      record.stage === 'portia' &&
      record.policyVersion === RESEARCH_POLICY_VERSION)).toHaveLength(1)
  })

  it.each(START_CONSENT_MISMATCHES)(
    'rejects a mismatched game consent $label without recording a search start',
    async ({ label, stage, consent }) => {
      const policyVersion = `${RESEARCH_POLICY_VERSION}-consent-${label.replaceAll(' ', '-')}`
      await expect(research.start({
        ownerId: OWNER,
        gameId: GAME_ID,
        lifecycleRunId: RUN_ID,
        lifecycleState: 'portia_pending',
        stage,
        problem: PROBLEM,
        researchConsent: consent,
        policyVersion,
        materiality: 'required',
        reason: 'The repository must reject consent that differs from the owning game.',
        query: 'mismatched game consent must not begin external research',
        timeoutMs: 30_000,
        configurationDigest: CONFIGURATION_DIGEST,
      })).rejects.toMatchObject({
        code: 'conflict',
        message: 'The supplied research consent does not match the owning game.',
      })

      const persisted = await database.adapter.query({
        text: `
          SELECT
            (
              SELECT count(*)::integer
              FROM research_requests
              WHERE game_id = $1::uuid AND policy_version = $2::text
            ) AS request_count,
            (
              SELECT count(*)::integer
              FROM lifecycle_events
              WHERE lifecycle_run_id = $3::uuid
                AND stage = $4::text
                AND activity_type = 'research_search_started'
            ) AS activity_count
        `,
        values: [GAME_ID, policyVersion, RUN_ID, stage],
      })
      expect(persisted.rows).toEqual([{
        request_count: 0,
        activity_count: 0,
      }])
    },
  )

  it.each(START_CONSENT_MISMATCHES)(
    'rejects mismatched $label consent without recording a not-needed decision or event',
    async ({ label, stage, consent }) => {
      const policyVersion = `${RESEARCH_POLICY_VERSION}-not-needed-${label.replaceAll(' ', '-')}`
      await expect(research.recordNotNeeded({
        ownerId: OWNER,
        gameId: GAME_ID,
        lifecycleRunId: RUN_ID,
        lifecycleState: 'portia_pending',
        stage,
        problem: PROBLEM,
        researchConsent: consent,
        policyVersion,
        reason: 'The repository must reject a decision that differs from the owning game.',
        configurationDigest: CONFIGURATION_DIGEST,
      })).rejects.toMatchObject({
        code: 'conflict',
        message: 'The supplied research consent does not match the owning game.',
      })

      const persisted = await database.adapter.query({
        text: `
          SELECT
            (
              SELECT count(*)::integer
              FROM research_requests
              WHERE game_id = $1::uuid AND policy_version = $2::text
            ) AS request_count,
            (
              SELECT count(*)::integer
              FROM lifecycle_events
              WHERE lifecycle_run_id = $3::uuid
                AND stage = $4::text
                AND activity_type = 'research_not_needed'
            ) AS activity_count
        `,
        values: [GAME_ID, policyVersion, RUN_ID, stage],
      })
      expect(persisted.rows).toEqual([{
        request_count: 0,
        activity_count: 0,
      }])
    },
  )

  it.each(STORED_CONSENT_MISMATCHES)(
    'rejects existing policy rows with a conflicting stored $label on both idempotent paths',
    async ({ label, consent }) => {
      const suffix = label.replaceAll(' ', '-')
      const cases = [
        {
          requestId: randomUUID(),
          stage: 'anansi',
          policyVersion: `${RESEARCH_POLICY_VERSION}-stored-${suffix}-start`,
          method: 'start',
        },
        {
          requestId: randomUUID(),
          stage: 'web',
          policyVersion: `${RESEARCH_POLICY_VERSION}-stored-${suffix}-not-needed`,
          method: 'recordNotNeeded',
        },
      ] as const

      for (const testCase of cases) {
        await database.adapter.query({
          text: `
            INSERT INTO research_requests (
              id, clerk_user_id, game_id, lifecycle_run_id, stage,
              policy_version, research_consent_version,
              research_consent_decision, research_consent_recorded_at,
              materiality, reason, query, status,
              result_limit, source_limit, timeout_ms,
              synthesis_character_limit, completed_at
            ) VALUES (
              $1::uuid, $2::text, $3::uuid, $4::uuid, $5::text,
              $6::text, $7::text, $8::text, $9::timestamptz,
              NULL, $10::text, NULL, 'not_needed',
              $11::smallint, $12::smallint, $13::integer,
              $14::integer, now()
            )
          `,
          values: [
            testCase.requestId,
            OWNER,
            GAME_ID,
            RUN_ID,
            testCase.stage,
            testCase.policyVersion,
            consent.version,
            consent.decision,
            consent.recordedAt,
            'This pre-fix row deliberately conflicts with authoritative game consent.',
            5,
            8,
            150_000,
            32_000,
          ],
        })
      }

      const persistedState = () => database.adapter.query({
        text: `
          SELECT
            id,
            stage,
            policy_version,
            research_consent_version,
            research_consent_decision,
            research_consent_recorded_at,
            status,
            updated_at
          FROM research_requests
          WHERE id = ANY($1::uuid[])
          ORDER BY id
        `,
        values: [cases.map((testCase) => testCase.requestId)],
      })
      const before = await persistedState()
      expect(before.rows).toHaveLength(2)

      for (const testCase of cases) {
        const common = {
          ownerId: OWNER,
          gameId: GAME_ID,
          lifecycleRunId: RUN_ID,
          lifecycleState: 'portia_pending' as const,
          stage: testCase.stage,
          problem: PROBLEM,
          researchConsent: RESEARCH_CONSENT,
          policyVersion: testCase.policyVersion,
          configurationDigest: CONFIGURATION_DIGEST,
        }
        const operation = testCase.method === 'start'
          ? research.start({
              ...common,
              materiality: 'required',
              reason: 'A conflicting pre-fix claim must not be returned as an idempotent search.',
              query: 'conflicting stored consent must fail closed',
              timeoutMs: 30_000,
            })
          : research.recordNotNeeded({
              ...common,
              reason: 'A conflicting pre-fix decision must not be returned as not needed.',
            })

        await expect(operation).rejects.toMatchObject({
          code: 'integrity-error',
          message: 'The existing research request consent does not match the owning game.',
        })
      }

      expect((await persistedState()).rows).toEqual(before.rows)
      const activities = await database.adapter.query({
        text: `
          SELECT count(*)::integer AS count
          FROM lifecycle_events
          WHERE lifecycle_run_id = $1::uuid
            AND output_entity_ids ?| $2::text[]
            AND activity_type IN (
              'research_search_started',
              'research_not_needed'
            )
        `,
        values: [RUN_ID, cases.map((testCase) => testCase.requestId)],
      })
      expect(activities.rows).toEqual([{ count: 0 }])

      await database.adapter.query({
        text: 'DELETE FROM research_requests WHERE id = ANY($1::uuid[])',
        values: [cases.map((testCase) => testCase.requestId)],
      })
    },
  )

  it('rejects a pre-fix policy row with mismatched consent without mutating it', async () => {
    const malformedRecordedAt = '2026-08-02T16:00:00.000500Z'
    await database.adapter.query({
      text: `
        UPDATE research_requests
        SET research_consent_recorded_at = $4::timestamptz
        WHERE clerk_user_id = $1::text
          AND game_id = $2::uuid
          AND stage = 'portia'
          AND policy_version = $3::text
      `,
      values: [OWNER, GAME_ID, RESEARCH_POLICY_VERSION, malformedRecordedAt],
    })

    const persistedState = () => database.adapter.query({
      text: `
        SELECT
          request.research_consent_version,
          request.research_consent_decision,
          request.research_consent_recorded_at,
          to_char(
            request.research_consent_recorded_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ) AS research_consent_recorded_at_exact,
          request.status,
          request.updated_at,
          (
            SELECT count(*)::integer
            FROM lifecycle_events
            WHERE lifecycle_run_id = $4::uuid
              AND stage = 'portia'
              AND activity_type IN (
                'research_search_started',
                'research_not_needed'
              )
          ) AS activity_count
        FROM research_requests AS request
        WHERE request.clerk_user_id = $1::text
          AND request.game_id = $2::uuid
          AND request.stage = 'portia'
          AND request.policy_version = $3::text
      `,
      values: [OWNER, GAME_ID, RESEARCH_POLICY_VERSION, RUN_ID],
    })
    const before = await persistedState()
    expect(before.rows).toHaveLength(1)
    expect(before.rows[0]).toMatchObject({
      research_consent_version: RESEARCH_CONSENT.version,
      research_consent_decision: RESEARCH_CONSENT.decision,
      research_consent_recorded_at: new Date(malformedRecordedAt),
      research_consent_recorded_at_exact: malformedRecordedAt,
      status: 'completed',
      activity_count: 1,
    })

    try {
      await expect(research.start({
        ownerId: OWNER,
        gameId: GAME_ID,
        lifecycleRunId: RUN_ID,
        lifecycleState: 'portia_pending',
        stage: 'portia',
        problem: PROBLEM,
        researchConsent: RESEARCH_CONSENT,
        policyVersion: RESEARCH_POLICY_VERSION,
        materiality: 'required',
        reason: 'A malformed pre-fix row must not be recovered as an idempotent search claim.',
        query: 'malformed durable consent must fail closed',
        timeoutMs: 30_000,
        configurationDigest: CONFIGURATION_DIGEST,
      })).rejects.toMatchObject({
        code: 'integrity-error',
        message: 'The existing research request consent does not match the owning game.',
      })

      await expect(research.recordNotNeeded({
        ownerId: OWNER,
        gameId: GAME_ID,
        lifecycleRunId: RUN_ID,
        lifecycleState: 'portia_pending',
        stage: 'portia',
        problem: PROBLEM,
        researchConsent: RESEARCH_CONSENT,
        policyVersion: RESEARCH_POLICY_VERSION,
        reason: 'A malformed pre-fix row must not be recovered as a no-research decision.',
        configurationDigest: CONFIGURATION_DIGEST,
      })).rejects.toMatchObject({
        code: 'integrity-error',
        message: 'The existing research request consent does not match the owning game.',
      })

      const after = await persistedState()
      expect(after.rows).toEqual(before.rows)
    } finally {
      await database.adapter.query({
        text: `
          UPDATE research_requests
          SET research_consent_recorded_at = $4::timestamptz
          WHERE clerk_user_id = $1::text
            AND game_id = $2::uuid
            AND stage = 'portia'
            AND policy_version = $3::text
        `,
        values: [
          OWNER,
          GAME_ID,
          RESEARCH_POLICY_VERSION,
          CONSENT_RECORDED_AT,
        ],
      })
    }
  })

  it('persists bounded terminal failures and not-needed decisions visibly', async () => {
    const failedStartResult = await research.start({
      ownerId: OWNER,
      gameId: GAME_ID,
      lifecycleRunId: RUN_ID,
      lifecycleState: 'portia_pending',
      stage: 'charlotte',
      problem: PROBLEM,
      researchConsent: RESEARCH_CONSENT,
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
      researchConsent: RESEARCH_CONSENT,
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
        WHERE clerk_user_id = $1::text AND status = 'not_needed'
      `,
      values: [OWNER],
    })).rejects.toThrow()
  })

  it('enforces versioned consent and bounded page-evidence shapes in PostgreSQL', async () => {
    await expect(database.adapter.query({
      text: `
        UPDATE games
        SET research_consent_recorded_at = NULL
        WHERE id = $1::uuid
      `,
      values: [GAME_ID],
    })).rejects.toMatchObject({
      constraint: 'games_research_consent_shape',
    })

    await expect(database.adapter.query({
      text: `
        UPDATE research_requests
        SET research_consent_decision = 'no_external_research'
        WHERE clerk_user_id = $1::text AND status = 'completed'
      `,
      values: [OWNER],
    })).rejects.toMatchObject({ code: '23514' })

    await expect(database.adapter.query({
      text: `
        UPDATE research_requests
        SET fetch_failures = '[{},{},{},{}]'::jsonb
        WHERE clerk_user_id = $1::text AND status = 'completed'
      `,
      values: [OWNER],
    })).rejects.toMatchObject({
      constraint: 'research_requests_json_shapes',
    })
  })

  it('fails closed when persisted accepted text no longer matches its digest', async () => {
    await database.adapter.query({
      text: `
        UPDATE research_requests
        SET retrieved_facts = jsonb_set(
          retrieved_facts,
          '{0,contentDigest}',
          to_jsonb(repeat('0', 64))
        )
        WHERE clerk_user_id = $1::text
          AND game_id = $2::uuid
          AND stage = 'portia'
      `,
      values: [OWNER, GAME_ID],
    })

    await expect(research.getForGame(OWNER, GAME_ID)).rejects.toThrow(
      'The database returned malformed research provenance.',
    )
  })
})
