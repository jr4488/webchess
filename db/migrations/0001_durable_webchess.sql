CREATE TABLE IF NOT EXISTS deleted_user_tombstones (
  user_key_hash char(64) PRIMARY KEY
    CONSTRAINT deleted_user_tombstones_user_key_hash_valid
      CHECK (user_key_hash ~ '^[0-9a-f]{64}$'),
  deleted_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS user_controls (
  clerk_user_id text PRIMARY KEY
    CONSTRAINT user_controls_clerk_user_id_length
      CHECK (char_length(clerk_user_id) BETWEEN 3 AND 255),

  suspended boolean NOT NULL DEFAULT false,
  blocked_until timestamptz,
  reason_code text
    CONSTRAINT user_controls_reason_code_length
      CHECK (reason_code IS NULL OR char_length(reason_code) BETWEEN 1 AND 80),

  daily_game_limit integer
    CONSTRAINT user_controls_daily_game_limit_positive
      CHECK (daily_game_limit IS NULL OR daily_game_limit > 0),
  daily_model_request_limit integer
    CONSTRAINT user_controls_daily_model_request_limit_positive
      CHECK (
        daily_model_request_limit IS NULL
        OR daily_model_request_limit > 0
      ),
  hourly_model_request_limit integer
    CONSTRAINT user_controls_hourly_model_request_limit_positive
      CHECK (
        hourly_model_request_limit IS NULL
        OR hourly_model_request_limit > 0
      ),
  concurrent_model_limit smallint
    CONSTRAINT user_controls_concurrent_model_limit_range
      CHECK (
        concurrent_model_limit IS NULL
        OR concurrent_model_limit BETWEEN 1 AND 4
      ),

  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL
    REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE,

  source_game_id uuid REFERENCES games(id) ON DELETE SET NULL,
  is_current boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL DEFAULT 0
    CONSTRAINT games_revision_nonnegative CHECK (revision >= 0),

  status text NOT NULL
    CONSTRAINT games_status_valid
      CHECK (
        status IN (
          'dividing',
          'division_failed',
          'mapped',
          'playing',
          'completed',
          'answering',
          'answer_failed',
          'answered',
          'abandoned',
          'integrity_error'
        )
      ),

  problem text NOT NULL
    CONSTRAINT games_problem_length
      CHECK (char_length(problem) BETWEEN 12 AND 240),
  problem_sha256 char(64) NOT NULL
    CONSTRAINT games_problem_sha256_valid
      CHECK (problem_sha256 ~ '^[0-9a-f]{64}$'),

  division_seed text
    CONSTRAINT games_division_seed_length
      CHECK (
        division_seed IS NULL
        OR char_length(division_seed) BETWEEN 1 AND 512
      ),
  division_facets jsonb,
  problem_parts jsonb,
  division_model text
    CONSTRAINT games_division_model_length
      CHECK (
        division_model IS NULL
        OR char_length(division_model) BETWEEN 1 AND 120
      ),
  division_prompt_version text
    CONSTRAINT games_division_prompt_version_length
      CHECK (
        division_prompt_version IS NULL
        OR char_length(division_prompt_version) BETWEEN 1 AND 80
      ),
  division_prompt_sha256 char(64)
    CONSTRAINT games_division_prompt_sha256_valid
      CHECK (
        division_prompt_sha256 IS NULL
        OR division_prompt_sha256 ~ '^[0-9a-f]{64}$'
      ),
  division_digest char(64)
    CONSTRAINT games_division_digest_valid
      CHECK (
        division_digest IS NULL
        OR division_digest ~ '^[0-9a-f]{64}$'
      ),

  rules_version text NOT NULL
    CONSTRAINT games_rules_version_length
      CHECK (char_length(rules_version) BETWEEN 1 AND 80),
  engine_version text NOT NULL
    CONSTRAINT games_engine_version_length
      CHECK (char_length(engine_version) BETWEEN 1 AND 80),
  cast_version text NOT NULL
    CONSTRAINT games_cast_version_length
      CHECK (char_length(cast_version) BETWEEN 1 AND 80),
  event_version smallint NOT NULL
    CONSTRAINT games_event_version_positive
      CHECK (event_version > 0),
  software_version text NOT NULL
    CONSTRAINT games_software_version_length
      CHECK (char_length(software_version) BETWEEN 1 AND 120),

  outcome jsonb,
  answer_payload jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  answered_at timestamptz,

  CONSTRAINT games_division_facets_shape
    CHECK (
      division_facets IS NULL
      OR (
        jsonb_typeof(division_facets) = 'array'
        AND jsonb_array_length(division_facets) = 64
      )
    ),
  CONSTRAINT games_problem_parts_shape
    CHECK (
      problem_parts IS NULL
      OR (
        jsonb_typeof(problem_parts) = 'array'
        AND jsonb_array_length(problem_parts) = 64
      )
    ),
  CONSTRAINT games_outcome_shape
    CHECK (
      outcome IS NULL
      OR jsonb_typeof(outcome) = 'object'
    ),
  CONSTRAINT games_answer_payload_shape
    CHECK (
      answer_payload IS NULL
      OR jsonb_typeof(answer_payload) = 'object'
    ),
  CONSTRAINT games_division_required_after_dividing
    CHECK (
      status IN ('dividing', 'division_failed')
      OR (
        status = 'abandoned'
        AND division_seed IS NULL
        AND division_facets IS NULL
        AND problem_parts IS NULL
        AND division_model IS NULL
        AND division_prompt_version IS NULL
        AND division_prompt_sha256 IS NULL
        AND division_digest IS NULL
        AND outcome IS NULL
        AND answer_payload IS NULL
        AND completed_at IS NULL
        AND answered_at IS NULL
      )
      OR (
        division_seed IS NOT NULL
        AND division_facets IS NOT NULL
        AND problem_parts IS NOT NULL
        AND division_model IS NOT NULL
        AND division_prompt_version IS NOT NULL
        AND division_prompt_sha256 IS NOT NULL
        AND division_digest IS NOT NULL
      )
    ),
  CONSTRAINT games_outcome_required_after_completion
    CHECK (
      status NOT IN ('completed', 'answering', 'answer_failed', 'answered')
      OR outcome IS NOT NULL
    ),
  CONSTRAINT games_answer_required_when_answered
    CHECK (
      status <> 'answered'
      OR answer_payload IS NOT NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS games_one_current_per_user
  ON games (clerk_user_id)
  WHERE is_current;

CREATE INDEX IF NOT EXISTS games_owner_created
  ON games (clerk_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_events (
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply smallint NOT NULL
    CONSTRAINT game_events_ply_range CHECK (ply BETWEEN 1 AND 256),

  kind text NOT NULL
    CONSTRAINT game_events_kind_valid CHECK (kind IN ('move', 'pass')),
  source text NOT NULL
    CONSTRAINT game_events_source_valid CHECK (source IN ('client', 'server')),
  side text NOT NULL
    CONSTRAINT game_events_side_valid CHECK (side IN ('white', 'black')),

  piece_id text
    CONSTRAINT game_events_piece_id_length
      CHECK (
        piece_id IS NULL
        OR char_length(piece_id) BETWEEN 1 AND 80
      ),
  captured_piece_id text
    CONSTRAINT game_events_captured_piece_id_length
      CHECK (
        captured_piece_id IS NULL
        OR char_length(captured_piece_id) BETWEEN 1 AND 80
      ),
  promoted_to text
    CONSTRAINT game_events_promoted_to_valid
      CHECK (promoted_to IS NULL OR promoted_to = 'queen'),
  from_ring smallint,
  from_sector smallint,
  to_ring smallint,
  to_sector smallint,

  idempotency_key uuid,
  request_sha256 char(64),
  game_revision bigint NOT NULL
    CONSTRAINT game_events_revision_positive CHECK (game_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (game_id, ply),
  UNIQUE (game_id, idempotency_key),

  CONSTRAINT game_events_move_or_pass_shape
    CHECK (
      (
        kind = 'move'
        AND piece_id IS NOT NULL
        AND from_ring IS NOT NULL
        AND from_ring BETWEEN 0 AND 7
        AND from_sector IS NOT NULL
        AND from_sector BETWEEN 0 AND 7
        AND to_ring IS NOT NULL
        AND to_ring BETWEEN 0 AND 7
        AND to_sector IS NOT NULL
        AND to_sector BETWEEN 0 AND 7
      )
      OR (
        kind = 'pass'
        AND piece_id IS NULL
        AND captured_piece_id IS NULL
        AND promoted_to IS NULL
        AND from_ring IS NULL
        AND from_sector IS NULL
        AND to_ring IS NULL
        AND to_sector IS NULL
      )
    ),
  CONSTRAINT game_events_source_integrity
    CHECK (
      (
        source = 'client'
        AND kind = 'move'
        AND idempotency_key IS NOT NULL
        AND request_sha256 IS NOT NULL
        AND request_sha256 ~ '^[0-9a-f]{64}$'
      )
      OR (
        source = 'server'
        AND kind = 'pass'
        AND idempotency_key IS NULL
        AND request_sha256 IS NULL
      )
    )
);

CREATE TABLE IF NOT EXISTS model_requests (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL
    REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE,
  game_id uuid REFERENCES games(id) ON DELETE SET NULL,

  operation text NOT NULL
    CONSTRAINT model_requests_operation_valid
      CHECK (operation IN ('division', 'answer')),
  idempotency_key uuid NOT NULL,
  request_sha256 char(64) NOT NULL
    CONSTRAINT model_requests_request_sha256_valid
      CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),

  status text NOT NULL
    CONSTRAINT model_requests_status_valid
      CHECK (
        status IN (
          'reserved',
          'in_progress',
          'succeeded',
          'failed',
          'rejected',
          'indeterminate'
        )
      ),
  attempt smallint NOT NULL DEFAULT 1
    CONSTRAINT model_requests_attempt_positive CHECK (attempt > 0),

  provider text NOT NULL DEFAULT 'openai'
    CONSTRAINT model_requests_provider_length
      CHECK (char_length(provider) BETWEEN 1 AND 40),
  model text NOT NULL
    CONSTRAINT model_requests_model_length
      CHECK (char_length(model) BETWEEN 1 AND 120),
  prompt_version text NOT NULL
    CONSTRAINT model_requests_prompt_version_length
      CHECK (char_length(prompt_version) BETWEEN 1 AND 80),
  software_version text NOT NULL
    CONSTRAINT model_requests_software_version_length
      CHECK (char_length(software_version) BETWEEN 1 AND 120),

  provider_response_id text
    CONSTRAINT model_requests_provider_response_id_length
      CHECK (
        provider_response_id IS NULL
        OR char_length(provider_response_id) BETWEEN 1 AND 255
      ),
  response_sha256 char(64)
    CONSTRAINT model_requests_response_sha256_valid
      CHECK (
        response_sha256 IS NULL
        OR response_sha256 ~ '^[0-9a-f]{64}$'
      ),
  result_payload jsonb,

  usage_reported boolean NOT NULL DEFAULT false,
  input_tokens bigint
    CONSTRAINT model_requests_input_tokens_nonnegative
      CHECK (input_tokens IS NULL OR input_tokens >= 0),
  cached_input_tokens bigint
    CONSTRAINT model_requests_cached_input_tokens_nonnegative
      CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  cache_write_input_tokens bigint
    CONSTRAINT model_requests_cache_write_input_tokens_nonnegative
      CHECK (
        cache_write_input_tokens IS NULL
        OR cache_write_input_tokens >= 0
      ),
  output_tokens bigint
    CONSTRAINT model_requests_output_tokens_nonnegative
      CHECK (output_tokens IS NULL OR output_tokens >= 0),
  reasoning_tokens bigint
    CONSTRAINT model_requests_reasoning_tokens_nonnegative
      CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
  total_tokens bigint
    CONSTRAINT model_requests_total_tokens_nonnegative
      CHECK (total_tokens IS NULL OR total_tokens >= 0),

  provider_started_at timestamptz,
  completed_at timestamptz,
  failure_code text
    CONSTRAINT model_requests_failure_code_length
      CHECK (
        failure_code IS NULL
        OR char_length(failure_code) BETWEEN 1 AND 80
      ),
  provider_http_status smallint
    CONSTRAINT model_requests_provider_http_status_range
      CHECK (
        provider_http_status IS NULL
        OR provider_http_status BETWEEN 100 AND 599
      ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (clerk_user_id, operation, idempotency_key),
  CONSTRAINT model_requests_result_payload_matches_status
    CHECK (
      (
        status = 'succeeded'
        AND result_payload IS NOT NULL
        AND jsonb_typeof(result_payload) = 'object'
      )
      OR (
        status <> 'succeeded'
        AND result_payload IS NULL
      )
    ),
  CONSTRAINT model_requests_usage_fields_match_reported
    CHECK (
      (
        usage_reported
        AND input_tokens IS NOT NULL
        AND cached_input_tokens IS NOT NULL
        AND cache_write_input_tokens IS NOT NULL
        AND output_tokens IS NOT NULL
        AND reasoning_tokens IS NOT NULL
        AND total_tokens IS NOT NULL
      )
      OR (
        NOT usage_reported
        AND input_tokens IS NULL
        AND cached_input_tokens IS NULL
        AND cache_write_input_tokens IS NULL
        AND output_tokens IS NULL
        AND reasoning_tokens IS NULL
        AND total_tokens IS NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS model_requests_owner_time
  ON model_requests (clerk_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS model_requests_game
  ON model_requests (game_id, operation, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS model_requests_one_succeeded_operation_per_game
  ON model_requests (game_id, operation)
  WHERE game_id IS NOT NULL
    AND status = 'succeeded';

CREATE TABLE IF NOT EXISTS game_start_requests (
  idempotency_key uuid PRIMARY KEY,
  clerk_user_id text NOT NULL
    REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE,
  kind text NOT NULL
    CONSTRAINT game_start_requests_kind_valid CHECK (kind = 'replay'),
  source_game_id uuid NOT NULL,
  expected_revision bigint NOT NULL
    CONSTRAINT game_start_requests_expected_revision_nonnegative
      CHECK (expected_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz
);

CREATE INDEX IF NOT EXISTS game_start_requests_owner_time
  ON game_start_requests (clerk_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_buckets (
  subject_type text NOT NULL
    CONSTRAINT usage_buckets_subject_type_valid
      CHECK (subject_type IN ('user', 'global')),
  subject_key text NOT NULL
    CONSTRAINT usage_buckets_subject_key_length
      CHECK (char_length(subject_key) BETWEEN 1 AND 255),
  metric text NOT NULL
    CONSTRAINT usage_buckets_metric_valid
      CHECK (metric IN ('game_starts', 'model_requests')),
  bucket_start timestamptz NOT NULL,
  bucket_seconds integer NOT NULL
    CONSTRAINT usage_buckets_bucket_seconds_positive
      CHECK (bucket_seconds > 0),
  used bigint NOT NULL DEFAULT 0
    CONSTRAINT usage_buckets_used_nonnegative CHECK (used >= 0),
  reserved bigint NOT NULL DEFAULT 0
    CONSTRAINT usage_buckets_reserved_nonnegative CHECK (reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (
    subject_type,
    subject_key,
    metric,
    bucket_start,
    bucket_seconds
  )
);

CREATE INDEX IF NOT EXISTS usage_buckets_updated
  ON usage_buckets (updated_at);

CREATE TABLE IF NOT EXISTS rate_buckets (
  key_type text NOT NULL
    CONSTRAINT rate_buckets_key_type_valid
      CHECK (key_type IN ('user', 'ip')),
  key_hash char(64) NOT NULL
    CONSTRAINT rate_buckets_key_hash_valid
      CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  action text NOT NULL
    CONSTRAINT rate_buckets_action_valid
      CHECK (
        action IN (
          'model',
          'division',
          'answer',
          'game_start',
          'game_move',
          'account_export'
        )
      ),
  window_start timestamptz NOT NULL,
  window_seconds integer NOT NULL
    CONSTRAINT rate_buckets_window_seconds_positive
      CHECK (window_seconds > 0),
  count integer NOT NULL DEFAULT 0
    CONSTRAINT rate_buckets_count_nonnegative CHECK (count >= 0),
  expires_at timestamptz NOT NULL,

  PRIMARY KEY (
    key_type,
    key_hash,
    action,
    window_start,
    window_seconds
  ),
  CONSTRAINT rate_buckets_expiry_after_window
    CHECK (
      expires_at >= window_start + make_interval(secs => window_seconds)
    )
);

CREATE INDEX IF NOT EXISTS rate_buckets_expiry
  ON rate_buckets (expires_at);

CREATE TABLE IF NOT EXISTS model_concurrency_slots (
  slot smallint PRIMARY KEY
    CONSTRAINT model_concurrency_slots_slot_range
      CHECK (slot BETWEEN 1 AND 4),
  enabled boolean NOT NULL DEFAULT true,

  request_id uuid UNIQUE REFERENCES model_requests(id),
  clerk_user_id text UNIQUE REFERENCES user_controls(clerk_user_id),
  lease_token uuid,
  lease_expires_at timestamptz,

  CONSTRAINT model_concurrency_slots_lease_shape
    CHECK (
      (
        request_id IS NULL
        AND clerk_user_id IS NULL
        AND lease_token IS NULL
        AND lease_expires_at IS NULL
      )
      OR (
        request_id IS NOT NULL
        AND clerk_user_id IS NOT NULL
        AND lease_token IS NOT NULL
        AND lease_expires_at IS NOT NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS model_concurrency_slots_expiry
  ON model_concurrency_slots (lease_expires_at)
  WHERE request_id IS NOT NULL;

INSERT INTO model_concurrency_slots (slot)
VALUES (1), (2), (3), (4)
ON CONFLICT (slot) DO NOTHING;
