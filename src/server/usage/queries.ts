import type { SqlStatement } from '../db/sql'
import type {
  AttachModelRequestGameInput,
  BeginProviderCallInput,
  ConsumeAccountExportRateInput,
  ConsumeGameMoveRateInput,
  ConsumeReplayGameStartInput,
  ConsumeWilburMutationRateInput,
  GetModelRequestByIdempotencyKeyInput,
  GetModelRequestResultInput,
  GetLatestModelRequestForGameInput,
  ReleaseReservationInput,
  ReserveModelRequestInput,
  SettleModelRequestInput,
  UsageConfig,
} from './types'

interface ReserveQueryContext {
  readonly now: Date
  readonly leaseToken: string
  readonly userRateKey: string
  readonly ipRateKey: string
  readonly deletedUserKey: string
}

interface BeginQueryContext {
  readonly now: Date
  readonly leaseExpiresAt: Date
  readonly deletedUserKey: string
}

interface SettlementQueryContext {
  readonly now: Date
}

const RESERVATION_LOCK =
  "pg_advisory_xact_lock(hashtextextended('webchess-usage-reservation-v1', 0))"

export const acquireUsageLockSql = `
SELECT ${RESERVATION_LOCK} AS held
`

export function buildAcquireUsageLockStatement(): SqlStatement {
  return { text: acquireUsageLockSql }
}

/**
 * Reconciles the four durable leases before a reservation attempt.
 *
 * The caller first acquires the transaction advisory lock, then executes this,
 * bucket setup, and reserveModelRequestSql in one READ COMMITTED Neon batch.
 * Each post-lock statement receives a fresh snapshot. That makes cleared slots
 * and newly inserted buckets visible without an interactive transaction or
 * SERIALIZABLE retry loop.
 */
export const cleanupExpiredLeasesSql = `
WITH
lock_gate AS MATERIALIZED (
  SELECT ${RESERVATION_LOCK} AS held
),
expired AS MATERIALIZED (
  SELECT
    slots.slot,
    slots.request_id,
    slots.lease_token,
    requests.clerk_user_id,
    requests.operation,
    requests.status,
    requests.created_at
  FROM model_concurrency_slots AS slots
  JOIN model_requests AS requests ON requests.id = slots.request_id
  CROSS JOIN lock_gate
  WHERE
    slots.request_id IS NOT NULL
    AND slots.lease_expires_at <= $1::timestamptz
    AND requests.status IN ('reserved', 'in_progress')
  FOR UPDATE OF slots, requests
),
expired_counts AS MATERIALIZED (
  SELECT
    clerk_user_id,
    operation,
    date_trunc('day', created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      AS bucket_start,
    count(*) FILTER (WHERE status = 'reserved')::bigint AS reserved_count,
    count(*) FILTER (WHERE status = 'in_progress')::bigint AS started_count
  FROM expired
  GROUP BY clerk_user_id, operation, bucket_start
),
refund_model AS (
  UPDATE usage_buckets AS buckets
  SET
    reserved = greatest(
      buckets.reserved - counts.reserved_count,
      0
    ),
    updated_at = $1::timestamptz
  FROM (
    SELECT clerk_user_id, bucket_start, sum(reserved_count) AS reserved_count
    FROM expired_counts
    GROUP BY clerk_user_id, bucket_start
  ) AS counts
  WHERE
    buckets.subject_type = 'user'
    AND buckets.subject_key = counts.clerk_user_id
    AND buckets.metric = 'model_requests'
    AND buckets.bucket_start = counts.bucket_start
    AND buckets.bucket_seconds = 86400
  RETURNING buckets.subject_key
),
refund_global_model AS (
  UPDATE usage_buckets AS buckets
  SET
    reserved = greatest(
      buckets.reserved - counts.reserved_count,
      0
    ),
    updated_at = $1::timestamptz
  FROM (
    SELECT bucket_start, sum(reserved_count) AS reserved_count
    FROM expired_counts
    GROUP BY bucket_start
  ) AS counts
  WHERE
    buckets.subject_type = 'global'
    AND buckets.subject_key = 'deployment'
    AND buckets.metric = 'model_requests'
    AND buckets.bucket_start = counts.bucket_start
    AND buckets.bucket_seconds = 86400
  RETURNING buckets.subject_key
),
finalize_games AS (
  UPDATE usage_buckets AS buckets
  SET
    used = buckets.used + counts.started_count,
    reserved = greatest(
      buckets.reserved - counts.reserved_count - counts.started_count,
      0
    ),
    updated_at = $1::timestamptz
  FROM expired_counts AS counts
  WHERE
    counts.operation = 'division'
    AND buckets.subject_type = 'user'
    AND buckets.subject_key = counts.clerk_user_id
    AND buckets.metric = 'game_starts'
    AND buckets.bucket_start = counts.bucket_start
    AND buckets.bucket_seconds = 86400
  RETURNING buckets.subject_key
),
expire_requests AS (
  UPDATE model_requests AS requests
  SET
    status = CASE
      WHEN requests.status = 'reserved' THEN 'failed'
      ELSE 'indeterminate'
    END,
    failure_code = CASE
      WHEN requests.status = 'reserved'
        THEN 'lease_expired_before_provider'
      ELSE 'provider_outcome_unknown'
    END,
    completed_at = $1::timestamptz,
    updated_at = $1::timestamptz
  FROM expired
  WHERE requests.id = expired.request_id
  RETURNING requests.id
),
clear_slots AS (
  UPDATE model_concurrency_slots AS slots
  SET
    request_id = NULL,
    clerk_user_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL
  FROM expired
  WHERE
    slots.slot = expired.slot
    AND slots.lease_token = expired.lease_token
  RETURNING slots.slot
)
SELECT
  (SELECT count(*) FROM refund_model) AS model_refunds,
  (SELECT count(*) FROM refund_global_model) AS global_model_refunds,
  (SELECT count(*) FROM finalize_games) AS game_finalizations,
  (SELECT count(*) FROM expire_requests) AS expired_requests,
  (SELECT count(*) FROM clear_slots) AS cleared_slots
`

export function buildCleanupExpiredLeasesStatement(now: Date): SqlStatement {
  return {
    text: cleanupExpiredLeasesSql,
    values: [now.toISOString()],
  }
}

export const cleanupExpiredRateBucketsSql = `
DELETE FROM rate_buckets
WHERE ctid IN (
  SELECT ctid
  FROM rate_buckets
  WHERE expires_at <= $1::timestamptz
  ORDER BY expires_at
  LIMIT 500
)
`

export function buildCleanupExpiredRateBucketsStatement(
  now: Date,
): SqlStatement {
  return {
    text: cleanupExpiredRateBucketsSql,
    values: [now.toISOString()],
  }
}

export const ensureUsageBucketsSql = `
WITH
lock_gate AS MATERIALIZED (
  SELECT ${RESERVATION_LOCK} AS held
),
deletion_barrier AS MATERIALIZED (
  SELECT tombstones.user_key_hash
  FROM deleted_user_tombstones AS tombstones
  CROSS JOIN lock_gate
  WHERE tombstones.user_key_hash = $4::text
)
INSERT INTO usage_buckets (
  subject_type,
  subject_key,
  metric,
  bucket_start,
  bucket_seconds,
  used,
  reserved,
  updated_at
)
SELECT
  source.subject_type,
  source.subject_key,
  source.metric,
  $2::timestamptz,
  86400,
  0,
  0,
  $3::timestamptz
FROM (
  VALUES
    ('user'::text, $1::text, 'model_requests'::text),
    ('user'::text, $1::text, 'game_starts'::text),
    ('global'::text, 'deployment'::text, 'model_requests'::text)
) AS source(subject_type, subject_key, metric)
CROSS JOIN lock_gate
WHERE
  source.subject_type = 'global'
  OR (
    NOT EXISTS (SELECT 1 FROM deletion_barrier)
    AND NOT EXISTS (
      SELECT 1
      FROM user_controls AS controls
      WHERE
        controls.clerk_user_id = $1::text
        AND controls.suspended
    )
  )
ON CONFLICT (
  subject_type,
  subject_key,
  metric,
  bucket_start,
  bucket_seconds
) DO NOTHING
`

export function buildEnsureUsageBucketsStatement(
  userId: string,
  dayStart: Date,
  now: Date,
  deletedUserKey: string,
): SqlStatement {
  return {
    text: ensureUsageBucketsSql,
    values: [
      userId,
      dayStart.toISOString(),
      now.toISOString(),
      deletedUserKey,
    ],
  }
}

