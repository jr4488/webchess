import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import {
  LIFECYCLE_STATES,
  type LifecycleState,
} from '../../lib/lifecycle'
import {
  RESEARCH_STAGES,
  RESEARCH_STATUSES,
  type ResearchRecord,
  type ResearchSource,
} from '../../lib/research'
import type { SqlAdapter, SqlResult } from '../db'
import { ResearchRepositoryError } from './errors'
import { RESEARCH_BOUNDS } from './policy'
import type {
  CompleteResearchInput,
  FailResearchInput,
  RecordNoResearchInput,
  ResearchRepositoryPort,
  StartResearchInput,
  StartResearchResult,
} from './types'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SHA256_PATTERN = /^[0-9a-f]{64}$/u

const timestampSchema = z.preprocess(
  (value) => (typeof value === 'string' ? new Date(value) : value),
  z.date(),
)

export const researchRequestRowSchema = z.object({
  id: z.string().uuid(),
  clerk_user_id: z.string().min(3).max(255),
  game_id: z.string().uuid(),
  lifecycle_run_id: z.string().uuid().nullable(),
  stage: z.enum(RESEARCH_STAGES),
  requested_by: z.literal('research-policy'),
  policy_version: z.string().min(1).max(80),
  materiality: z.enum(['helpful', 'required']).nullable(),
  reason: z.string().min(8).max(1000),
  query: z.string().min(3).max(320).nullable(),
  status: z.enum(RESEARCH_STATUSES),
  provider: z.literal('codex'),
  transport: z.literal('local'),
  model: z.string().min(1).max(200).nullable(),
  invocation_limit: z.literal(1),
  result_limit: z.number().int().min(1).max(5),
  source_limit: z.number().int().min(1).max(8),
  timeout_ms: z.number().int().min(1000).max(RESEARCH_BOUNDS.timeoutMs),
  synthesis_character_limit: z.number().int().min(500).max(32000),
  attempt_count: z.number().int().min(0).max(1),
  executed_queries: z.array(z.unknown()),
  search_synthesis: z.string().nullable(),
  direct_page_text_fetched: z.literal(false),
  retrieved_facts: z.array(z.unknown()).length(0),
  omitted_source_count: z.number().int().min(0).max(100),
  injection_signals: z.array(z.unknown()),
  content_digest: z.string().regex(SHA256_PATTERN).nullable(),
  failure_code: z.string().min(1).max(80).nullable(),
  started_at: timestampSchema.nullable(),
  completed_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
})

export const researchSourceRowSchema = z.object({
  id: z.string().uuid(),
  clerk_user_id: z.string().min(3).max(255),
  research_request_id: z.string().uuid(),
  ordinal: z.number().int().min(1).max(8),
  citation_id: z.string().min(2).max(40),
  title: z.string().min(1).max(500),
  url: z.string().min(8).max(2048),
  hostname: z.string().min(1).max(253),
  trust: z.enum(['government_or_education', 'general_web']),
  discovered_from: z.enum(['search_activity', 'synthesis_link']),
  created_at: timestampSchema,
})

export type ResearchRequestRow = z.infer<typeof researchRequestRowSchema>
export type ResearchSourceRow = z.infer<typeof researchSourceRowSchema>

export const SELECT_RESEARCH_REQUEST_COLUMNS = `
  id,
  clerk_user_id,
  game_id,
  lifecycle_run_id,
  stage,
  requested_by,
  policy_version,
  materiality,
  reason,
  query,
  status,
  provider,
  transport,
  model,
  invocation_limit,
  result_limit,
  source_limit,
  timeout_ms,
  synthesis_character_limit,
  attempt_count,
  executed_queries,
  search_synthesis,
  direct_page_text_fetched,
  retrieved_facts,
  omitted_source_count,
  injection_signals,
  content_digest,
  failure_code,
  started_at,
  completed_at,
  created_at,
  updated_at
`

export const SELECT_RESEARCH_SOURCE_COLUMNS = `
  id,
  clerk_user_id,
  research_request_id,
  ordinal,
  citation_id,
  title,
  url,
  hostname,
  trust,
  discovered_from,
  created_at
`

function assertOwner(value: string): string {
  const owner = value.trim()
  if (owner.length < 3 || owner.length > 255) {
    throw new ResearchRepositoryError(
      'invalid-input',
      'A valid authenticated owner is required.',
    )
  }
  return owner
}

function assertUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new ResearchRepositoryError('invalid-input', `${label} must be a UUID.`)
  }
  return value
}

