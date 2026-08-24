import 'server-only'

import type { SqlAdapter, SqlRow, SqlStatement } from '../db/sql'
import { hashUserRateKey } from '../usage/identifiers'
import type { UsageController } from '../usage/types'

import { ApiError, isApiError, serviceUnavailable } from './errors'
import type { WebChessDataControlServices } from './ports'
import { usageError } from './usage-error'

const ACCOUNT_EXPORT_FORMAT = 'webchess-account-export/4'
const DEFAULT_ACCOUNT_EXPORT_MAX_BYTES = 3_000_000
const MAX_ACCOUNT_EXPORT_BYTES = 100_000_000
const ACCOUNT_EXPORT_GUARD_SETTING = 'webchess.account_export_allowed'

export type DataControlUsagePort = Pick<
  UsageController,
  'consumeAccountExportRate' | 'deleteAccountData' | 'getUsageSummary'
>

export interface DataControlServiceAdapterDependencies {
  readonly accountExportMaxBytes: number
  readonly database: SqlAdapter
  readonly hmacSecret: string
  readonly usage: DataControlUsagePort
}
export function normalizeAccountExportMaxBytes(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_ACCOUNT_EXPORT_MAX_BYTES
  }

  const parsed = Number(value)
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_ACCOUNT_EXPORT_BYTES
  ) {
    throw serviceUnavailable(
      `The WebChess account export size limit must be between 1 and ${MAX_ACCOUNT_EXPORT_BYTES} bytes.`,
    )
  }
  return parsed
}

async function dataControlOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isApiError(error)) throw error
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      'WebChess could not complete this request.',
      { cause: error },
    )
  }
}

function exportValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(exportValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, exportValue(item)]),
    )
  }
  return value
}

function rowsAt(
  results: readonly { readonly rows: readonly SqlRow[] }[],
  index: number,
): readonly Record<string, unknown>[] {
  return (results[index]?.rows ?? []).map(
    (row) => exportValue(row) as Record<string, unknown>,
  )
}