export const consumeReplayGameStartSql = `
WITH
lock_gate AS MATERIALIZED (
  SELECT ${RESERVATION_LOCK} AS held
),
deletion_barrier AS MATERIALIZED (
  SELECT tombstones.user_key_hash
  FROM deleted_user_tombstones AS tombstones
  CROSS JOIN lock_gate
  WHERE tombstones.user_key_hash = $13::text
),
control AS MATERIALIZED (
  SELECT
    coalesce(controls.suspended, false) AS suspended,
    controls.blocked_until,
    controls.daily_game_limit,
    EXISTS (SELECT 1 FROM deletion_barrier) AS deleted
  FROM lock_gate
  LEFT JOIN user_controls AS controls
    ON controls.clerk_user_id = $1::text
),
existing AS MATERIALIZED (
  SELECT
    requests.clerk_user_id,
    requests.kind,
    requests.source_game_id,
    requests.expected_revision
  FROM game_start_requests AS requests
  WHERE requests.idempotency_key = $4::uuid
),
target_game AS MATERIALIZED (
  SELECT
    games.id,
    games.clerk_user_id,
    games.source_game_id
  FROM games
  WHERE games.id = $4::uuid
  FOR UPDATE
),
source_game AS MATERIALIZED (
  SELECT
    games.id,
    games.clerk_user_id,
    games.revision,
    games.status,
    games.problem,
    games.problem_sha256,
    games.research_consent_version,
    games.research_consent_decision,
    games.research_consent_recorded_at,
    games.division_seed,
    games.division_facets,
    games.problem_parts,
    games.division_model,
    games.division_prompt_version,
    games.division_prompt_sha256,
    games.division_digest,
    games.event_version,
    games.rules_version,
    games.engine_version,
    games.cast_version,
    games.software_version
  FROM games
  WHERE games.id = $2::uuid
  FOR UPDATE
),
rate_state AS MATERIALIZED (
  SELECT
    coalesce(
      max(count) FILTER (
        WHERE key_type = 'user' AND key_hash = $8::text
      ),
      0
    )::integer AS user_count,
    coalesce(
      max(count) FILTER (
        WHERE key_type = 'ip' AND key_hash = $9::text
      ),
      0
    )::integer AS ip_count
  FROM rate_buckets
  WHERE
    action = 'game_start'
    AND window_start = $7::timestamptz
    AND window_seconds = 3600
    AND (
      (key_type = 'user' AND key_hash = $8::text)
      OR (key_type = 'ip' AND key_hash = $9::text)
    )
),
game_bucket_row AS MATERIALIZED (
  SELECT
    used,
    reserved
  FROM usage_buckets
  WHERE
    subject_type = 'user'
    AND subject_key = $1::text
    AND metric = 'game_starts'
    AND bucket_start = $6::timestamptz
    AND bucket_seconds = 86400
  FOR UPDATE
),
game_bucket_state AS MATERIALIZED (
  SELECT
    coalesce((SELECT used FROM game_bucket_row), 0)::bigint AS used,
    coalesce((SELECT reserved FROM game_bucket_row), 0)::bigint AS reserved
),
decision AS MATERIALIZED (
  SELECT
    CASE
      WHEN control.deleted THEN 'ACCOUNT_DELETED'
      WHEN control.suspended THEN 'ACCOUNT_SUSPENDED'
      WHEN
        control.blocked_until IS NOT NULL
        AND control.blocked_until > $5::timestamptz
        THEN 'ACCOUNT_TEMPORARILY_BLOCKED'
      WHEN EXISTS (
        SELECT 1
        FROM existing
        WHERE
          clerk_user_id <> $1::text
          OR kind <> 'replay'
          OR source_game_id <> $2::uuid
          OR expected_revision <> $3::bigint
      ) THEN 'IDEMPOTENCY_CONFLICT'
      WHEN
        EXISTS (SELECT 1 FROM existing)
        AND NOT EXISTS (
          SELECT 1
          FROM target_game
          WHERE
            clerk_user_id = $1::text
            AND source_game_id = $2::uuid
        )
        THEN 'IDEMPOTENCY_CONFLICT'
      WHEN EXISTS (SELECT 1 FROM existing) THEN 'EXISTING'
      WHEN EXISTS (SELECT 1 FROM target_game)
        THEN 'IDEMPOTENCY_CONFLICT'
      WHEN NOT EXISTS (
        SELECT 1
        FROM source_game
        WHERE clerk_user_id = $1::text
      )
        THEN 'GAME_OWNERSHIP_CONFLICT'
      WHEN (SELECT revision FROM source_game) <> $3::bigint
        THEN 'GAME_REVISION_CONFLICT'
      WHEN (SELECT status FROM source_game)
        NOT IN ('completed', 'answer_failed', 'answered')
        THEN 'GAME_INVALID_REPLAY_STATE'
      WHEN (SELECT user_count + 1 FROM rate_state) > $11::integer
        THEN 'GAME_START_HOURLY_RATE_LIMITED'
      WHEN (SELECT ip_count + 1 FROM rate_state) > $12::integer
        THEN 'IP_GAME_START_HOURLY_RATE_LIMITED'
      WHEN (
        SELECT used + reserved FROM game_bucket_state
      ) >= coalesce(control.daily_game_limit, $10::integer)
        THEN 'GAME_START_DAILY_QUOTA_EXCEEDED'
      ELSE 'ALLOW'
    END AS code,
    CASE
      WHEN control.deleted OR control.suspended THEN NULL
      WHEN
        control.blocked_until IS NOT NULL
        AND control.blocked_until > $5::timestamptz
        THEN control.blocked_until
      WHEN (SELECT user_count + 1 FROM rate_state) > $11::integer
        THEN $7::timestamptz + interval '1 hour'
      WHEN (SELECT ip_count + 1 FROM rate_state) > $12::integer
        THEN $7::timestamptz + interval '1 hour'
      WHEN (
        SELECT used + reserved FROM game_bucket_state
      ) >= coalesce(control.daily_game_limit, $10::integer)
        THEN $6::timestamptz + interval '1 day'
      ELSE NULL
    END AS retry_at
  FROM control
),
inserted_child AS (
  INSERT INTO games (
    id,
    clerk_user_id,
    source_game_id,
    is_current,
    revision,
    status,
    problem,
    problem_sha256,
    research_consent_version,
    research_consent_decision,
    research_consent_recorded_at,
    division_seed,
    division_facets,
    problem_parts,
    division_model,
    division_prompt_version,
    division_prompt_sha256,
    division_digest,
    event_version,
    rules_version,
    engine_version,
    cast_version,
    software_version,
    created_at,
    updated_at
  )
  SELECT
    $4::uuid,
    source_game.clerk_user_id,
    source_game.id,
    false,
    0,
    'mapped',
    source_game.problem,
    source_game.problem_sha256,
    source_game.research_consent_version,
    source_game.research_consent_decision,
    source_game.research_consent_recorded_at,
    source_game.division_seed,
    source_game.division_facets,
    source_game.problem_parts,
    source_game.division_model,
    source_game.division_prompt_version,
    source_game.division_prompt_sha256,
    source_game.division_digest,
    source_game.event_version,
    source_game.rules_version,
    source_game.engine_version,
    source_game.cast_version,
    source_game.software_version,
    $5::timestamptz,
    $5::timestamptz
  FROM source_game, decision
  WHERE decision.code = 'ALLOW'
  ON CONFLICT (id) DO NOTHING
  RETURNING id
),
inserted_request AS (
  INSERT INTO game_start_requests (
    idempotency_key,
    clerk_user_id,
    kind,
    source_game_id,
    expected_revision,
    created_at,
    updated_at
  )
  SELECT
    $4::uuid,
    $1::text,
    'replay',
    $2::uuid,
    $3::bigint,
    $5::timestamptz,
    $5::timestamptz
  FROM inserted_child
  RETURNING idempotency_key
),
user_rate AS MATERIALIZED (
  INSERT INTO rate_buckets (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds,
    count,
    expires_at
  )
  SELECT
    'user',
    $8::text,
    'game_start',
    $7::timestamptz,
    3600,
    1,
    $7::timestamptz + interval '2 hours'
  FROM inserted_request
  ON CONFLICT (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds
  ) DO UPDATE
  SET
    count = rate_buckets.count + 1,
    expires_at = excluded.expires_at
  RETURNING count
),
ip_rate AS MATERIALIZED (
  INSERT INTO rate_buckets (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds,
    count,
    expires_at
  )
  SELECT
    'ip',
    $9::text,
    'game_start',
    $7::timestamptz,
    3600,
    1,
    $7::timestamptz + interval '2 hours'
  FROM user_rate
  ON CONFLICT (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds
  ) DO UPDATE
  SET
    count = rate_buckets.count + 1,
    expires_at = excluded.expires_at
  RETURNING count
),
consume_game_start AS (
  INSERT INTO usage_buckets (
    subject_type,
    subject_key,
    metric,
    bucket_start,
    bucket_seconds,
    used,
    reserved,
    updated_at
  )
  SELECT
    'user',
    $1::text,
    'game_starts',
    $6::timestamptz,
    86400,
    1,
    0,
    $5::timestamptz
  FROM ip_rate
  ON CONFLICT (
    subject_type,
    subject_key,
    metric,
    bucket_start,
    bucket_seconds
  ) DO UPDATE
  SET
    used = usage_buckets.used + 1,
    updated_at = excluded.updated_at
  RETURNING subject_key
),
retire_current_games AS (
  UPDATE games
  SET
    is_current = false,
    updated_at = $5::timestamptz
  FROM consume_game_start
  WHERE
    games.clerk_user_id = $1::text
    AND games.is_current
    AND games.id <> $4::uuid
  RETURNING games.id
),
retirement_gate AS MATERIALIZED (
  SELECT count(*) AS retired
  FROM retire_current_games
),
mutation_gate AS MATERIALIZED (
  SELECT
    (SELECT count(*) FROM inserted_child) AS child_inserted,
    (SELECT count(*) FROM inserted_request) AS inserted,
    (SELECT count(*) FROM user_rate) AS user_rates,
    (SELECT count(*) FROM ip_rate) AS ip_rates,
    (SELECT count(*) FROM consume_game_start) AS consumed,
    (SELECT retired FROM retirement_gate) AS retired
)
SELECT
  CASE
    WHEN
      decision.code = 'ALLOW'
      AND NOT EXISTS (SELECT 1 FROM inserted_child)
      THEN 'IDEMPOTENCY_CONFLICT'
    ELSE decision.code
  END AS code,
  decision.retry_at,
  CASE
    WHEN decision.code = 'EXISTING'
      THEN (SELECT id::text FROM target_game)
    WHEN decision.code = 'ALLOW'
      THEN (SELECT id::text FROM inserted_child)
    ELSE NULL
  END AS game_id
FROM decision
CROSS JOIN mutation_gate
`

export function buildConsumeReplayGameStartStatement(
  input: ConsumeReplayGameStartInput,
  config: UsageConfig,
  context: {
    readonly now: Date
    readonly userRateKey: string
    readonly ipRateKey: string
    readonly deletedUserKey: string
  },
): SqlStatement {
  const dayStart = new Date(context.now)
  dayStart.setUTCHours(0, 0, 0, 0)
  const hourStart = new Date(context.now)
  hourStart.setUTCMinutes(0, 0, 0)

  return {
    text: consumeReplayGameStartSql,
    values: [
      input.userId,
      input.sourceGameId,
      input.expectedRevision,
      input.idempotencyKey,
      context.now.toISOString(),
      dayStart.toISOString(),
      hourStart.toISOString(),
      context.userRateKey,
      context.ipRateKey,
      config.dailyGameLimit,
      config.hourlyGameStartLimit,
      config.hourlyIpGameStartLimit,
      context.deletedUserKey,
    ],
  }
}

export const activateReplayGameSql = `
WITH
account_eligible AS MATERIALIZED (
  SELECT controls.clerk_user_id
  FROM user_controls AS controls
  WHERE
    controls.clerk_user_id = $2::text
    AND NOT controls.suspended
    AND (
      controls.blocked_until IS NULL
      OR controls.blocked_until <= $5::timestamptz
    )
    AND NOT EXISTS (
      SELECT 1
      FROM deleted_user_tombstones AS tombstones
      WHERE tombstones.user_key_hash = $6::text
    )
),
pending AS MATERIALIZED (
  SELECT games.id
  FROM game_start_requests AS requests
  JOIN games
    ON games.id = requests.idempotency_key
    AND games.clerk_user_id = requests.clerk_user_id
    AND games.source_game_id = requests.source_game_id
  JOIN account_eligible
    ON account_eligible.clerk_user_id = requests.clerk_user_id
  WHERE
    requests.idempotency_key = $1::uuid
    AND requests.clerk_user_id = $2::text
    AND requests.kind = 'replay'
    AND requests.source_game_id = $3::uuid
    AND requests.expected_revision = $4::bigint
    AND requests.activated_at IS NULL
  FOR UPDATE OF requests, games
),
retire_others AS (
  UPDATE games
  SET
    is_current = false,
    updated_at = $5::timestamptz
  FROM pending
  WHERE
    games.clerk_user_id = $2::text
    AND games.is_current
    AND games.id <> pending.id
  RETURNING games.id
),
retirement_gate AS MATERIALIZED (
  SELECT count(*) AS retired
  FROM retire_others
),
activate_target AS (
  UPDATE games
  SET
    is_current = true,
    updated_at = CASE
      WHEN games.is_current THEN games.updated_at
      ELSE $5::timestamptz
    END
  FROM pending, retirement_gate
  WHERE games.id = pending.id
  RETURNING games.id
),
mark_activated AS (
  UPDATE game_start_requests AS requests
  SET
    activated_at = $5::timestamptz,
    updated_at = $5::timestamptz
  FROM activate_target
  WHERE requests.idempotency_key = activate_target.id
  RETURNING requests.idempotency_key
),
mutation_counts AS MATERIALIZED (
  SELECT
    (SELECT count(*)::integer FROM pending) AS pending_count,
    (SELECT count(*)::integer FROM activate_target) AS activated_count,
    (SELECT count(*)::integer FROM mark_activated) AS marked_count
)
SELECT
  (SELECT idempotency_key::text FROM mark_activated) AS game_id,
  1 / CASE
    WHEN mutation_counts.pending_count = 0 THEN 1
    WHEN
      mutation_counts.pending_count = 1
      AND mutation_counts.activated_count = 1
      AND mutation_counts.marked_count = 1
      THEN 1
    ELSE 0
  END AS integrity_gate
FROM mutation_counts
`

export function buildActivateReplayGameStatement(
  input: ConsumeReplayGameStartInput,
  context: {
    readonly now: Date
    readonly deletedUserKey: string
  },
): SqlStatement {
  return {
    text: activateReplayGameSql,
    values: [
      input.idempotencyKey,
      input.userId,
      input.sourceGameId,
      input.expectedRevision,
      context.now.toISOString(),
      context.deletedUserKey,
    ],
  }
}