function assertDigest(value: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new ResearchRepositoryError(
      'invalid-input',
      'Research configuration must use a lowercase SHA-256 digest.',
    )
  }
  return value
}

function normalizeText(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
): string {
  const text = value.replace(/\s+/gu, ' ').trim()
  if (text.length < minimum || text.length > maximum) {
    throw new ResearchRepositoryError(
      'invalid-input',
      `${label} must contain ${minimum} through ${maximum} characters.`,
    )
  }
  return text
}

function assertLifecycleState(value: string): LifecycleState {
  if (!(LIFECYCLE_STATES as readonly string[]).includes(value)) {
    throw new ResearchRepositoryError(
      'invalid-input',
      'The research activity is not bound to a valid lifecycle state.',
    )
  }
  return value as LifecycleState
}

function stringArray(value: readonly unknown[], label: string): readonly string[] {
  if (value.some((item) => typeof item !== 'string')) {
    throw new ResearchRepositoryError(
      'integrity-error',
      `Stored ${label} must contain only strings.`,
    )
  }
  return value as readonly string[]
}

function parseRows<T>(result: SqlResult, schema: z.ZodType<T>): readonly T[] {
  const parsed = z.array(schema).safeParse(result.rows)
  if (!parsed.success) {
    throw new ResearchRepositoryError(
      'integrity-error',
      'The database returned malformed research provenance.',
      { cause: parsed.error },
    )
  }
  return parsed.data
}

function sourceFromRow(row: ResearchSourceRow): ResearchSource {
  return {
    id: row.id,
    citationId: row.citation_id,
    ordinal: row.ordinal,
    title: row.title,
    url: row.url,
    hostname: row.hostname,
    trust: row.trust,
    discoveredFrom: row.discovered_from,
    createdAt: row.created_at.toISOString(),
  }
}

export function researchRecordsFromRows(
  requestRows: readonly ResearchRequestRow[],
  sourceRows: readonly ResearchSourceRow[],
): readonly ResearchRecord[] {
  const sourcesByRequest = new Map<string, ResearchSource[]>()
  for (const sourceRow of sourceRows) {
    const sources = sourcesByRequest.get(sourceRow.research_request_id) ?? []
    sources.push(sourceFromRow(sourceRow))
    sourcesByRequest.set(sourceRow.research_request_id, sources)
  }

  return requestRows.map((row) => {
    const executedQueries = stringArray(row.executed_queries, 'executed research queries')
    const injectionSignalsDetected = stringArray(
      row.injection_signals,
      'research injection signals',
    )
    if (!row.lifecycle_run_id) {
      throw new ResearchRepositoryError(
        'integrity-error',
        'A lifecycle aggregate cannot expose research that is not yet bound to its run.',
      )
    }
    return {
      id: row.id,
      lifecycleRunId: row.lifecycle_run_id,
      gameId: row.game_id,
      stage: row.stage,
      requestedBy: row.requested_by,
      policyVersion: row.policy_version,
      materiality: row.materiality,
      reason: row.reason,
      query: row.query,
      status: row.status,
      provider: row.provider,
      transport: row.transport,
      model: row.model,
      bounds: {
        invocationLimit: row.invocation_limit,
        resultLimit: row.result_limit,
        sourceLimit: row.source_limit,
        timeoutMs: row.timeout_ms,
        synthesisCharacterLimit: row.synthesis_character_limit,
      },
      attemptCount: row.attempt_count,
      executedQueries,
      searchSynthesis: row.search_synthesis,
      directPageTextFetched: row.direct_page_text_fetched,
      retrievedFacts: [],
      sources: (sourcesByRequest.get(row.id) ?? [])
        .sort((left, right) => left.ordinal - right.ordinal),
      omittedSourceCount: row.omitted_source_count,
      injectionSignalsDetected,
      contentDigest: row.content_digest,
      failureCode: row.failure_code,
      startedAt: row.started_at?.toISOString() ?? null,
      completedAt: row.completed_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }
  })
}

function resultId(result: SqlResult): string | null {
  const value = result.rows[0]?.id
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null
}

export class DurableResearchRepository implements ResearchRepositoryPort {
  constructor(private readonly database: SqlAdapter) {}