function accountExportEstimatedBytes(
  results: readonly { readonly rows: readonly SqlRow[] }[],
): bigint {
  const value = results[0]?.rows[0]?.estimatedBytes

  if (typeof value === 'bigint' && value >= 0n) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value)
  }
  if (typeof value === 'string' && /^\d+$/u.test(value)) {
    return BigInt(value)
  }

  throw new ApiError(
    'INTERNAL_ERROR',
    500,
    'The WebChess account export size could not be verified.',
  )
}
function accountExportStatements(
  ownerId: string,
  maxBytes: number,
  ownerRateKey: string,
): readonly SqlStatement[] {
  const exportGuard = `
    WITH export_gate AS MATERIALIZED (
      SELECT
        current_setting('${ACCOUNT_EXPORT_GUARD_SETTING}', true) = 'on'
          AS allowed
    )
  `

  return [
    {
      text: `
        WITH exported_row_sizes AS MATERIALIZED (
          SELECT
            greatest(
              pg_column_size(controls)::bigint,
              octet_length(to_jsonb(controls)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(controls)))::bigint
            ) + 128 AS bytes
          FROM user_controls AS controls
          WHERE controls.clerk_user_id = $1::text

          UNION ALL

          SELECT
            greatest(
              pg_column_size(owned_games)::bigint,
              octet_length(to_jsonb(owned_games)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(owned_games)))::bigint
            ) + 128
          FROM games AS owned_games
          WHERE owned_games.clerk_user_id = $1::text

          UNION ALL

          SELECT
            greatest(
              pg_column_size(events)::bigint,
              octet_length(to_jsonb(events)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(events)))::bigint
            ) + 128
          FROM game_events AS events
          JOIN games AS event_games ON event_games.id = events.game_id
          WHERE event_games.clerk_user_id = $1::text

          UNION ALL

          SELECT
            greatest(
              pg_column_size(requests)::bigint,
              octet_length(to_jsonb(requests)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(requests)))::bigint
            ) + 128
          FROM model_requests AS requests
          WHERE requests.clerk_user_id = $1::text

          UNION ALL

          SELECT
            greatest(
              pg_column_size(buckets)::bigint,
              octet_length(to_jsonb(buckets)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(buckets)))::bigint
            ) + 128
          FROM usage_buckets AS buckets
          WHERE buckets.subject_type = 'user'
            AND buckets.subject_key = $1::text

          UNION ALL

          SELECT
            greatest(
              pg_column_size(rate_windows)::bigint,
              octet_length(to_jsonb(rate_windows)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(rate_windows)))::bigint
            ) + 128
          FROM rate_buckets AS rate_windows
          WHERE rate_windows.key_type = 'user'
            AND rate_windows.key_hash = $3::char(64)

          UNION ALL

          SELECT
            greatest(
              pg_column_size(starts)::bigint,
              octet_length(to_jsonb(starts)::text)::bigint,
              octet_length(jsonb_pretty(to_jsonb(starts)))::bigint
            ) + 128
          FROM game_start_requests AS starts
          WHERE starts.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(runs)::bigint,
            octet_length(to_jsonb(runs)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(runs)))::bigint
          ) + 128
          FROM lifecycle_runs AS runs
          WHERE runs.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(reviews)::bigint,
            octet_length(to_jsonb(reviews)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(reviews)))::bigint
          ) + 128
          FROM portia_reviews AS reviews
          WHERE reviews.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(decisions)::bigint,
            octet_length(to_jsonb(decisions)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(decisions)))::bigint
          ) + 128
          FROM gate_decisions AS decisions
          WHERE decisions.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(results)::bigint,
            octet_length(to_jsonb(results)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(results)))::bigint
          ) + 128
          FROM charlotte_results AS results
          WHERE results.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(actions)::bigint,
            octet_length(to_jsonb(actions)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(actions)))::bigint
          ) + 128
          FROM wilbur_actions AS actions
          WHERE actions.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(observations)::bigint,
            octet_length(to_jsonb(observations)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(observations)))::bigint
          ) + 128
          FROM wilbur_observations AS observations
          WHERE observations.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(mutations)::bigint,
            octet_length(to_jsonb(mutations)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(mutations)))::bigint
          ) + 128
          FROM wilbur_mutation_requests AS mutations
          WHERE mutations.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(memory_links)::bigint,
            octet_length(to_jsonb(memory_links)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(memory_links)))::bigint
          ) + 128
          FROM web_memory_links AS memory_links
          WHERE memory_links.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(research)::bigint,
            octet_length(to_jsonb(research)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(research)))::bigint
          ) + 128
          FROM research_requests AS research
          WHERE research.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(sources)::bigint,
            octet_length(to_jsonb(sources)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(sources)))::bigint
          ) + 128
          FROM research_sources AS sources
          WHERE sources.clerk_user_id = $1::text

          UNION ALL

          SELECT greatest(
            pg_column_size(activities)::bigint,
            octet_length(to_jsonb(activities)::text)::bigint,
            octet_length(jsonb_pretty(to_jsonb(activities)))::bigint
          ) + 128
          FROM lifecycle_events AS activities
          WHERE activities.clerk_user_id = $1::text
        ),
        estimate AS MATERIALIZED (
          SELECT (4096 + coalesce(sum(bytes), 0))::bigint AS estimated_bytes
          FROM exported_row_sizes
        )
        SELECT
          estimate.estimated_bytes::text AS "estimatedBytes",
          set_config(
            '${ACCOUNT_EXPORT_GUARD_SETTING}',
            CASE
              WHEN estimate.estimated_bytes <= $2::bigint THEN 'on'
              ELSE 'off'
            END,
            true
          ) AS "exportAllowed"
        FROM estimate
      `,
      values: [ownerId, maxBytes, ownerRateKey],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          suspended,
          blocked_until AS "blockedUntil",
          reason_code AS "reasonCode",
          daily_game_limit AS "dailyGameLimit",
          daily_model_request_limit AS "dailyModelRequestLimit",
          hourly_model_request_limit AS "hourlyModelRequestLimit",
          concurrent_model_limit AS "concurrentModelLimit",
          created_at AS "createdAt",
          last_seen_at AS "lastSeenAt",
          updated_at AS "updatedAt"
        FROM user_controls
        CROSS JOIN export_gate
        WHERE export_gate.allowed
          AND clerk_user_id = $1::text
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          id::text,
          source_game_id::text AS "sourceGameId",
          is_current AS "isCurrent",
          revision::text,
          status,
          problem,
          problem_sha256 AS "problemSha256",
          research_consent_version AS "researchConsentVersion",
          research_consent_decision AS "researchConsentDecision",
          research_consent_recorded_at AS "researchConsentRecordedAt",
          division_seed AS "divisionSeed",
          division_facets AS "divisionFacets",
          problem_parts AS "problemParts",
          division_model AS "divisionModel",
          division_prompt_version AS "divisionPromptVersion",
          division_prompt_sha256 AS "divisionPromptSha256",
          division_digest AS "divisionDigest",
          rules_version AS "rulesVersion",
          engine_version AS "engineVersion",
          cast_version AS "castVersion",
          event_version AS "eventVersion",
          software_version AS "softwareVersion",
          outcome,
          answer_payload AS "answer",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          completed_at AS "completedAt",
          answered_at AS "answeredAt"
        FROM games
        CROSS JOIN export_gate
        WHERE export_gate.allowed
          AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          events.game_id::text AS "gameId",
          events.ply,
          events.kind,
          events.source,
          events.side,
          events.piece_id AS "pieceId",
          events.captured_piece_id AS "capturedPieceId",
          events.promoted_to AS "promotedTo",
          events.from_ring AS "fromRing",
          events.from_sector AS "fromSector",
          events.to_ring AS "toRing",
          events.to_sector AS "toSector",
          events.idempotency_key::text AS "idempotencyKey",
          events.request_sha256 AS "requestSha256",
          events.game_revision::text AS "gameRevision",
          events.created_at AS "createdAt"
        FROM game_events AS events
        JOIN games ON games.id = events.game_id
        CROSS JOIN export_gate
        WHERE export_gate.allowed
          AND games.clerk_user_id = $1::text
        ORDER BY events.game_id, events.ply
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          id::text,
          game_id::text AS "gameId",
          operation,
          idempotency_key::text AS "idempotencyKey",
          request_sha256 AS "requestSha256",
          status,
          attempt,
          provider,
          model,
          prompt_version AS "promptVersion",
          software_version AS "softwareVersion",
          provider_response_id AS "providerResponseId",
          response_sha256 AS "responseSha256",
          result_payload AS "resultPayload",
          usage_reported AS "usageReported",
          input_tokens::text AS "inputTokens",
          cached_input_tokens::text AS "cachedInputTokens",
          cache_write_input_tokens::text AS "cacheWriteInputTokens",
          output_tokens::text AS "outputTokens",
          reasoning_tokens::text AS "reasoningTokens",
          total_tokens::text AS "totalTokens",
          provider_started_at AS "providerStartedAt",
          completed_at AS "completedAt",
          failure_code AS "failureCode",
          provider_http_status AS "providerHttpStatus",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM model_requests
        CROSS JOIN export_gate
        WHERE export_gate.allowed
          AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          metric,
          bucket_start AS "bucketStart",
          bucket_seconds AS "bucketSeconds",
          used::text,
          reserved::text,
          updated_at AS "updatedAt"
        FROM usage_buckets
        CROSS JOIN export_gate
        WHERE export_gate.allowed
          AND subject_type = 'user'
          AND subject_key = $1::text
        ORDER BY bucket_start, metric
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          idempotency_key::text AS "idempotencyKey",
          kind,
          source_game_id::text AS "sourceGameId",
          expected_revision::text AS "expectedRevision",
          activated_at AS "activatedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM game_start_requests
        CROSS JOIN export_gate
        WHERE export_gate.allowed
          AND clerk_user_id = $1::text
        ORDER BY created_at, idempotency_key
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          id::text, game_id::text AS "gameId",
          root_run_id::text AS "rootRunId",
          parent_run_id::text AS "parentRunId",
          state, revision::text, field_generation AS "fieldGeneration",
          game_attempt AS "gameAttempt",
          same_field_retry_count AS "sameFieldRetryCount",
          field_regeneration_count AS "fieldRegenerationCount",
          division_seed AS "divisionSeed", cast_seed AS "castSeed",
          trajectory_seed AS "trajectorySeed", retry_reason AS "retryReason",
          terminal_fingerprint AS "terminalFingerprint",
          answer_prompt_digest AS "answerPromptDigest",
          survivor_set AS survivors,
          portia_current_candidate_id AS "portiaCurrentCandidateId",
          portia_active_model_request_id::text AS "portiaActiveModelRequestId",
          portia_failed_attempt_count AS "portiaFailedAttemptCount",
          portia_failure_limit AS "portiaFailureLimit",
          portia_completed_candidate_ids AS "portiaCompletedCandidateIds",
          portia_assessment_drafts AS "portiaAssessmentDrafts",
          charlotte_active_model_request_id::text AS "charlotteActiveModelRequestId",
          charlotte_failed_attempt_count AS "charlotteFailedAttemptCount",
          charlotte_failure_limit AS "charlotteFailureLimit",
          software_version AS "softwareVersion",
          lifecycle_version AS "lifecycleVersion",
          rules_version AS "rulesVersion", engine_version AS "engineVersion",
          cast_version AS "castVersion", event_version AS "eventVersion",
          portia_prompt_version AS "portiaPromptVersion",
          portia_contract_version AS "portiaContractVersion",
          gate_algorithm_version AS "gateAlgorithmVersion",
          retry_policy_version AS "retryPolicyVersion",
          charlotte_prompt_version AS "charlottePromptVersion",
          charlotte_contract_version AS "charlotteContractVersion",
          wilbur_record_version AS "wilburRecordVersion",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM lifecycle_runs CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, game_id::text AS "gameId",
          lifecycle_run_id::text AS "lifecycleRunId", stage,
          requested_by AS "requestedBy", policy_version AS "policyVersion",
          research_consent_version AS "researchConsentVersion",
          research_consent_decision AS "researchConsentDecision",
          research_consent_recorded_at AS "researchConsentRecordedAt",
          materiality, reason, query, status, provider, transport, model,
          invocation_limit AS "invocationLimit",
          result_limit AS "resultLimit", source_limit AS "sourceLimit",
          timeout_ms AS "timeoutMs",
          synthesis_character_limit AS "synthesisCharacterLimit",
          attempt_count AS "attemptCount",
          executed_queries AS "executedQueries",
          search_synthesis AS "searchSynthesis",
          direct_page_text_fetched AS "directPageTextFetched",
          retrieved_facts AS "retrievedFacts",
          fetch_failures AS "fetchFailures",
          omitted_source_count AS "omittedSourceCount",
          injection_signals AS "injectionSignals",
          content_digest AS "contentDigest", failure_code AS "failureCode",
          started_at AS "startedAt", completed_at AS "completedAt",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM research_requests CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, research_request_id::text AS "researchRequestId",
          ordinal, citation_id AS "citationId", title, url, hostname, trust,
          discovered_from AS "discoveredFrom", created_at AS "createdAt"
        FROM research_sources CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY research_request_id, ordinal
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, lifecycle_run_id::text AS "lifecycleRunId",
          model_request_id::text AS "modelRequestId",
          input_digest AS "inputDigest", output_digest AS "outputDigest",
          prompt_version AS "promptVersion",
          contract_version AS "contractVersion", review,
          created_at AS "createdAt"
        FROM portia_reviews CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, lifecycle_run_id::text AS "lifecycleRunId",
          algorithm_version AS "algorithmVersion",
          input_digest AS "inputDigest", passed, result,
          answer_user_prompt AS "answerUserPrompt",
          answer_user_prompt_sha256 AS "answerUserPromptSha256",
          created_at AS "createdAt"
        FROM gate_decisions CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, lifecycle_run_id::text AS "lifecycleRunId",
          model_request_id::text AS "modelRequestId",
          input_digest AS "inputDigest", output_digest AS "outputDigest",
          prompt_version AS "promptVersion",
          contract_version AS "contractVersion", result,
          rendered_answer AS "renderedAnswer", created_at AS "createdAt"
        FROM charlotte_results CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, lifecycle_run_id::text AS "lifecycleRunId",
          charlotte_action_index AS "charlotteActionIndex",
          charlotte_binding_version AS "charlotteBindingVersion",
          idempotency_key::text AS "idempotencyKey",
          request_digest AS "requestDigest", actor, action,
          tested_assumption AS "testedAssumption",
          expected_observation AS "expectedObservation",
          decision_threshold AS "decisionThreshold",
          review_horizon AS "reviewHorizon",
          follow_up_at AS "followUpAt", status, revision::text,
          record_version AS "recordVersion",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM wilbur_actions CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, target_game_id::text AS "targetGameId",
          source_observation_id::text AS "sourceObservationId",
          selection_ordinal AS "selectionOrdinal",
          consent_version AS "consentVersion",
          created_at AS "createdAt"
        FROM web_memory_links CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, action_id::text AS "actionId",
          idempotency_key::text AS "idempotencyKey",
          request_digest AS "requestDigest", observed_at AS "observedAt",
          observation, evidence_classification AS "evidenceClassification",
          expected_effect AS "expectedEffect",
          unexpected_effect AS "unexpectedEffect",
          stakeholder_response AS "stakeholderResponse",
          assumption_result AS "assumptionResult",
          next_decision AS "nextDecision", record_version AS "recordVersion",
          created_at AS "createdAt"
        FROM wilbur_observations CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY observed_at, created_at, id
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          idempotency_key::text AS "idempotencyKey",
          operation,
          request_digest AS "requestDigest",
          target_game_id::text AS "targetGameId",
          target_action_id::text AS "targetActionId",
          rate_kind AS "rateKind",
          rate_admitted_at AS "rateAdmittedAt",
          denial_code AS "denialCode",
          retry_at AS "retryAt",
          status,
          result_entity_id::text AS "resultEntityId",
          result_revision::text AS "resultRevision",
          result_status AS "resultStatus",
          result_follow_up_at AS "resultFollowUpAt",
          result_updated_at AS "resultUpdatedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM wilbur_mutation_requests CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY created_at, idempotency_key
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT id::text, lifecycle_run_id::text AS "lifecycleRunId",
          sequence::text, stage, activity_type AS "activityType",
          state_from AS "stateFrom", state_to AS "stateTo",
          input_entity_ids AS "inputEntityIds",
          output_entity_ids AS "outputEntityIds",
          responsible_agent_ids AS "responsibleAgentIds",
          configuration_digest AS "configurationDigest", status,
          event_version AS "eventVersion", created_at AS "createdAt"
        FROM lifecycle_events CROSS JOIN export_gate
        WHERE export_gate.allowed AND clerk_user_id = $1::text
        ORDER BY lifecycle_run_id, sequence
      `,
      values: [ownerId],
    },
    {
      text: `
        ${exportGuard}
        SELECT
          action,
          window_start AS "windowStart",
          window_seconds AS "windowSeconds",
          count,
          expires_at AS "expiresAt"
        FROM rate_buckets
        CROSS JOIN export_gate
        WHERE export_gate.allowed
          AND key_type = 'user'
          AND key_hash = $1::char(64)
        ORDER BY window_start, action
      `,
      values: [ownerRateKey],
    },
  ]
}

export function createDataControlServicesWithDependencies(
  dependencies: DataControlServiceAdapterDependencies,
): WebChessDataControlServices {
  return {
    getAccountUsage(input) {
      return dataControlOperation(async () => {
        const summary = await dependencies.usage.getUsageSummary(input.ownerId)
        if ('ok' in summary) throw usageError(summary)
        return summary
      })
    },

    exportAccount(input) {
      return dataControlOperation(async () => {
        const allowed = await dependencies.usage.consumeAccountExportRate({
          userId: input.ownerId,
          ipAddress: input.ipAddress,
        })
        if (!allowed.ok) throw usageError(allowed)

        const results = await dependencies.database.transaction(
          accountExportStatements(
            input.ownerId,
            dependencies.accountExportMaxBytes,
            hashUserRateKey(dependencies.hmacSecret, input.ownerId),
          ),
          {
            isolationLevel: 'RepeatableRead',
            readOnly: true,
          },
        )
        const estimatedBytes = accountExportEstimatedBytes(results)
        if (estimatedBytes > BigInt(dependencies.accountExportMaxBytes)) {
          throw new ApiError(
            'PAYLOAD_TOO_LARGE',
            413,
            'This WebChess account export is too large to download.',
          )
        }

        const exported = {
          format: ACCOUNT_EXPORT_FORMAT,
          exportedAt: new Date().toISOString(),
          controls: rowsAt(results, 1)[0] ?? null,
          games: rowsAt(results, 2),
          events: rowsAt(results, 3),
          modelRequests: rowsAt(results, 4),
          usageBuckets: rowsAt(results, 5),
          gameStartRequests: rowsAt(results, 6),
          lifecycleRuns: rowsAt(results, 7),
          researchRequests: rowsAt(results, 8),
          researchSources: rowsAt(results, 9),
          portiaReviews: rowsAt(results, 10),
          gateDecisions: rowsAt(results, 11),
          charlotteResults: rowsAt(results, 12),
          wilburActions: rowsAt(results, 13),
          webMemoryLinks: rowsAt(results, 14),
          wilburObservations: rowsAt(results, 15),
          wilburMutationRequests: rowsAt(results, 16),
          lifecycleActivities: rowsAt(results, 17),
          userRateBuckets: rowsAt(results, 18),
        }
        if (
          new TextEncoder().encode(`${JSON.stringify(exported, null, 2)}\n`)
            .byteLength > dependencies.accountExportMaxBytes
        ) {
          throw new ApiError(
            'PAYLOAD_TOO_LARGE',
            413,
            'This WebChess account export is too large to download.',
          )
        }
        return exported
      })
    },

    deleteAccountData(input) {
      return dataControlOperation(async () => {
        const result = await dependencies.usage.deleteAccountData(input.ownerId)
        if (!result.ok) {
          throw new ApiError(
            'CONFLICT',
            409,
            'Wait for the active model request to finish before deleting WebChess data.',
            { retryAfterSeconds: result.retryAfterSeconds },
          )
        }
      })
    },

    handleClerkUserDeleted(input) {
      return dataControlOperation(async () => {
        const result = await dependencies.usage.deleteAccountData(
          input.clerkUserId,
          { force: true },
        )
        if (!result.ok) {
          throw new ApiError(
            'INTERNAL_ERROR',
            500,
            'WebChess could not complete the verified account deletion.',
          )
        }
      })
    },
  }
}