export const verifyReplayGameInvariantSql = `
WITH
matching AS MATERIALIZED (
  SELECT games.id, requests.activated_at
  FROM game_start_requests AS requests
  JOIN games
    ON games.id = requests.idempotency_key
    AND games.clerk_user_id = requests.clerk_user_id
    AND games.source_game_id = requests.source_game_id
  JOIN user_controls AS controls
    ON controls.clerk_user_id = requests.clerk_user_id
    AND NOT controls.suspended
    AND (
      controls.blocked_until IS NULL
      OR controls.blocked_until <= $5::timestamptz
    )
  WHERE
    requests.idempotency_key = $1::uuid
    AND requests.clerk_user_id = $2::text
    AND requests.kind = 'replay'
    AND requests.source_game_id = $3::uuid
    AND requests.expected_revision = $4::bigint
    AND NOT EXISTS (
      SELECT 1
      FROM deleted_user_tombstones AS tombstones
      WHERE tombstones.user_key_hash = $6::text
    )
)
SELECT
  1 / CASE
    WHEN NOT EXISTS (SELECT 1 FROM matching) THEN 1
    WHEN (SELECT activated_at FROM matching) IS NOT NULL
      THEN 1
    ELSE 0
  END AS integrity_gate
`

export function buildVerifyReplayGameInvariantStatement(
  input: ConsumeReplayGameStartInput,
  context: {
    readonly now: Date
    readonly deletedUserKey: string
  },
): SqlStatement {
  return {
    text: verifyReplayGameInvariantSql,
    values: [
      input.idempotencyKey,
      input.userId,
      input.sourceGameId,
      input.expectedRevision,
      context.now.toISOString(),
      context.deletedUserKey,
    ],
  }
}

export const reserveModelRequestSql = `
WITH
lock_gate AS MATERIALIZED (
  SELECT ${RESERVATION_LOCK} AS held
),
deletion_barrier AS MATERIALIZED (
  SELECT tombstones.user_key_hash
  FROM deleted_user_tombstones AS tombstones
  CROSS JOIN lock_gate
  WHERE tombstones.user_key_hash = $25::text
),
inserted_control AS MATERIALIZED (
  INSERT INTO user_controls (clerk_user_id, last_seen_at)
  SELECT $2::text, $13::timestamptz
  FROM lock_gate
  WHERE NOT EXISTS (SELECT 1 FROM deletion_barrier)
  ON CONFLICT (clerk_user_id) DO UPDATE
  SET last_seen_at = excluded.last_seen_at
  RETURNING
    clerk_user_id,
    suspended,
    blocked_until,
    reason_code,
    daily_game_limit,
    daily_model_request_limit,
    hourly_model_request_limit
),
control AS MATERIALIZED (
  SELECT
    inserted_control.clerk_user_id,
    inserted_control.suspended,
    inserted_control.blocked_until,
    inserted_control.reason_code,
    inserted_control.daily_game_limit,
    inserted_control.daily_model_request_limit,
    inserted_control.hourly_model_request_limit,
    false AS deleted
  FROM inserted_control
  UNION ALL
  SELECT
    $2::text,
    true,
    NULL::timestamptz,
    'ACCOUNT_DELETED'::text,
    NULL::integer,
    NULL::integer,
    NULL::integer,
    true
  FROM deletion_barrier
),
existing AS MATERIALIZED (
  SELECT
    requests.id,
    requests.game_id,
    requests.request_sha256,
    requests.status,
    slots.lease_token,
    slots.lease_expires_at
  FROM model_requests AS requests
  LEFT JOIN model_concurrency_slots AS slots
    ON slots.request_id = requests.id
  CROSS JOIN control
  WHERE
    requests.clerk_user_id = $2::text
    AND requests.operation = $4::text
    AND (
      requests.idempotency_key = $5::uuid
      OR (
        $3::uuid IS NOT NULL
        AND requests.game_id = $3::uuid
        AND requests.status = 'succeeded'
      )
    )
  ORDER BY
    (requests.idempotency_key = $5::uuid) DESC,
    requests.created_at DESC
  LIMIT 1
),
game_owner AS MATERIALIZED (
  SELECT games.clerk_user_id
  FROM games
  WHERE games.id = $3::uuid
),
user_rate AS MATERIALIZED (
  INSERT INTO rate_buckets (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds,
    count,
    expires_at
  )
  SELECT
    'user',
    $11::text,
    'model',
    $15::timestamptz,
    3600,
    1,
    $15::timestamptz + interval '2 hours'
  FROM control
  WHERE
    NOT control.suspended
    AND NOT EXISTS (SELECT 1 FROM existing)
  ON CONFLICT (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds
  ) DO UPDATE
  SET
    count = rate_buckets.count + 1,
    expires_at = excluded.expires_at
  RETURNING count
),
ip_rate AS MATERIALIZED (
  INSERT INTO rate_buckets (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds,
    count,
    expires_at
  )
  SELECT
    'ip',
    $12::text,
    'model',
    $15::timestamptz,
    3600,
    1,
    $15::timestamptz + interval '2 hours'
  FROM control
  WHERE
    NOT control.suspended
    AND NOT EXISTS (SELECT 1 FROM existing)
  ON CONFLICT (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds
  ) DO UPDATE
  SET
    count = rate_buckets.count + 1,
    expires_at = excluded.expires_at
  RETURNING count
),
game_start_user_rate AS MATERIALIZED (
  INSERT INTO rate_buckets (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds,
    count,
    expires_at
  )
  SELECT
    'user',
    $11::text,
    'game_start',
    $15::timestamptz,
    3600,
    1,
    $15::timestamptz + interval '2 hours'
  FROM control
  WHERE
    $21::boolean
    AND NOT control.suspended
    AND NOT EXISTS (SELECT 1 FROM existing)
  ON CONFLICT (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds
  ) DO UPDATE
  SET
    count = rate_buckets.count + 1,
    expires_at = excluded.expires_at
  RETURNING count
),
game_start_ip_rate AS MATERIALIZED (
  INSERT INTO rate_buckets (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds,
    count,
    expires_at
  )
  SELECT
    'ip',
    $12::text,
    'game_start',
    $15::timestamptz,
    3600,
    1,
    $15::timestamptz + interval '2 hours'
  FROM control
  WHERE
    $21::boolean
    AND NOT control.suspended
    AND NOT EXISTS (SELECT 1 FROM existing)
  ON CONFLICT (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds
  ) DO UPDATE
  SET
    count = rate_buckets.count + 1,
    expires_at = excluded.expires_at
  RETURNING count
),
model_bucket AS MATERIALIZED (
  SELECT used, reserved
  FROM usage_buckets
  WHERE
    subject_type = 'user'
    AND subject_key = $2::text
    AND metric = 'model_requests'
    AND bucket_start = $14::timestamptz
    AND bucket_seconds = 86400
  FOR UPDATE
),
global_model_bucket AS MATERIALIZED (
  SELECT used, reserved
  FROM usage_buckets
  WHERE
    subject_type = 'global'
    AND subject_key = 'deployment'
    AND metric = 'model_requests'
    AND bucket_start = $14::timestamptz
    AND bucket_seconds = 86400
  FOR UPDATE
),
game_bucket AS MATERIALIZED (
  SELECT used, reserved
  FROM usage_buckets
  WHERE
    subject_type = 'user'
    AND subject_key = $2::text
    AND metric = 'game_starts'
    AND bucket_start = $14::timestamptz
    AND bucket_seconds = 86400
  FOR UPDATE
),
active_user_slot AS MATERIALIZED (
  SELECT slots.lease_expires_at
  FROM model_concurrency_slots AS slots
  CROSS JOIN control
  WHERE
    slots.clerk_user_id = $2::text
    AND slots.request_id IS NOT NULL
    AND slots.lease_expires_at > $13::timestamptz
  LIMIT 1
),
free_slot AS MATERIALIZED (
  SELECT slots.slot
  FROM model_concurrency_slots AS slots
  CROSS JOIN control
  WHERE
    slots.enabled
    AND slots.slot <= $22::smallint
    AND slots.request_id IS NULL
  ORDER BY slots.slot
  LIMIT 1
),
decision AS MATERIALIZED (
  SELECT
    CASE
      WHEN control.deleted THEN 'ACCOUNT_DELETED'
      WHEN EXISTS (
        SELECT 1 FROM existing WHERE request_sha256 <> $6::text
      ) THEN 'IDEMPOTENCY_CONFLICT'
      WHEN EXISTS (SELECT 1 FROM existing) THEN 'EXISTING'
      WHEN
        $3::uuid IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM game_owner
          WHERE clerk_user_id = $2::text
        )
        THEN 'GAME_OWNERSHIP_CONFLICT'
      WHEN control.suspended THEN 'ACCOUNT_SUSPENDED'
      WHEN
        control.blocked_until IS NOT NULL
        AND control.blocked_until > $13::timestamptz
        THEN 'ACCOUNT_TEMPORARILY_BLOCKED'
      WHEN (SELECT count FROM user_rate) > coalesce(
        control.hourly_model_request_limit,
        $18::integer
      ) THEN 'MODEL_HOURLY_RATE_LIMITED'
      WHEN (SELECT count FROM ip_rate) > $19::integer
        THEN 'IP_HOURLY_RATE_LIMITED'
      WHEN
        $21::boolean
        AND (SELECT count FROM game_start_user_rate) > $26::integer
        THEN 'GAME_START_HOURLY_RATE_LIMITED'
      WHEN
        $21::boolean
        AND (SELECT count FROM game_start_ip_rate) > $27::integer
        THEN 'IP_GAME_START_HOURLY_RATE_LIMITED'
      WHEN (
        SELECT used + reserved FROM model_bucket
      ) >= coalesce(
        control.daily_model_request_limit,
        $17::integer
      ) THEN 'MODEL_DAILY_QUOTA_EXCEEDED'
      WHEN (
        SELECT used + reserved FROM global_model_bucket
      ) >= $24::integer THEN 'MODEL_GLOBAL_DAILY_CAPACITY'
      WHEN
        $21::boolean
        AND (
          SELECT used + reserved FROM game_bucket
        ) >= coalesce(control.daily_game_limit, $16::integer)
        THEN 'GAME_START_DAILY_QUOTA_EXCEEDED'
      WHEN EXISTS (SELECT 1 FROM active_user_slot)
        THEN 'MODEL_USER_CONCURRENCY_LIMIT'
      WHEN NOT EXISTS (SELECT 1 FROM free_slot)
        THEN 'MODEL_GLOBAL_CAPACITY'
      ELSE 'ALLOW'
    END AS code,
    CASE
      WHEN control.deleted OR control.suspended THEN NULL
      WHEN
        control.blocked_until IS NOT NULL
        AND control.blocked_until > $13::timestamptz
        THEN control.blocked_until
      WHEN (SELECT count FROM user_rate) > coalesce(
        control.hourly_model_request_limit,
        $18::integer
      ) THEN $15::timestamptz + interval '1 hour'
      WHEN (SELECT count FROM ip_rate) > $19::integer
        THEN $15::timestamptz + interval '1 hour'
      WHEN
        $21::boolean
        AND (SELECT count FROM game_start_user_rate) > $26::integer
        THEN $15::timestamptz + interval '1 hour'
      WHEN
        $21::boolean
        AND (SELECT count FROM game_start_ip_rate) > $27::integer
        THEN $15::timestamptz + interval '1 hour'
      WHEN (
        SELECT used + reserved FROM model_bucket
      ) >= coalesce(
        control.daily_model_request_limit,
        $17::integer
      ) THEN $14::timestamptz + interval '1 day'
      WHEN (
        SELECT used + reserved FROM global_model_bucket
      ) >= $24::integer
        THEN $14::timestamptz + interval '1 day'
      WHEN
        $21::boolean
        AND (
          SELECT used + reserved FROM game_bucket
        ) >= coalesce(control.daily_game_limit, $16::integer)
        THEN $14::timestamptz + interval '1 day'
      WHEN EXISTS (SELECT 1 FROM active_user_slot)
        THEN (SELECT lease_expires_at FROM active_user_slot)
      WHEN NOT EXISTS (SELECT 1 FROM free_slot)
        THEN coalesce(
          (
            SELECT min(lease_expires_at)
            FROM model_concurrency_slots
            WHERE request_id IS NOT NULL
          ),
          $13::timestamptz + interval '2 seconds'
        )
      ELSE NULL
    END AS retry_at
  FROM control
),
inserted_request AS (
  INSERT INTO model_requests (
    id,
    clerk_user_id,
    game_id,
    operation,
    idempotency_key,
    request_sha256,
    status,
    provider,
    model,
    prompt_version,
    software_version,
    created_at,
    updated_at
  )
  SELECT
    $1::uuid,
    $2::text,
    $3::uuid,
    $4::text,
    $5::uuid,
    $6::text,
    'reserved',
    $7::text,
    $8::text,
    $9::text,
    $10::text,
    $13::timestamptz,
    $13::timestamptz
  FROM decision
  WHERE code = 'ALLOW'
  RETURNING id, game_id, status
),
reserve_model_usage AS (
  UPDATE usage_buckets AS buckets
  SET
    reserved = buckets.reserved + 1,
    updated_at = $13::timestamptz
  FROM inserted_request
  WHERE
    buckets.subject_type = 'user'
    AND buckets.subject_key = $2::text
    AND buckets.metric = 'model_requests'
    AND buckets.bucket_start = $14::timestamptz
    AND buckets.bucket_seconds = 86400
  RETURNING buckets.subject_key
),
reserve_global_model_usage AS (
  UPDATE usage_buckets AS buckets
  SET
    reserved = buckets.reserved + 1,
    updated_at = $13::timestamptz
  FROM inserted_request
  WHERE
    buckets.subject_type = 'global'
    AND buckets.subject_key = 'deployment'
    AND buckets.metric = 'model_requests'
    AND buckets.bucket_start = $14::timestamptz
    AND buckets.bucket_seconds = 86400
  RETURNING buckets.subject_key
),
reserve_game_usage AS (
  UPDATE usage_buckets AS buckets
  SET
    reserved = buckets.reserved + 1,
    updated_at = $13::timestamptz
  FROM inserted_request
  WHERE
    $21::boolean
    AND buckets.subject_type = 'user'
    AND buckets.subject_key = $2::text
    AND buckets.metric = 'game_starts'
    AND buckets.bucket_start = $14::timestamptz
    AND buckets.bucket_seconds = 86400
  RETURNING buckets.subject_key
),
lease AS (
  UPDATE model_concurrency_slots AS slots
  SET
    request_id = inserted_request.id,
    clerk_user_id = $2::text,
    lease_token = $20::uuid,
    lease_expires_at = $13::timestamptz
      + make_interval(secs => $23::integer)
  FROM inserted_request, free_slot
  WHERE slots.slot = free_slot.slot
  RETURNING
    slots.slot,
    slots.lease_token,
    slots.lease_expires_at
),
mutation_gate AS MATERIALIZED (
  SELECT
    (SELECT count(*) FROM reserve_model_usage) AS model_reservations,
    (SELECT count(*) FROM reserve_global_model_usage) AS global_reservations,
    (SELECT count(*) FROM reserve_game_usage) AS game_reservations,
    (SELECT count(*) FROM lease) AS leases
)
SELECT
  decision.code,
  decision.retry_at,
  coalesce(inserted_request.id, existing.id)::text AS request_id,
  coalesce(inserted_request.game_id, existing.game_id)::text AS game_id,
  coalesce(inserted_request.status, existing.status) AS status,
  coalesce(lease.lease_token, existing.lease_token)::text AS lease_token,
  coalesce(
    lease.lease_expires_at,
    existing.lease_expires_at
  ) AS lease_expires_at
FROM decision
CROSS JOIN mutation_gate
LEFT JOIN inserted_request ON true
LEFT JOIN existing ON true
LEFT JOIN lease ON true
`