  async getForGame(
    ownerId: string,
    gameId: string,
  ): Promise<readonly ResearchRecord[]> {
    const owner = assertOwner(ownerId)
    const game = assertUuid(gameId, 'Game id')
    const results = await this.database.transaction([
      {
        text: `SELECT ${SELECT_RESEARCH_REQUEST_COLUMNS} FROM research_requests WHERE clerk_user_id = $1::text AND game_id = $2::uuid ORDER BY created_at, id`,
        values: [owner, game],
      },
      {
        text: `SELECT ${SELECT_RESEARCH_SOURCE_COLUMNS} FROM research_sources WHERE clerk_user_id = $1::text AND research_request_id IN (SELECT id FROM research_requests WHERE clerk_user_id = $1::text AND game_id = $2::uuid) ORDER BY research_request_id, ordinal`,
        values: [owner, game],
      },
    ], { isolationLevel: 'RepeatableRead', readOnly: true })
    return researchRecordsFromRows(
      parseRows(results[0]!, researchRequestRowSchema),
      parseRows(results[1]!, researchSourceRowSchema),
    )
  }

  private async getById(ownerId: string, requestId: string): Promise<ResearchRecord> {
    const results = await this.database.transaction([
      {
        text: `SELECT ${SELECT_RESEARCH_REQUEST_COLUMNS} FROM research_requests WHERE clerk_user_id = $1::text AND id = $2::uuid`,
        values: [ownerId, requestId],
      },
      {
        text: `SELECT ${SELECT_RESEARCH_SOURCE_COLUMNS} FROM research_sources WHERE clerk_user_id = $1::text AND research_request_id = $2::uuid ORDER BY ordinal`,
        values: [ownerId, requestId],
      },
    ], { isolationLevel: 'RepeatableRead', readOnly: true })
    const records = researchRecordsFromRows(
      parseRows(results[0]!, researchRequestRowSchema),
      parseRows(results[1]!, researchSourceRowSchema),
    )
    const record = records[0]
    if (!record) {
      throw new ResearchRepositoryError('not-found', 'Research request not found.')
    }
    return record
  }

  private async existingForPolicy(input: {
    ownerId: string
    gameId: string
    stage: string
    policyVersion: string
  }): Promise<ResearchRecord | null> {
    const records = await this.getForGame(input.ownerId, input.gameId)
    return records.find(
      (record) =>
        record.stage === input.stage &&
        record.policyVersion === input.policyVersion,
    ) ?? null
  }

  async recordNotNeeded(input: RecordNoResearchInput): Promise<ResearchRecord> {
    const id = randomUUID()
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const lifecycleRunId = assertUuid(input.lifecycleRunId, 'Lifecycle run id')
    const state = assertLifecycleState(input.lifecycleState)
    const reason = normalizeText(input.reason, 'Research reason', 8, 1000)
    const configurationDigest = assertDigest(input.configurationDigest)
    const result = await this.database.query({
      text: `
        WITH target AS (
          SELECT id, state, event_version
          FROM lifecycle_runs
          WHERE id = $4::uuid AND game_id = $3::uuid AND clerk_user_id = $2::text
            AND state = $5::text
          FOR UPDATE
        ), inserted AS (
          INSERT INTO research_requests (
            id, clerk_user_id, game_id, lifecycle_run_id, stage,
            policy_version, materiality, reason, query, status,
            result_limit, source_limit, timeout_ms,
            synthesis_character_limit, completed_at
          )
          SELECT
            $1::uuid, $2::text, $3::uuid, target.id, $6::text,
            $7::text, NULL, $8::text, NULL, 'not_needed',
            $9::smallint, $10::smallint, $11::integer, $12::integer, now()
          FROM target
          ON CONFLICT (game_id, stage, policy_version) DO NOTHING
          RETURNING id, lifecycle_run_id, stage
        ), activity AS (
          INSERT INTO lifecycle_events (
            id, clerk_user_id, lifecycle_run_id, sequence, stage,
            activity_type, state_from, state_to, input_entity_ids,
            output_entity_ids, responsible_agent_ids,
            configuration_digest, status, event_version
          )
          SELECT
            gen_random_uuid(), $2::text, inserted.lifecycle_run_id,
            coalesce((SELECT max(sequence) + 1 FROM lifecycle_events WHERE lifecycle_run_id = inserted.lifecycle_run_id), 1),
            inserted.stage, 'research_not_needed', $5::text, $5::text,
            jsonb_build_array($3::text), jsonb_build_array(inserted.id::text),
            jsonb_build_array('research-policy'), $13::char(64),
            'completed', target.event_version
          FROM inserted CROSS JOIN target
        )
        SELECT id FROM inserted
      `,
      values: [
        id,
        owner,
        gameId,
        lifecycleRunId,
        state,
        input.stage,
        input.policyVersion,
        reason,
        RESEARCH_BOUNDS.resultLimit,
        RESEARCH_BOUNDS.sourceLimit,
        RESEARCH_BOUNDS.timeoutMs,
        RESEARCH_BOUNDS.synthesisCharacterLimit,
        configurationDigest,
      ],
    })
    const storedId = resultId(result)
    if (storedId) return this.getById(owner, storedId)
    const existing = await this.existingForPolicy({
      ownerId: owner,
      gameId,
      stage: input.stage,
      policyVersion: input.policyVersion,
    })
    if (existing) return existing
    throw new ResearchRepositoryError(
      'conflict',
      'The lifecycle changed before the research policy decision was recorded.',
    )
  }