export function buildReserveModelRequestStatement(
  input: ReserveModelRequestInput,
  config: UsageConfig,
  context: ReserveQueryContext,
): SqlStatement {
  const dayStart = new Date(context.now)
  dayStart.setUTCHours(0, 0, 0, 0)
  const hourStart = new Date(context.now)
  hourStart.setUTCMinutes(0, 0, 0)

  return {
    text: reserveModelRequestSql,
    values: [
      input.requestId,
      input.userId,
      input.gameId ?? null,
      input.operation,
      input.idempotencyKey,
      input.requestSha256,
      input.provider,
      input.model,
      input.promptVersion,
      input.softwareVersion,
      context.userRateKey,
      context.ipRateKey,
      context.now.toISOString(),
      dayStart.toISOString(),
      hourStart.toISOString(),
      config.dailyGameLimit,
      config.dailyModelRequestLimit,
      config.hourlyModelRequestLimit,
      config.hourlyIpModelRequestLimit,
      context.leaseToken,
      input.countsAsGameStart,
      config.globalModelConcurrentLimit,
      config.modelLeaseSeconds,
      config.dailyGlobalModelRequestLimit,
      context.deletedUserKey,
      config.hourlyGameStartLimit,
      config.hourlyIpGameStartLimit,
    ],
  }
}

export const attachModelRequestGameSql = `
WITH
lock_gate AS MATERIALIZED (
  SELECT ${RESERVATION_LOCK} AS held
),
request_state AS MATERIALIZED (
  SELECT
    requests.id,
    requests.game_id,
    requests.operation,
    requests.status
  FROM model_requests AS requests
  CROSS JOIN lock_gate
  WHERE
    requests.id = $1::uuid
    AND requests.clerk_user_id = $2::text
  FOR UPDATE OF requests
),
owned_game AS MATERIALIZED (
  SELECT games.id
  FROM games
  WHERE
    games.id = $3::uuid
    AND games.clerk_user_id = $2::text
),
decision AS MATERIALIZED (
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM request_state)
      THEN 'REQUEST_NOT_FOUND'
    WHEN (SELECT operation FROM request_state) <> 'division'
      THEN 'INVALID_REQUEST_OPERATION'
    WHEN (SELECT game_id FROM request_state) = $3::uuid
      THEN 'ALREADY_ATTACHED'
    WHEN (SELECT game_id FROM request_state) IS NOT NULL
      THEN 'GAME_LINK_CONFLICT'
    WHEN (SELECT status FROM request_state) <> 'reserved'
      THEN 'INVALID_REQUEST_STATE'
    WHEN NOT EXISTS (SELECT 1 FROM owned_game)
      THEN 'GAME_NOT_FOUND'
    ELSE 'ALLOW'
  END AS code
),
attach_game AS (
  UPDATE model_requests AS requests
  SET
    game_id = $3::uuid,
    updated_at = $4::timestamptz
  FROM request_state, decision
  WHERE
    decision.code = 'ALLOW'
    AND requests.id = request_state.id
  RETURNING requests.id
)
SELECT
  decision.code,
  (SELECT count(*) FROM attach_game) AS attached
FROM decision
`

export function buildAttachModelRequestGameStatement(
  input: AttachModelRequestGameInput,
  now: Date,
): SqlStatement {
  return {
    text: attachModelRequestGameSql,
    values: [
      input.requestId,
      input.userId,
      input.gameId,
      now.toISOString(),
    ],
  }
}

export const getModelRequestResultSql = `
SELECT
  requests.id::text AS request_id,
  requests.game_id::text AS game_id,
  requests.operation,
  requests.request_sha256,
  requests.prompt_version,
  requests.status,
  requests.result_payload
FROM model_requests AS requests
WHERE
  requests.id = $1::uuid
  AND requests.clerk_user_id = $2::text
`

export function buildGetModelRequestResultStatement(
  input: GetModelRequestResultInput,
): SqlStatement {
  return {
    text: getModelRequestResultSql,
    values: [input.requestId, input.userId],
  }
}

export const getModelRequestByIdempotencyKeySql = `
SELECT
  requests.id::text AS request_id,
  requests.game_id::text AS game_id,
  requests.operation,
  requests.request_sha256,
  requests.prompt_version,
  requests.status,
  requests.result_payload
FROM model_requests AS requests
WHERE
  requests.clerk_user_id = $1::text
  AND requests.operation = $2::text
  AND requests.idempotency_key = $3::uuid
`

export function buildGetModelRequestByIdempotencyKeyStatement(
  input: GetModelRequestByIdempotencyKeyInput,
): SqlStatement {
  return {
    text: getModelRequestByIdempotencyKeySql,
    values: [input.userId, input.operation, input.idempotencyKey],
  }
}

export const getLatestModelRequestForGameSql = `
SELECT
  requests.id::text AS request_id,
  requests.game_id::text AS game_id,
  requests.operation,
  requests.request_sha256,
  requests.prompt_version,
  requests.status,
  requests.result_payload
FROM model_requests AS requests
JOIN games
  ON games.id = requests.game_id
  AND games.clerk_user_id = requests.clerk_user_id
WHERE
  requests.game_id = $1::uuid
  AND requests.clerk_user_id = $2::text
  AND requests.operation = $3::text
  AND ($4::text IS NULL OR requests.request_sha256 = $4::char(64))
  AND ($5::text IS NULL OR requests.prompt_version = $5::text)
ORDER BY requests.created_at DESC, requests.id DESC
LIMIT 1
`

export function buildGetLatestModelRequestForGameStatement(
  input: GetLatestModelRequestForGameInput,
): SqlStatement {
  return {
    text: getLatestModelRequestForGameSql,
    values: [
      input.gameId,
      input.userId,
      input.operation,
      input.requestSha256 ?? null,
      input.promptVersion ?? null,
    ],
  }
}

export const getSucceededModelResultForGameSql = `
SELECT
  requests.id::text AS request_id,
  requests.game_id::text AS game_id,
  requests.operation,
  requests.request_sha256,
  requests.prompt_version,
  requests.status,
  requests.result_payload
FROM model_requests AS requests
JOIN games
  ON games.id = requests.game_id
  AND games.clerk_user_id = requests.clerk_user_id
WHERE
  requests.game_id = $1::uuid
  AND requests.clerk_user_id = $2::text
  AND requests.operation = $3::text
  AND ($4::text IS NULL OR requests.request_sha256 = $4::char(64))
  AND ($5::text IS NULL OR requests.prompt_version = $5::text)
  AND requests.status = 'succeeded'
ORDER BY requests.completed_at DESC, requests.id DESC
LIMIT 1
`

export function buildGetSucceededModelResultForGameStatement(
  input: GetLatestModelRequestForGameInput,
): SqlStatement {
  return {
    text: getSucceededModelResultForGameSql,
    values: [
      input.gameId,
      input.userId,
      input.operation,
      input.requestSha256 ?? null,
      input.promptVersion ?? null,
    ],
  }
}

const consumeUserIpHourlyRateSql = `
WITH
lock_gate AS MATERIALIZED (
  SELECT ${RESERVATION_LOCK} AS held
),
deletion_barrier AS MATERIALIZED (
  SELECT tombstones.user_key_hash
  FROM deleted_user_tombstones AS tombstones
  CROSS JOIN lock_gate
  WHERE tombstones.user_key_hash = $11::text
),
inserted_control AS MATERIALIZED (
  INSERT INTO user_controls (clerk_user_id, last_seen_at)
  SELECT $1::text, $4::timestamptz
  FROM lock_gate
  WHERE NOT EXISTS (SELECT 1 FROM deletion_barrier)
  ON CONFLICT (clerk_user_id) DO UPDATE
  SET last_seen_at = excluded.last_seen_at
  RETURNING suspended, blocked_until
),
control AS MATERIALIZED (
  SELECT
    inserted_control.suspended,
    inserted_control.blocked_until,
    false AS deleted
  FROM inserted_control
  UNION ALL
  SELECT
    true,
    NULL::timestamptz,
    true
  FROM deletion_barrier
),
rates AS MATERIALIZED (
  INSERT INTO rate_buckets (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds,
    count,
    expires_at
  )
  SELECT
    source.key_type,
    source.key_hash,
    $8::text,
    $5::timestamptz,
    3600,
    1,
    $5::timestamptz + interval '2 hours'
  FROM (
    VALUES
      ('user'::text, $2::text),
      ('ip'::text, $3::text)
  ) AS source(key_type, key_hash)
  CROSS JOIN control
  WHERE NOT control.suspended
  ON CONFLICT (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds
  ) DO UPDATE
  SET
    count = rate_buckets.count + 1,
    expires_at = excluded.expires_at
  RETURNING key_type, count
),
decision AS MATERIALIZED (
  SELECT
    CASE
      WHEN control.deleted THEN 'ACCOUNT_DELETED'
      WHEN control.suspended THEN 'ACCOUNT_SUSPENDED'
      WHEN
        control.blocked_until IS NOT NULL
        AND control.blocked_until > $4::timestamptz
        THEN 'ACCOUNT_TEMPORARILY_BLOCKED'
      WHEN (
        SELECT count FROM rates WHERE key_type = 'user'
      ) > $6::integer THEN $9::text
      WHEN (
        SELECT count FROM rates WHERE key_type = 'ip'
      ) > $7::integer THEN $10::text
      ELSE 'ALLOW'
    END AS code,
    CASE
      WHEN control.deleted OR control.suspended THEN NULL
      WHEN
        control.blocked_until IS NOT NULL
        AND control.blocked_until > $4::timestamptz
        THEN control.blocked_until
      WHEN (
        SELECT count FROM rates WHERE key_type = 'user'
      ) > $6::integer THEN $5::timestamptz + interval '1 hour'
      WHEN (
        SELECT count FROM rates WHERE key_type = 'ip'
      ) > $7::integer THEN $5::timestamptz + interval '1 hour'
      ELSE NULL
    END AS retry_at
  FROM control
)
SELECT
  decision.code,
  decision.retry_at,
  (SELECT count FROM rates WHERE key_type = 'user') AS user_count,
  (SELECT count FROM rates WHERE key_type = 'ip') AS ip_count,
  $5::timestamptz + interval '1 hour' AS resets_at
FROM decision
`

export const consumeGameMoveRateSql = consumeUserIpHourlyRateSql

export function buildConsumeGameMoveRateStatement(
  input: ConsumeGameMoveRateInput,
  config: UsageConfig,
  context: {
    readonly now: Date
    readonly userRateKey: string
    readonly ipRateKey: string
    readonly deletedUserKey: string
  },
): SqlStatement {
  const hourStart = new Date(context.now)
  hourStart.setUTCMinutes(0, 0, 0)

  return {
    text: consumeGameMoveRateSql,
    values: [
      input.userId,
      context.userRateKey,
      context.ipRateKey,
      context.now.toISOString(),
      hourStart.toISOString(),
      config.hourlyGameMoveLimit,
      config.hourlyIpGameMoveLimit,
      'game_move',
      'GAME_MOVE_HOURLY_RATE_LIMITED',
      'IP_GAME_MOVE_HOURLY_RATE_LIMITED',
      context.deletedUserKey,
    ],
  }
}

export const consumeAccountExportRateSql = consumeUserIpHourlyRateSql

export function buildConsumeAccountExportRateStatement(
  input: ConsumeAccountExportRateInput,
  config: UsageConfig,
  context: {
    readonly now: Date
    readonly userRateKey: string
    readonly ipRateKey: string
    readonly deletedUserKey: string
  },
): SqlStatement {
  const hourStart = new Date(context.now)
  hourStart.setUTCMinutes(0, 0, 0)

  return {
    text: consumeAccountExportRateSql,
    values: [
      input.userId,
      context.userRateKey,
      context.ipRateKey,
      context.now.toISOString(),
      hourStart.toISOString(),
      config.hourlyAccountExportLimit,
      config.hourlyIpAccountExportLimit,
      'account_export',
      'ACCOUNT_EXPORT_HOURLY_RATE_LIMITED',
      'IP_ACCOUNT_EXPORT_HOURLY_RATE_LIMITED',
      context.deletedUserKey,
    ],
  }
}

/**
 * Wilbur mutation admission is idempotent against the durable mutation
 * request ledger. The user bucket is deliberately decided before the shared
 * IP bucket: once a user's own allowance is exhausted, their rejected retries
 * cannot consume capacity shared by other users on the same address.
 */
export const consumeWilburMutationRateSql = `
WITH
lock_gate AS MATERIALIZED (
  SELECT ${RESERVATION_LOCK} AS held
),
deletion_barrier AS MATERIALIZED (
  SELECT tombstones.user_key_hash
  FROM deleted_user_tombstones AS tombstones
  CROSS JOIN lock_gate
  WHERE tombstones.user_key_hash = $11::text
),
inserted_control AS MATERIALIZED (
  INSERT INTO user_controls (clerk_user_id, last_seen_at)
  SELECT $1::text, $4::timestamptz
  FROM lock_gate
  WHERE NOT EXISTS (SELECT 1 FROM deletion_barrier)
  ON CONFLICT (clerk_user_id) DO UPDATE
  SET last_seen_at = excluded.last_seen_at
  RETURNING suspended, blocked_until
),
control AS MATERIALIZED (
  SELECT
    inserted_control.suspended,
    inserted_control.blocked_until,
    false AS deleted
  FROM inserted_control
  UNION ALL
  SELECT
    true,
    NULL::timestamptz,
    true
  FROM deletion_barrier
),
request_state AS MATERIALIZED (
  SELECT
    requests.idempotency_key,
    requests.operation,
    requests.request_digest,
    requests.rate_kind,
    requests.status,
    requests.rate_admitted_at,
    requests.denial_code,
    requests.retry_at
  FROM wilbur_mutation_requests AS requests
  CROSS JOIN lock_gate
  WHERE
    requests.clerk_user_id = $1::text
    AND requests.idempotency_key = $13::uuid
  FOR UPDATE OF requests
),
identity_decision AS MATERIALIZED (
  SELECT
    CASE
      WHEN control.deleted THEN 'ACCOUNT_DELETED'
      WHEN control.suspended THEN 'ACCOUNT_SUSPENDED'
      WHEN
        control.blocked_until IS NOT NULL
        AND control.blocked_until > $4::timestamptz
        THEN 'ACCOUNT_TEMPORARILY_BLOCKED'
      WHEN request_state.idempotency_key IS NULL THEN 'IDEMPOTENCY_CONFLICT'
      WHEN
        request_state.operation <> $12::text
        OR request_state.request_digest <> $14::char(64)
        OR request_state.rate_kind <> $15::text
        THEN 'IDEMPOTENCY_CONFLICT'
      WHEN request_state.status = 'denied' THEN request_state.denial_code
      WHEN
        request_state.status = 'committed'
        OR request_state.rate_admitted_at IS NOT NULL
        THEN 'EXISTING'
      ELSE 'CONTINUE'
    END AS code,
    CASE
      WHEN
        control.blocked_until IS NOT NULL
        AND control.blocked_until > $4::timestamptz
        THEN control.blocked_until
      WHEN request_state.status = 'denied' THEN request_state.retry_at
      ELSE NULL
    END AS retry_at
  FROM control
  LEFT JOIN request_state ON true
),
user_rate AS MATERIALIZED (
  INSERT INTO rate_buckets (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds,
    count,
    expires_at
  )
  SELECT
    'user',
    $2::text,
    $8::text,
    $5::timestamptz,
    3600,
    1,
    $5::timestamptz + interval '2 hours'
  FROM identity_decision
  WHERE identity_decision.code = 'CONTINUE'
  ON CONFLICT (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds
  ) DO UPDATE
  SET
    count = rate_buckets.count + 1,
    expires_at = excluded.expires_at
  RETURNING count
),
user_decision AS MATERIALIZED (
  SELECT
    CASE
      WHEN identity_decision.code <> 'CONTINUE'
        THEN identity_decision.code
      WHEN (SELECT count FROM user_rate) > $6::integer
        THEN $9::text
      ELSE 'CONTINUE'
    END AS code,
    CASE
      WHEN identity_decision.code <> 'CONTINUE'
        THEN identity_decision.retry_at
      WHEN (SELECT count FROM user_rate) > $6::integer
        THEN $5::timestamptz + interval '1 hour'
      ELSE NULL
    END AS retry_at
  FROM identity_decision
),
ip_rate AS MATERIALIZED (
  INSERT INTO rate_buckets (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds,
    count,
    expires_at
  )
  SELECT
    'ip',
    $3::text,
    $8::text,
    $5::timestamptz,
    3600,
    1,
    $5::timestamptz + interval '2 hours'
  FROM user_decision
  WHERE user_decision.code = 'CONTINUE'
  ON CONFLICT (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds
  ) DO UPDATE
  SET
    count = rate_buckets.count + 1,
    expires_at = excluded.expires_at
  RETURNING count
),
decision AS MATERIALIZED (
  SELECT
    CASE
      WHEN user_decision.code <> 'CONTINUE' THEN user_decision.code
      WHEN (SELECT count FROM ip_rate) > $7::integer THEN $10::text
      ELSE 'ALLOW'
    END AS code,
    CASE
      WHEN user_decision.code <> 'CONTINUE' THEN user_decision.retry_at
      WHEN (SELECT count FROM ip_rate) > $7::integer
        THEN $5::timestamptz + interval '1 hour'
      ELSE NULL
    END AS retry_at
  FROM user_decision
),
persist_decision AS (
  UPDATE wilbur_mutation_requests AS requests
  SET
    rate_admitted_at = CASE
      WHEN decision.code = 'ALLOW' THEN now()
      ELSE requests.rate_admitted_at
    END,
    status = CASE
      WHEN decision.code NOT IN ('ALLOW', 'EXISTING', 'IDEMPOTENCY_CONFLICT')
        THEN 'denied'
      ELSE requests.status
    END,
    denial_code = CASE
      WHEN decision.code NOT IN ('ALLOW', 'EXISTING', 'IDEMPOTENCY_CONFLICT')
        THEN decision.code
      ELSE requests.denial_code
    END,
    retry_at = CASE
      WHEN decision.code NOT IN ('ALLOW', 'EXISTING', 'IDEMPOTENCY_CONFLICT')
        THEN decision.retry_at
      ELSE requests.retry_at
    END,
    reserved_future_rows = CASE
      WHEN decision.code NOT IN ('ALLOW', 'EXISTING', 'IDEMPOTENCY_CONFLICT')
        THEN 0
      ELSE requests.reserved_future_rows
    END,
    reserved_text_bytes = CASE
      WHEN decision.code NOT IN ('ALLOW', 'EXISTING', 'IDEMPOTENCY_CONFLICT')
        THEN 0
      ELSE requests.reserved_text_bytes
    END,
    updated_at = now()
  FROM decision
  WHERE
    requests.clerk_user_id = $1::text
    AND requests.idempotency_key = $13::uuid
    AND requests.operation = $12::text
    AND requests.request_digest = $14::char(64)
    AND requests.rate_kind = $15::text
    AND requests.status = 'pending'
    AND requests.rate_admitted_at IS NULL
    AND decision.code <> 'IDEMPOTENCY_CONFLICT'
  RETURNING requests.idempotency_key
),
current_counts AS MATERIALIZED (
  SELECT buckets.key_type, buckets.count
  FROM rate_buckets AS buckets
  WHERE
    buckets.action = $8::text
    AND buckets.window_start = $5::timestamptz
    AND buckets.window_seconds = 3600
    AND (
      (buckets.key_type = 'user' AND buckets.key_hash = $2::text)
      OR (buckets.key_type = 'ip' AND buckets.key_hash = $3::text)
    )
)
SELECT
  decision.code,
  decision.retry_at,
  coalesce(
    (SELECT count FROM user_rate),
    (SELECT count FROM current_counts WHERE key_type = 'user'),
    0
  ) AS user_count,
  coalesce(
    (SELECT count FROM ip_rate),
    (SELECT count FROM current_counts WHERE key_type = 'ip'),
    0
  ) AS ip_count,
  $5::timestamptz + interval '1 hour' AS resets_at,
  (SELECT count(*) FROM persist_decision) AS persisted
FROM decision
`