  async start(input: StartResearchInput): Promise<StartResearchResult> {
    const id = randomUUID()
    const owner = assertOwner(input.ownerId)
    const gameId = assertUuid(input.gameId, 'Game id')
    const lifecycleRunId = assertUuid(input.lifecycleRunId, 'Lifecycle run id')
    const state = assertLifecycleState(input.lifecycleState)
    const reason = normalizeText(input.reason, 'Research reason', 8, 1000)
    const query = normalizeText(input.query, 'Research query', 3, 320)
    if (
      !Number.isSafeInteger(input.timeoutMs) ||
      input.timeoutMs < 1_000 ||
      input.timeoutMs > RESEARCH_BOUNDS.timeoutMs
    ) {
      throw new ResearchRepositoryError(
        'invalid-input',
        'The applied research timeout exceeds the durable policy ceiling.',
      )
    }
    const configurationDigest = assertDigest(input.configurationDigest)
    const result = await this.database.query({
      text: `
        WITH target AS (
          SELECT id, state, event_version
          FROM lifecycle_runs
          WHERE id = $4::uuid AND game_id = $3::uuid AND clerk_user_id = $2::text
            AND state = $5::text
          FOR UPDATE
        ), inserted AS (
          INSERT INTO research_requests (
            id, clerk_user_id, game_id, lifecycle_run_id, stage,
            policy_version, materiality, reason, query, status,
            result_limit, source_limit, timeout_ms,
            synthesis_character_limit, attempt_count, started_at
          )
          SELECT
            $1::uuid, $2::text, $3::uuid, target.id, $6::text,
            $7::text, $8::text, $9::text, $10::text, 'searching',
            $11::smallint, $12::smallint, $13::integer,
            $14::integer, 1, now()
          FROM target
          ON CONFLICT (game_id, stage, policy_version) DO NOTHING
          RETURNING id, lifecycle_run_id, stage
        ), activity AS (
          INSERT INTO lifecycle_events (
            id, clerk_user_id, lifecycle_run_id, sequence, stage,
            activity_type, state_from, state_to, input_entity_ids,
            output_entity_ids, responsible_agent_ids,
            configuration_digest, status, event_version
          )
          SELECT
            gen_random_uuid(), $2::text, inserted.lifecycle_run_id,
            coalesce((SELECT max(sequence) + 1 FROM lifecycle_events WHERE lifecycle_run_id = inserted.lifecycle_run_id), 1),
            inserted.stage, 'research_search_started', $5::text, $5::text,
            jsonb_build_array($3::text), jsonb_build_array(inserted.id::text),
            jsonb_build_array('research-broker', 'openclaw:codex'),
            $15::char(64), 'started', target.event_version
          FROM inserted CROSS JOIN target
        )
        SELECT id FROM inserted
      `,
      values: [
        id,
        owner,
        gameId,
        lifecycleRunId,
        state,
        input.stage,
        input.policyVersion,
        input.materiality,
        reason,
        query,
        RESEARCH_BOUNDS.resultLimit,
        RESEARCH_BOUNDS.sourceLimit,
        input.timeoutMs,
        RESEARCH_BOUNDS.synthesisCharacterLimit,
        configurationDigest,
      ],
    })
    const storedId = resultId(result)
    if (storedId) {
      return {
        created: true,
        record: await this.getById(owner, storedId),
      }
    }
    const existing = await this.existingForPolicy({
      ownerId: owner,
      gameId,
      stage: input.stage,
      policyVersion: input.policyVersion,
    })
    if (existing) return { created: false, record: existing }
    throw new ResearchRepositoryError(
      'conflict',
      'The lifecycle changed before automatic research began.',
    )
  }