export function buildConsumeWilburMutationRateStatement(
  input: ConsumeWilburMutationRateInput,
  config: UsageConfig,
  context: {
    readonly now: Date
    readonly userRateKey: string
    readonly ipRateKey: string
    readonly deletedUserKey: string
  },
): SqlStatement {
  const hourStart = new Date(context.now)
  hourStart.setUTCMinutes(0, 0, 0)
  const action = input.kind === 'action'

  return {
    text: consumeWilburMutationRateSql,
    values: [
      input.userId,
      context.userRateKey,
      context.ipRateKey,
      context.now.toISOString(),
      hourStart.toISOString(),
      action
        ? config.hourlyWilburActionLimit
        : config.hourlyWilburObservationLimit,
      action
        ? config.hourlyIpWilburActionLimit
        : config.hourlyIpWilburObservationLimit,
      action ? 'wilbur_action' : 'wilbur_observation',
      action
        ? 'WILBUR_ACTION_HOURLY_RATE_LIMITED'
        : 'WILBUR_OBSERVATION_HOURLY_RATE_LIMITED',
      action
        ? 'IP_WILBUR_ACTION_HOURLY_RATE_LIMITED'
        : 'IP_WILBUR_OBSERVATION_HOURLY_RATE_LIMITED',
      context.deletedUserKey,
      input.operation,
      input.idempotencyKey,
      input.requestDigest,
      input.kind,
    ],
  }
}

export const beginProviderCallSql = `
WITH
lock_gate AS MATERIALIZED (
  SELECT ${RESERVATION_LOCK} AS held
),
deletion_barrier AS MATERIALIZED (
  SELECT tombstones.user_key_hash
  FROM deleted_user_tombstones AS tombstones
  CROSS JOIN lock_gate
  WHERE tombstones.user_key_hash = $6::text
),
account_state AS MATERIALIZED (
  SELECT
    EXISTS (SELECT 1 FROM deletion_barrier) AS deleted,
    coalesce(
      (
        SELECT controls.suspended
        FROM user_controls AS controls
        WHERE controls.clerk_user_id = $2::text
      ),
      false
    ) AS suspended,
    (
      SELECT controls.blocked_until
      FROM user_controls AS controls
      WHERE controls.clerk_user_id = $2::text
    ) AS blocked_until
  FROM lock_gate
),
request_state AS MATERIALIZED (
  SELECT
    requests.id,
    requests.status,
    requests.created_at,
    slots.slot,
    slots.lease_token,
    slots.lease_expires_at
  FROM model_requests AS requests
  CROSS JOIN lock_gate
  LEFT JOIN model_concurrency_slots AS slots
    ON slots.request_id = requests.id
  WHERE
    requests.id = $1::uuid
    AND requests.clerk_user_id = $2::text
  FOR UPDATE OF requests
),
decision AS MATERIALIZED (
  SELECT CASE
    WHEN account_state.deleted
      THEN 'ACCOUNT_DELETED'
    WHEN account_state.suspended
      THEN 'ACCOUNT_SUSPENDED'
    WHEN
      account_state.blocked_until IS NOT NULL
      AND account_state.blocked_until > $4::timestamptz
      THEN 'ACCOUNT_TEMPORARILY_BLOCKED'
    WHEN NOT EXISTS (SELECT 1 FROM request_state)
      THEN 'REQUEST_NOT_FOUND'
    WHEN (SELECT status FROM request_state) NOT IN ('reserved', 'in_progress')
      THEN 'INVALID_REQUEST_STATE'
    WHEN
      (SELECT lease_token FROM request_state) IS NULL
      OR (SELECT lease_token::text FROM request_state) <> $3::text
      THEN 'LEASE_MISMATCH'
    WHEN (SELECT lease_expires_at FROM request_state) <= $4::timestamptz
      THEN 'LEASE_EXPIRED'
    WHEN (SELECT status FROM request_state) = 'in_progress'
      THEN 'ALREADY_STARTED'
    ELSE 'ALLOW'
  END AS code
  FROM account_state
),
consume_model_reservation AS (
  UPDATE usage_buckets AS buckets
  SET
    used = buckets.used + 1,
    reserved = greatest(buckets.reserved - 1, 0),
    updated_at = $4::timestamptz
  FROM request_state, decision
  WHERE
    decision.code = 'ALLOW'
    AND buckets.subject_type = 'user'
    AND buckets.subject_key = $2::text
    AND buckets.metric = 'model_requests'
    AND buckets.bucket_start = (
      date_trunc(
        'day',
        request_state.created_at AT TIME ZONE 'UTC'
      ) AT TIME ZONE 'UTC'
    )
    AND buckets.bucket_seconds = 86400
  RETURNING buckets.subject_key
),
consume_global_model_reservation AS (
  UPDATE usage_buckets AS buckets
  SET
    used = buckets.used + 1,
    reserved = greatest(buckets.reserved - 1, 0),
    updated_at = $4::timestamptz
  FROM request_state, decision
  WHERE
    decision.code = 'ALLOW'
    AND buckets.subject_type = 'global'
    AND buckets.subject_key = 'deployment'
    AND buckets.metric = 'model_requests'
    AND buckets.bucket_start = (
      date_trunc(
        'day',
        request_state.created_at AT TIME ZONE 'UTC'
      ) AT TIME ZONE 'UTC'
    )
    AND buckets.bucket_seconds = 86400
  RETURNING buckets.subject_key
),
start_request AS (
  UPDATE model_requests AS requests
  SET
    status = 'in_progress',
    provider_started_at = coalesce(provider_started_at, $4::timestamptz),
    updated_at = $4::timestamptz
  FROM request_state, decision
  WHERE
    decision.code IN ('ALLOW', 'ALREADY_STARTED')
    AND requests.id = request_state.id
  RETURNING requests.id
),
extend_lease AS (
  UPDATE model_concurrency_slots AS slots
  SET lease_expires_at = $5::timestamptz
  FROM request_state, start_request
  WHERE
    slots.slot = request_state.slot
    AND slots.lease_token = request_state.lease_token
  RETURNING slots.slot
),
mutation_gate AS MATERIALIZED (
  SELECT
    (SELECT count(*) FROM consume_model_reservation) AS consumed,
    (SELECT count(*) FROM consume_global_model_reservation)
      AS global_consumed,
    (SELECT count(*) FROM start_request) AS started,
    (SELECT count(*) FROM extend_lease) AS extended
)
SELECT decision.code
FROM decision
CROSS JOIN mutation_gate
`

export function buildBeginProviderCallStatement(
  input: BeginProviderCallInput,
  context: BeginQueryContext,
): SqlStatement {
  return {
    text: beginProviderCallSql,
    values: [
      input.requestId,
      input.userId,
      input.leaseToken,
      context.now.toISOString(),
      context.leaseExpiresAt.toISOString(),
      context.deletedUserKey,
    ],
  }
}

export const settleModelRequestSql = `
WITH
lock_gate AS MATERIALIZED (
  SELECT ${RESERVATION_LOCK} AS held
),
request_state AS MATERIALIZED (
  SELECT
    requests.id,
    requests.game_id,
    requests.operation,
    requests.status,
    requests.created_at,
    requests.provider_response_id,
    requests.response_sha256,
    requests.failure_code,
    requests.provider_http_status,
    requests.usage_reported,
    requests.input_tokens,
    requests.cached_input_tokens,
    requests.cache_write_input_tokens,
    requests.output_tokens,
    requests.reasoning_tokens,
    requests.total_tokens,
    slots.slot,
    slots.lease_token,
    slots.lease_expires_at
  FROM model_requests AS requests
  CROSS JOIN lock_gate
  LEFT JOIN model_concurrency_slots AS slots
    ON slots.request_id = requests.id
  WHERE
    requests.id = $1::uuid
    AND requests.clerk_user_id = $2::text
  FOR UPDATE OF requests
),
other_success AS MATERIALIZED (
  SELECT requests.id
  FROM model_requests AS requests
  CROSS JOIN request_state
  WHERE
    request_state.game_id IS NOT NULL
    AND requests.game_id = request_state.game_id
    AND requests.operation = request_state.operation
    AND requests.status = 'succeeded'
    AND requests.id <> request_state.id
  LIMIT 1
),
decision AS MATERIALIZED (
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM request_state)
      THEN 'REQUEST_NOT_FOUND'
    WHEN
      (SELECT status FROM request_state) = $4::text
      AND (
        (
          $4::text = 'succeeded'
          AND (SELECT provider_response_id FROM request_state) = $5::text
          AND (SELECT response_sha256 FROM request_state) = $6::text
        )
        OR (
          $4::text IN ('failed', 'indeterminate')
          AND (SELECT provider_response_id FROM request_state)
            IS NOT DISTINCT FROM $5::text
          AND (SELECT failure_code FROM request_state) = $7::text
          AND (SELECT provider_http_status FROM request_state)
            IS NOT DISTINCT FROM $8::smallint
        )
      )
      AND (SELECT usage_reported FROM request_state) = $17::boolean
      AND (SELECT input_tokens FROM request_state)
        IS NOT DISTINCT FROM $10::bigint
      AND (SELECT cached_input_tokens FROM request_state)
        IS NOT DISTINCT FROM $11::bigint
      AND (SELECT cache_write_input_tokens FROM request_state)
        IS NOT DISTINCT FROM $12::bigint
      AND (SELECT output_tokens FROM request_state)
        IS NOT DISTINCT FROM $13::bigint
      AND (SELECT reasoning_tokens FROM request_state)
        IS NOT DISTINCT FROM $14::bigint
      AND (SELECT total_tokens FROM request_state)
        IS NOT DISTINCT FROM $15::bigint
      THEN 'ALREADY_SETTLED'
    WHEN
      (SELECT status FROM request_state) = 'rejected'
      AND (SELECT failure_code FROM request_state)
        = 'operation_already_succeeded'
      AND $4::text = 'succeeded'
      AND (SELECT provider_response_id FROM request_state) = $5::text
      AND (SELECT response_sha256 FROM request_state) = $6::text
      AND (SELECT usage_reported FROM request_state) = $17::boolean
      AND (SELECT input_tokens FROM request_state)
        IS NOT DISTINCT FROM $10::bigint
      AND (SELECT cached_input_tokens FROM request_state)
        IS NOT DISTINCT FROM $11::bigint
      AND (SELECT cache_write_input_tokens FROM request_state)
        IS NOT DISTINCT FROM $12::bigint
      AND (SELECT output_tokens FROM request_state)
        IS NOT DISTINCT FROM $13::bigint
      AND (SELECT reasoning_tokens FROM request_state)
        IS NOT DISTINCT FROM $14::bigint
      AND (SELECT total_tokens FROM request_state)
        IS NOT DISTINCT FROM $15::bigint
      THEN 'OPERATION_ALREADY_SUCCEEDED'
    WHEN
      (SELECT status FROM request_state) = 'rejected'
      AND (SELECT failure_code FROM request_state)
        = 'operation_already_succeeded'
      THEN 'SETTLEMENT_CONFLICT'
    WHEN (SELECT status FROM request_state) IN (
      'succeeded',
      'failed',
      'indeterminate'
    )
      THEN 'SETTLEMENT_CONFLICT'
    WHEN (SELECT status FROM request_state) <> 'in_progress'
      THEN 'INVALID_REQUEST_STATE'
    WHEN (SELECT lease_token FROM request_state) IS NULL
      THEN 'LEASE_EXPIRED'
    WHEN
      (SELECT lease_token::text FROM request_state) <> $3::text
      THEN 'SETTLEMENT_CONFLICT'
    WHEN (SELECT lease_expires_at FROM request_state) <= $9::timestamptz
      THEN 'LEASE_EXPIRED'
    WHEN EXISTS (SELECT 1 FROM other_success)
      THEN 'OPERATION_ALREADY_SUCCEEDED'
    ELSE 'ALLOW'
  END AS code
),
finalize_game_reservation AS (
  UPDATE usage_buckets AS buckets
  SET
    used = buckets.used + CASE WHEN $4::text = 'succeeded' THEN 1 ELSE 0 END,
    reserved = greatest(buckets.reserved - 1, 0),
    updated_at = $9::timestamptz
  FROM request_state, decision
  WHERE
    decision.code = 'ALLOW'
    AND request_state.status = 'in_progress'
    AND request_state.operation = 'division'
    AND buckets.subject_type = 'user'
    AND buckets.subject_key = $2::text
    AND buckets.metric = 'game_starts'
    AND buckets.bucket_start = (
      date_trunc(
        'day',
        request_state.created_at AT TIME ZONE 'UTC'
      ) AT TIME ZONE 'UTC'
    )
    AND buckets.bucket_seconds = 86400
  RETURNING buckets.subject_key
),
settle_request AS (
  UPDATE model_requests AS requests
  SET
    status = $4::text,
    provider_response_id = $5::text,
    response_sha256 = CASE
      WHEN $4::text = 'succeeded' THEN $6::text
      ELSE NULL
    END,
    failure_code = CASE
      WHEN $4::text IN ('failed', 'indeterminate') THEN $7::text
      ELSE NULL
    END,
    provider_http_status = CASE
      WHEN $4::text IN ('failed', 'indeterminate') THEN $8::smallint
      ELSE NULL
    END,
    usage_reported = $17::boolean,
    input_tokens = $10::bigint,
    cached_input_tokens = $11::bigint,
    cache_write_input_tokens = $12::bigint,
    output_tokens = $13::bigint,
    reasoning_tokens = $14::bigint,
    total_tokens = $15::bigint,
    result_payload = CASE
      WHEN $4::text = 'succeeded' THEN $16::jsonb
      ELSE NULL
    END,
    completed_at = $9::timestamptz,
    updated_at = $9::timestamptz
  FROM request_state, decision
  WHERE
    decision.code = 'ALLOW'
    AND requests.id = request_state.id
  RETURNING requests.id
),
reject_duplicate_success AS (
  UPDATE model_requests AS requests
  SET
    status = 'rejected',
    result_payload = NULL,
    provider_response_id = $5::text,
    response_sha256 = $6::text,
    provider_http_status = $8::smallint,
    usage_reported = $17::boolean,
    input_tokens = $10::bigint,
    cached_input_tokens = $11::bigint,
    cache_write_input_tokens = $12::bigint,
    output_tokens = $13::bigint,
    reasoning_tokens = $14::bigint,
    total_tokens = $15::bigint,
    failure_code = 'operation_already_succeeded',
    completed_at = $9::timestamptz,
    updated_at = $9::timestamptz
  FROM request_state, decision
  WHERE
    decision.code = 'OPERATION_ALREADY_SUCCEEDED'
    AND request_state.status = 'in_progress'
    AND requests.id = request_state.id
  RETURNING requests.id
),
release_duplicate_game_reservation AS (
  UPDATE usage_buckets AS buckets
  SET
    reserved = greatest(buckets.reserved - 1, 0),
    updated_at = $9::timestamptz
  FROM request_state, reject_duplicate_success
  WHERE
    request_state.status = 'in_progress'
    AND
    request_state.operation = 'division'
    AND buckets.subject_type = 'user'
    AND buckets.subject_key = $2::text
    AND buckets.metric = 'game_starts'
    AND buckets.bucket_start = (
      date_trunc(
        'day',
        request_state.created_at AT TIME ZONE 'UTC'
      ) AT TIME ZONE 'UTC'
    )
    AND buckets.bucket_seconds = 86400
  RETURNING buckets.subject_key
),
completed_request AS (
  SELECT id FROM settle_request
  UNION ALL
  SELECT id FROM reject_duplicate_success
),
clear_slot AS (
  UPDATE model_concurrency_slots AS slots
  SET
    request_id = NULL,
    clerk_user_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL
  FROM request_state, completed_request
  WHERE
    slots.slot = request_state.slot
    AND slots.request_id = completed_request.id
    AND slots.lease_token = request_state.lease_token
  RETURNING slots.slot
),
mutation_gate AS MATERIALIZED (
  SELECT
    (SELECT count(*) FROM finalize_game_reservation) AS finalized_games,
    (SELECT count(*) FROM settle_request) AS settled,
    (SELECT count(*) FROM reject_duplicate_success) AS rejected_duplicates,
    (SELECT count(*) FROM release_duplicate_game_reservation)
      AS released_duplicate_games,
    (SELECT count(*) FROM clear_slot) AS cleared
)
SELECT decision.code
FROM decision
CROSS JOIN mutation_gate
`

export function buildSettleModelRequestStatement(
  input: SettleModelRequestInput,
  context: SettlementQueryContext,
): SqlStatement {
  const success = input.outcome === 'succeeded'
  const usage = input.usage
  const reportedUsage = usage?.reported === true ? usage : undefined

  return {
    text: settleModelRequestSql,
    values: [
      input.requestId,
      input.userId,
      input.leaseToken,
      input.outcome,
      success
        ? input.providerResponseId
        : (input.providerResponseId ?? null),
      success ? input.responseSha256 : null,
      success ? null : input.failureCode,
      success ? null : (input.providerHttpStatus ?? null),
      context.now.toISOString(),
      reportedUsage?.inputTokens ?? null,
      reportedUsage?.cachedInputTokens ?? null,
      reportedUsage?.cacheWriteInputTokens ?? null,
      reportedUsage?.outputTokens ?? null,
      reportedUsage?.reasoningTokens ?? null,
      reportedUsage?.totalTokens ?? null,
      success ? JSON.stringify(input.resultPayload) : null,
      usage?.reported ?? false,
    ],
  }
}

export const releaseReservationSql = `
WITH
lock_gate AS MATERIALIZED (
  SELECT ${RESERVATION_LOCK} AS held
),
request_state AS MATERIALIZED (
  SELECT
    requests.id,
    requests.operation,
    requests.status,
    requests.failure_code,
    requests.created_at,
    slots.slot,
    slots.lease_token
  FROM model_requests AS requests
  CROSS JOIN lock_gate
  LEFT JOIN model_concurrency_slots AS slots
    ON slots.request_id = requests.id
  WHERE
    requests.id = $1::uuid
    AND requests.clerk_user_id = $2::text
  FOR UPDATE OF requests
),
decision AS MATERIALIZED (
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM request_state)
      THEN 'REQUEST_NOT_FOUND'
    WHEN
      (SELECT status FROM request_state) = 'failed'
      AND (SELECT failure_code FROM request_state) = $5::text
      THEN 'ALREADY_RELEASED'
    WHEN (SELECT status FROM request_state) NOT IN ('reserved', 'in_progress')
      THEN 'INVALID_REQUEST_STATE'
    WHEN
      (SELECT status FROM request_state) = 'in_progress'
      AND $5::text <> 'released_provider_not_started'
      THEN 'INVALID_REQUEST_STATE'
    WHEN
      (SELECT lease_token FROM request_state) IS NULL
      OR (SELECT lease_token::text FROM request_state) <> $3::text
      THEN 'LEASE_MISMATCH'
    ELSE 'ALLOW'
  END AS code
),
refund_model_reservation AS (
  UPDATE usage_buckets AS buckets
  SET
    used = greatest(
      buckets.used - CASE
        WHEN request_state.status = 'in_progress' THEN 1
        ELSE 0
      END,
      0
    ),
    reserved = greatest(
      buckets.reserved - CASE
        WHEN request_state.status = 'reserved' THEN 1
        ELSE 0
      END,
      0
    ),
    updated_at = $4::timestamptz
  FROM request_state, decision
  WHERE
    decision.code = 'ALLOW'
    AND buckets.subject_type = 'user'
    AND buckets.subject_key = $2::text
    AND buckets.metric = 'model_requests'
    AND buckets.bucket_start = (
      date_trunc(
        'day',
        request_state.created_at AT TIME ZONE 'UTC'
      ) AT TIME ZONE 'UTC'
    )
    AND buckets.bucket_seconds = 86400
  RETURNING buckets.subject_key
),
refund_global_model_reservation AS (
  UPDATE usage_buckets AS buckets
  SET
    used = greatest(
      buckets.used - CASE
        WHEN request_state.status = 'in_progress' THEN 1
        ELSE 0
      END,
      0
    ),
    reserved = greatest(
      buckets.reserved - CASE
        WHEN request_state.status = 'reserved' THEN 1
        ELSE 0
      END,
      0
    ),
    updated_at = $4::timestamptz
  FROM request_state, decision
  WHERE
    decision.code = 'ALLOW'
    AND buckets.subject_type = 'global'
    AND buckets.subject_key = 'deployment'
    AND buckets.metric = 'model_requests'
    AND buckets.bucket_start = (
      date_trunc(
        'day',
        request_state.created_at AT TIME ZONE 'UTC'
      ) AT TIME ZONE 'UTC'
    )
    AND buckets.bucket_seconds = 86400
  RETURNING buckets.subject_key
),
refund_game_reservation AS (
  UPDATE usage_buckets AS buckets
  SET
    reserved = greatest(buckets.reserved - 1, 0),
    updated_at = $4::timestamptz
  FROM request_state, decision
  WHERE
    decision.code = 'ALLOW'
    AND request_state.operation = 'division'
    AND buckets.subject_type = 'user'
    AND buckets.subject_key = $2::text
    AND buckets.metric = 'game_starts'
    AND buckets.bucket_start = (
      date_trunc(
        'day',
        request_state.created_at AT TIME ZONE 'UTC'
      ) AT TIME ZONE 'UTC'
    )
    AND buckets.bucket_seconds = 86400
  RETURNING buckets.subject_key
),
release_request AS (
  UPDATE model_requests AS requests
  SET
    status = 'failed',
    failure_code = $5::text,
    provider_started_at = CASE
      WHEN request_state.status = 'in_progress' THEN NULL
      ELSE requests.provider_started_at
    END,
    completed_at = $4::timestamptz,
    updated_at = $4::timestamptz
  FROM request_state, decision
  WHERE
    decision.code = 'ALLOW'
    AND requests.id = request_state.id
  RETURNING requests.id
),
clear_slot AS (
  UPDATE model_concurrency_slots AS slots
  SET
    request_id = NULL,
    clerk_user_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL
  FROM request_state, release_request
  WHERE
    slots.slot = request_state.slot
    AND slots.lease_token = request_state.lease_token
  RETURNING slots.slot
),
mutation_gate AS MATERIALIZED (
  SELECT
    (SELECT count(*) FROM refund_model_reservation) AS model_refunds,
    (SELECT count(*) FROM refund_global_model_reservation)
      AS global_model_refunds,
    (SELECT count(*) FROM refund_game_reservation) AS game_refunds,
    (SELECT count(*) FROM release_request) AS released,
    (SELECT count(*) FROM clear_slot) AS cleared
)
SELECT decision.code
FROM decision
CROSS JOIN mutation_gate
`