  async complete(input: CompleteResearchInput): Promise<ResearchRecord> {
    const owner = assertOwner(input.ownerId)
    const requestId = assertUuid(input.requestId, 'Research request id')
    const state = assertLifecycleState(input.lifecycleState)
    const model = normalizeText(input.model, 'Research model', 1, 200)
    const synthesis = input.searchSynthesis.trim()
    if (
      synthesis.length < 1 ||
      synthesis.length > RESEARCH_BOUNDS.synthesisCharacterLimit
    ) {
      throw new ResearchRepositoryError(
        'invalid-input',
        'The Codex Search synthesis exceeds the persisted research bound.',
      )
    }
    const configurationDigest = assertDigest(input.configurationDigest)
    const contentDigest = assertDigest(input.contentDigest)
    if (
      input.sources.length < 1 ||
      input.sources.length > RESEARCH_BOUNDS.sourceLimit ||
      !Number.isSafeInteger(input.omittedSourceCount) ||
      input.omittedSourceCount < 0 ||
      input.omittedSourceCount > 100 ||
      input.executedQueries.length < 1 ||
      input.executedQueries.length > 500 ||
      input.executedQueries.some(
        (query) => query.trim() !== query || query.length < 1 || query.length > 500,
      ) ||
      input.injectionSignalsDetected.length > 20 ||
      input.injectionSignalsDetected.some(
        (signal) => !/^[a-z0-9_]{3,80}$/u.test(signal),
      )
    ) {
      throw new ResearchRepositoryError(
        'invalid-input',
        'The completed research result exceeds its durable evidence bounds.',
      )
    }
    const citationIds = new Set<string>()
    const sourceUrls = new Set<string>()
    input.sources.forEach((source, index) => {
      let parsedUrl: URL
      try {
        parsedUrl = new URL(source.url)
      } catch {
        throw new ResearchRepositoryError(
          'invalid-input',
          'A research citation URL is invalid.',
        )
      }
      if (
        source.ordinal !== index + 1 ||
        !/^R[1-8]$/u.test(source.citationId) ||
        citationIds.has(source.citationId) ||
        source.title.trim() !== source.title ||
        source.title.length < 1 ||
        source.title.length > 500 ||
        parsedUrl.protocol !== 'https:' ||
        parsedUrl.username !== '' ||
        parsedUrl.password !== '' ||
        parsedUrl.hostname !== source.hostname ||
        sourceUrls.has(parsedUrl.toString())
      ) {
        throw new ResearchRepositoryError(
          'invalid-input',
          'The completed research citations violate their provenance contract.',
        )
      }
      citationIds.add(source.citationId)
      sourceUrls.add(parsedUrl.toString())
    })
    const sources = input.sources.map((source) => ({
      id: randomUUID(),
      ...source,
    }))
    const result = await this.database.query({
      text: `
        WITH target AS (
          SELECT requests.id, requests.lifecycle_run_id, requests.stage,
                 runs.state, runs.event_version
          FROM research_requests AS requests
          INNER JOIN lifecycle_runs AS runs ON runs.id = requests.lifecycle_run_id
          WHERE requests.id = $2::uuid AND requests.clerk_user_id = $1::text
            AND requests.status = 'searching' AND runs.state = $3::text
          FOR UPDATE OF requests, runs
        ), updated AS (
          UPDATE research_requests AS requests
          SET status = 'completed', model = $4::text,
              executed_queries = $5::jsonb,
              search_synthesis = $6::text,
              omitted_source_count = $7::smallint,
              injection_signals = $8::jsonb,
              content_digest = $9::char(64), failure_code = NULL,
              completed_at = now(), updated_at = now()
          FROM target
          WHERE requests.id = target.id
          RETURNING requests.id, requests.lifecycle_run_id, requests.stage
        ), inserted_sources AS (
          INSERT INTO research_sources (
            id, clerk_user_id, research_request_id, ordinal, citation_id,
            title, url, hostname, trust, discovered_from
          )
          SELECT
            source.id::uuid, $1::text, updated.id,
            source.ordinal::smallint, source.citation_id::text,
            source.title::text, source.url::text, source.hostname::text,
            source.trust::text, source.discovered_from::text
          FROM updated
          CROSS JOIN jsonb_to_recordset($10::jsonb) AS source(
            id text, ordinal integer, citation_id text, title text, url text,
            hostname text, trust text, discovered_from text
          )
          RETURNING id
        ), activity AS (
          INSERT INTO lifecycle_events (
            id, clerk_user_id, lifecycle_run_id, sequence, stage,
            activity_type, state_from, state_to, input_entity_ids,
            output_entity_ids, responsible_agent_ids,
            configuration_digest, status, event_version
          )
          SELECT
            gen_random_uuid(), $1::text, updated.lifecycle_run_id,
            coalesce((SELECT max(sequence) + 1 FROM lifecycle_events WHERE lifecycle_run_id = updated.lifecycle_run_id), 1),
            updated.stage, 'research_search_completed', $3::text, $3::text,
            jsonb_build_array(updated.id::text),
            jsonb_build_array(updated.id::text) ||
              coalesce((SELECT jsonb_agg(id::text) FROM inserted_sources), '[]'::jsonb),
            jsonb_build_array('research-broker', 'openclaw:codex'),
            $11::char(64), 'completed', target.event_version
          FROM updated CROSS JOIN target
        )
        SELECT id FROM updated
      `,
      values: [
        owner,
        requestId,
        state,
        model,
        JSON.stringify(input.executedQueries),
        synthesis,
        input.omittedSourceCount,
        JSON.stringify(input.injectionSignalsDetected),
        contentDigest,
        JSON.stringify(sources.map((source) => ({
          id: source.id,
          ordinal: source.ordinal,
          citation_id: source.citationId,
          title: source.title,
          url: source.url,
          hostname: source.hostname,
          trust: source.trust,
          discovered_from: source.discoveredFrom,
        }))),
        configurationDigest,
      ],
    })
    if (!resultId(result)) {
      const existing = await this.getById(owner, requestId)
      if (existing.status === 'completed') return existing
      throw new ResearchRepositoryError(
        'conflict',
        'The research request could not be completed from its current state.',
      )
    }
    return this.getById(owner, requestId)
  }

  async fail(input: FailResearchInput): Promise<ResearchRecord> {
    const owner = assertOwner(input.ownerId)
    const requestId = assertUuid(input.requestId, 'Research request id')
    const state = assertLifecycleState(input.lifecycleState)
    const failureCode = normalizeText(input.failureCode, 'Research failure code', 1, 80)
    const configurationDigest = assertDigest(input.configurationDigest)
    const result = await this.database.query({
      text: `
        WITH target AS (
          SELECT requests.id, requests.lifecycle_run_id, requests.stage,
                 runs.state, runs.event_version
          FROM research_requests AS requests
          INNER JOIN lifecycle_runs AS runs ON runs.id = requests.lifecycle_run_id
          WHERE requests.id = $2::uuid AND requests.clerk_user_id = $1::text
            AND requests.status = 'searching' AND runs.state = $3::text
          FOR UPDATE OF requests, runs
        ), updated AS (
          UPDATE research_requests AS requests
          SET status = $4::text, failure_code = $5::text,
              completed_at = now(), updated_at = now()
          FROM target
          WHERE requests.id = target.id
          RETURNING requests.id, requests.lifecycle_run_id, requests.stage
        ), activity AS (
          INSERT INTO lifecycle_events (
            id, clerk_user_id, lifecycle_run_id, sequence, stage,
            activity_type, state_from, state_to, input_entity_ids,
            output_entity_ids, responsible_agent_ids,
            configuration_digest, status, event_version
          )
          SELECT
            gen_random_uuid(), $1::text, updated.lifecycle_run_id,
            coalesce((SELECT max(sequence) + 1 FROM lifecycle_events WHERE lifecycle_run_id = updated.lifecycle_run_id), 1),
            updated.stage, 'research_search_' || $4::text, $3::text, $3::text,
            jsonb_build_array(updated.id::text), jsonb_build_array(updated.id::text),
            jsonb_build_array('research-broker', 'openclaw:codex'),
            $6::char(64), CASE WHEN $4::text = 'refused' THEN 'refused' ELSE 'failed' END,
            target.event_version
          FROM updated CROSS JOIN target
        )
        SELECT id FROM updated
      `,
      values: [owner, requestId, state, input.status, failureCode, configurationDigest],
    })
    if (!resultId(result)) {
      const existing = await this.getById(owner, requestId)
      if (existing.status !== 'searching') return existing
      throw new ResearchRepositoryError(
        'conflict',
        'The research request could not be failed from its current state.',
      )
    }
    return this.getById(owner, requestId)
  }
}