export function buildReleaseReservationStatement(
  input: ReleaseReservationInput,
  context: SettlementQueryContext,
): SqlStatement {
  return {
    text: releaseReservationSql,
    values: [
      input.requestId,
      input.userId,
      input.leaseToken,
      context.now.toISOString(),
      `released_${input.reason}`,
    ],
  }
}

export const deleteAccountDataSql = `
WITH
lock_gate AS MATERIALIZED (
  SELECT ${RESERVATION_LOCK} AS held
),
existing_deletion_barrier AS MATERIALIZED (
  SELECT tombstones.user_key_hash
  FROM deleted_user_tombstones AS tombstones
  CROSS JOIN lock_gate
  WHERE tombstones.user_key_hash = $5::text
),
active_model_request AS MATERIALIZED (
  SELECT slots.lease_expires_at
  FROM model_concurrency_slots AS slots
  JOIN model_requests AS requests ON requests.id = slots.request_id
  CROSS JOIN lock_gate
  WHERE
    slots.clerk_user_id = $1::text
    AND requests.status = 'in_progress'
    AND slots.lease_expires_at > $3::timestamptz
),
decision AS MATERIALIZED (
  SELECT
    CASE
      WHEN
        NOT $4::boolean
        AND EXISTS (SELECT 1 FROM active_model_request)
        THEN 'ACTIVE_MODEL_REQUEST'
      ELSE 'ALLOW'
    END AS code,
    (SELECT min(lease_expires_at) FROM active_model_request) AS retry_at
),
insert_deletion_barrier AS (
  INSERT INTO deleted_user_tombstones (user_key_hash, deleted_at)
  SELECT $5::text, $3::timestamptz
  FROM decision
  WHERE
    decision.code = 'ALLOW'
    AND $4::boolean
  ON CONFLICT (user_key_hash) DO UPDATE
  SET deleted_at = least(
    deleted_user_tombstones.deleted_at,
    excluded.deleted_at
  )
  RETURNING user_key_hash
),
deletion_barrier_gate AS MATERIALIZED (
  SELECT count(*) AS barriers
  FROM insert_deletion_barrier
),
reserved_requests AS MATERIALIZED (
  SELECT
    date_trunc(
      'day',
      requests.created_at AT TIME ZONE 'UTC'
    ) AT TIME ZONE 'UTC' AS bucket_start,
    count(*)::bigint AS reservation_count
  FROM model_concurrency_slots AS slots
  JOIN model_requests AS requests ON requests.id = slots.request_id
  CROSS JOIN decision
  CROSS JOIN deletion_barrier_gate
  WHERE
    decision.code = 'ALLOW'
    AND slots.clerk_user_id = $1::text
    AND requests.status = 'reserved'
  GROUP BY bucket_start
),
refund_global_reservations AS (
  UPDATE usage_buckets AS buckets
  SET
    reserved = greatest(
      buckets.reserved - reserved_requests.reservation_count,
      0
    ),
    updated_at = $3::timestamptz
  FROM reserved_requests
  WHERE
    buckets.subject_type = 'global'
    AND buckets.subject_key = 'deployment'
    AND buckets.metric = 'model_requests'
    AND buckets.bucket_start = reserved_requests.bucket_start
    AND buckets.bucket_seconds = 86400
  RETURNING buckets.subject_key
),
clear_slots AS (
  UPDATE model_concurrency_slots AS slots
  SET
    request_id = NULL,
    clerk_user_id = NULL,
    lease_token = NULL,
    lease_expires_at = NULL
  FROM decision, deletion_barrier_gate
  WHERE
    decision.code = 'ALLOW'
    AND slots.clerk_user_id = $1::text
  RETURNING slots.slot
),
delete_usage AS (
  DELETE FROM usage_buckets AS buckets
  USING decision, deletion_barrier_gate
  WHERE
    decision.code = 'ALLOW'
    AND buckets.subject_type = 'user'
    AND buckets.subject_key = $1::text
  RETURNING buckets.subject_key
),
delete_user_rates AS (
  DELETE FROM rate_buckets AS buckets
  USING decision, deletion_barrier_gate
  WHERE
    decision.code = 'ALLOW'
    AND buckets.key_type = 'user'
    AND buckets.key_hash = $2::text
  RETURNING buckets.key_hash
),
delete_game_start_requests AS (
  DELETE FROM game_start_requests AS requests
  USING decision, deletion_barrier_gate
  WHERE
    decision.code = 'ALLOW'
    AND requests.clerk_user_id = $1::text
  RETURNING requests.idempotency_key
),
deletion_gate AS MATERIALIZED (
  SELECT
    (SELECT count(*) FROM refund_global_reservations) AS refunded,
    (SELECT count(*) FROM clear_slots) AS cleared,
    (SELECT count(*) FROM delete_usage) AS usage_deleted,
    (SELECT count(*) FROM delete_user_rates) AS rates_deleted,
    (SELECT count(*) FROM delete_game_start_requests)
      AS game_start_requests_deleted
),
delete_requests AS (
  DELETE FROM model_requests AS requests
  USING decision, deletion_gate
  WHERE
    decision.code = 'ALLOW'
    AND requests.clerk_user_id = $1::text
  RETURNING requests.id
),
request_deletion_gate AS MATERIALIZED (
  SELECT count(*) AS requests_deleted
  FROM delete_requests
),
delete_games AS (
  DELETE FROM games
  USING decision, request_deletion_gate
  WHERE
    decision.code = 'ALLOW'
    AND games.clerk_user_id = $1::text
  RETURNING games.id
),
child_deletion_gate AS MATERIALIZED (
  SELECT
    request_deletion_gate.requests_deleted,
    (SELECT count(*) FROM delete_games) AS games_deleted
  FROM request_deletion_gate
),
tombstone_user AS (
  INSERT INTO user_controls (
    clerk_user_id,
    suspended,
    blocked_until,
    reason_code,
    daily_game_limit,
    daily_model_request_limit,
    hourly_model_request_limit,
    concurrent_model_limit,
    created_at,
    last_seen_at,
    updated_at
  )
  SELECT
    $1::text,
    true,
    NULL,
    'ACCOUNT_DELETION_PENDING',
    NULL,
    NULL,
    NULL,
    NULL,
    $3::timestamptz,
    $3::timestamptz,
    $3::timestamptz
  FROM decision, child_deletion_gate
  WHERE
    decision.code = 'ALLOW'
    AND NOT $4::boolean
    AND NOT EXISTS (SELECT 1 FROM existing_deletion_barrier)
  ON CONFLICT (clerk_user_id) DO UPDATE
  SET
    suspended = true,
    blocked_until = NULL,
    reason_code = 'ACCOUNT_DELETION_PENDING',
    daily_game_limit = NULL,
    daily_model_request_limit = NULL,
    hourly_model_request_limit = NULL,
    concurrent_model_limit = NULL,
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at
  RETURNING clerk_user_id
),
delete_user AS (
  DELETE FROM user_controls AS controls
  USING decision, child_deletion_gate
  WHERE
    decision.code = 'ALLOW'
    AND $4::boolean
    AND controls.clerk_user_id = $1::text
  RETURNING controls.clerk_user_id
)
SELECT
  decision.code,
  decision.retry_at,
  (
    EXISTS (SELECT 1 FROM tombstone_user)
    OR EXISTS (SELECT 1 FROM delete_user)
  ) AS deleted
FROM decision
`

export const deleteAccountGamesSql = `
WITH
lock_gate AS MATERIALIZED (
  SELECT ${RESERVATION_LOCK} AS held
),
active_model_request AS MATERIALIZED (
  SELECT slots.lease_expires_at
  FROM model_concurrency_slots AS slots
  JOIN model_requests AS requests ON requests.id = slots.request_id
  CROSS JOIN lock_gate
  WHERE
    slots.clerk_user_id = $1::text
    AND requests.status = 'in_progress'
    AND slots.lease_expires_at > $2::timestamptz
),
decision AS MATERIALIZED (
  SELECT CASE
    WHEN
      NOT $3::boolean
      AND EXISTS (SELECT 1 FROM active_model_request)
      THEN 'ACTIVE_MODEL_REQUEST'
    ELSE 'ALLOW'
  END AS code
)
DELETE FROM games
USING decision
WHERE
  decision.code = 'ALLOW'
  AND games.clerk_user_id = $1::text
RETURNING games.id
`

export function buildDeleteAccountGamesStatement(
  userId: string,
  now: Date,
  force: boolean,
): SqlStatement {
  return {
    text: deleteAccountGamesSql,
    values: [userId, now.toISOString(), force],
  }
}

export function buildDeleteAccountDataStatement(
  userId: string,
  userRateKey: string,
  now: Date,
  force: boolean,
  deletedUserKey: string,
): SqlStatement {
  return {
    text: deleteAccountDataSql,
    values: [
      userId,
      userRateKey,
      now.toISOString(),
      force,
      deletedUserKey,
    ],
  }
}

export const usageSummarySql = `
WITH
deletion_barrier AS MATERIALIZED (
  SELECT tombstones.user_key_hash
  FROM deleted_user_tombstones AS tombstones
  WHERE tombstones.user_key_hash = $6::text
),
control AS MATERIALIZED (
  SELECT
    daily_game_limit,
    daily_model_request_limit
  FROM user_controls
  WHERE clerk_user_id = $1::text
),
amounts AS MATERIALIZED (
  SELECT
    coalesce(
      max(used) FILTER (WHERE metric = 'model_requests'),
      0
    ) AS model_used,
    coalesce(
      max(reserved) FILTER (WHERE metric = 'model_requests'),
      0
    ) AS model_reserved,
    coalesce(
      max(used) FILTER (WHERE metric = 'game_starts'),
      0
    ) AS game_used,
    coalesce(
      max(reserved) FILTER (WHERE metric = 'game_starts'),
      0
    ) AS game_reserved
  FROM usage_buckets
  WHERE
    subject_type = 'user'
    AND subject_key = $1::text
    AND bucket_start = $3::timestamptz
    AND bucket_seconds = 86400
),
active AS MATERIALIZED (
  SELECT count(*)::integer AS active_count
  FROM model_concurrency_slots
  WHERE
    clerk_user_id = $1::text
    AND request_id IS NOT NULL
    AND lease_expires_at > $2::timestamptz
)
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM deletion_barrier)
      THEN 'ACCOUNT_DELETED'
    ELSE 'ALLOW'
  END AS code,
  NULL::timestamptz AS retry_at,
  amounts.model_used,
  amounts.model_reserved,
  amounts.game_used,
  amounts.game_reserved,
  coalesce(
    (SELECT daily_model_request_limit FROM control),
    $4::integer
  ) AS model_limit,
  coalesce(
    (SELECT daily_game_limit FROM control),
    $5::integer
  ) AS game_limit,
  active.active_count
FROM amounts, active
`

export function buildUsageSummaryStatement(
  userId: string,
  now: Date,
  config: UsageConfig,
  deletedUserKey: string,
): SqlStatement {
  const dayStart = new Date(now)
  dayStart.setUTCHours(0, 0, 0, 0)

  return {
    text: usageSummarySql,
    values: [
      userId,
      now.toISOString(),
      dayStart.toISOString(),
      config.dailyModelRequestLimit,
      config.dailyGameLimit,
      deletedUserKey,
    ],
  }
}
