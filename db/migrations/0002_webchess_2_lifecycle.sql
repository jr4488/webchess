ALTER TABLE model_requests
  DROP CONSTRAINT IF EXISTS model_requests_operation_valid;

ALTER TABLE model_requests
  ADD CONSTRAINT model_requests_operation_valid
    CHECK (operation IN ('division', 'answer', 'portia', 'charlotte'));

ALTER TABLE rate_buckets
  DROP CONSTRAINT IF EXISTS rate_buckets_action_valid;

ALTER TABLE rate_buckets
  ADD CONSTRAINT rate_buckets_action_valid
    CHECK (
      action IN (
        'model',
        'division',
        'answer',
        'portia',
        'charlotte',
        'game_start',
        'game_move',
        'account_export',
        'wilbur_action',
        'wilbur_observation'
      )
    );

CREATE TABLE IF NOT EXISTS lifecycle_runs (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL
    REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE,
  game_id uuid NOT NULL UNIQUE
    REFERENCES games(id) ON DELETE CASCADE,
  root_run_id uuid NOT NULL
    REFERENCES lifecycle_runs(id) ON DELETE CASCADE,
  parent_run_id uuid
    REFERENCES lifecycle_runs(id) ON DELETE SET NULL,

  state text NOT NULL
    CONSTRAINT lifecycle_runs_state_valid
      CHECK (
        state IN (
          'anansi_pending',
          'anansi_running',
          'field_ready',
          'chess_ready',
          'chess_playing',
          'chess_terminal',
          'portia_pending',
          'portia_running',
          'portia_complete',
          'gate_passed',
          'gate_failed',
          'retry_ready',
          'retry_running',
          'charlotte_pending',
          'charlotte_running',
          'charlotte_complete',
          'wilbur_planning',
          'wilbur_in_progress',
          'wilbur_observed',
          'insufficient_basis',
          'abandoned'
        )
      ),
  revision bigint NOT NULL DEFAULT 0
    CONSTRAINT lifecycle_runs_revision_nonnegative CHECK (revision >= 0),
  field_generation smallint NOT NULL DEFAULT 1
    CONSTRAINT lifecycle_runs_field_generation_positive
      CHECK (field_generation >= 1),
  game_attempt smallint NOT NULL DEFAULT 1
    CONSTRAINT lifecycle_runs_game_attempt_positive CHECK (game_attempt >= 1),
  same_field_retry_count smallint NOT NULL DEFAULT 0
    CONSTRAINT lifecycle_runs_same_field_retry_count_bounded
      CHECK (same_field_retry_count BETWEEN 0 AND 2),
  field_regeneration_count smallint NOT NULL DEFAULT 0
    CONSTRAINT lifecycle_runs_field_regeneration_count_bounded
      CHECK (field_regeneration_count BETWEEN 0 AND 1),

  division_seed text NOT NULL
    CONSTRAINT lifecycle_runs_division_seed_length
      CHECK (char_length(division_seed) BETWEEN 1 AND 512),
  cast_seed text NOT NULL
    CONSTRAINT lifecycle_runs_cast_seed_length
      CHECK (char_length(cast_seed) BETWEEN 1 AND 512),
  trajectory_seed text NOT NULL
    CONSTRAINT lifecycle_runs_trajectory_seed_length
      CHECK (char_length(trajectory_seed) BETWEEN 1 AND 512),
  retry_reason text
    CONSTRAINT lifecycle_runs_retry_reason_length
      CHECK (retry_reason IS NULL OR char_length(retry_reason) BETWEEN 8 AND 2000),
  terminal_fingerprint char(64)
    CONSTRAINT lifecycle_runs_terminal_fingerprint_valid
      CHECK (
        terminal_fingerprint IS NULL
        OR terminal_fingerprint ~ '^[0-9a-f]{64}$'
      ),
  survivor_set jsonb,

  software_version text NOT NULL,
  lifecycle_version text NOT NULL,
  rules_version text NOT NULL,
  engine_version text NOT NULL,
  cast_version text NOT NULL,
  event_version smallint NOT NULL
    CONSTRAINT lifecycle_runs_event_version_positive CHECK (event_version > 0),
  portia_prompt_version text NOT NULL,
  portia_contract_version text NOT NULL,
  gate_algorithm_version text NOT NULL,
  retry_policy_version text NOT NULL,
  charlotte_prompt_version text NOT NULL,
  charlotte_contract_version text NOT NULL,
  wilbur_record_version text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lifecycle_runs_version_lengths CHECK (
    char_length(software_version) BETWEEN 1 AND 120
    AND char_length(lifecycle_version) BETWEEN 1 AND 80
    AND char_length(rules_version) BETWEEN 1 AND 80
    AND char_length(engine_version) BETWEEN 1 AND 80
    AND char_length(cast_version) BETWEEN 1 AND 80
    AND char_length(portia_prompt_version) BETWEEN 1 AND 80
    AND char_length(portia_contract_version) BETWEEN 1 AND 80
    AND char_length(gate_algorithm_version) BETWEEN 1 AND 80
    AND char_length(retry_policy_version) BETWEEN 1 AND 80
    AND char_length(charlotte_prompt_version) BETWEEN 1 AND 80
    AND char_length(charlotte_contract_version) BETWEEN 1 AND 80
    AND char_length(wilbur_record_version) BETWEEN 1 AND 80
  ),
  CONSTRAINT lifecycle_runs_survivor_set_shape CHECK (
    survivor_set IS NULL OR jsonb_typeof(survivor_set) = 'array'
  ),
  UNIQUE (root_run_id, field_generation, game_attempt)
);

CREATE INDEX IF NOT EXISTS lifecycle_runs_owner_created
  ON lifecycle_runs (clerk_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS lifecycle_runs_parent
  ON lifecycle_runs (parent_run_id);

CREATE TABLE IF NOT EXISTS portia_reviews (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL
    REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE,
  lifecycle_run_id uuid NOT NULL UNIQUE
    REFERENCES lifecycle_runs(id) ON DELETE CASCADE,
  model_request_id uuid NOT NULL UNIQUE
    REFERENCES model_requests(id) ON DELETE RESTRICT,
  input_digest char(64) NOT NULL
    CONSTRAINT portia_reviews_input_digest_valid
      CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  output_digest char(64) NOT NULL
    CONSTRAINT portia_reviews_output_digest_valid
      CHECK (output_digest ~ '^[0-9a-f]{64}$'),
  prompt_version text NOT NULL
    CONSTRAINT portia_reviews_prompt_version_length
      CHECK (char_length(prompt_version) BETWEEN 1 AND 80),
  contract_version text NOT NULL
    CONSTRAINT portia_reviews_contract_version_length
      CHECK (char_length(contract_version) BETWEEN 1 AND 80),
  review jsonb NOT NULL
    CONSTRAINT portia_reviews_review_shape
      CHECK (jsonb_typeof(review) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gate_decisions (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL
    REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE,
  lifecycle_run_id uuid NOT NULL UNIQUE
    REFERENCES lifecycle_runs(id) ON DELETE CASCADE,
  algorithm_version text NOT NULL
    CONSTRAINT gate_decisions_algorithm_version_length
      CHECK (char_length(algorithm_version) BETWEEN 1 AND 80),
  input_digest char(64) NOT NULL
    CONSTRAINT gate_decisions_input_digest_valid
      CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  passed boolean NOT NULL,
  result jsonb NOT NULL
    CONSTRAINT gate_decisions_result_shape
      CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS charlotte_results (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL
    REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE,
  lifecycle_run_id uuid NOT NULL UNIQUE
    REFERENCES lifecycle_runs(id) ON DELETE CASCADE,
  model_request_id uuid NOT NULL UNIQUE
    REFERENCES model_requests(id) ON DELETE RESTRICT,
  input_digest char(64) NOT NULL
    CONSTRAINT charlotte_results_input_digest_valid
      CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  output_digest char(64) NOT NULL
    CONSTRAINT charlotte_results_output_digest_valid
      CHECK (output_digest ~ '^[0-9a-f]{64}$'),
  prompt_version text NOT NULL
    CONSTRAINT charlotte_results_prompt_version_length
      CHECK (char_length(prompt_version) BETWEEN 1 AND 80),
  contract_version text NOT NULL
    CONSTRAINT charlotte_results_contract_version_length
      CHECK (char_length(contract_version) BETWEEN 1 AND 80),
  result jsonb NOT NULL
    CONSTRAINT charlotte_results_result_shape
      CHECK (jsonb_typeof(result) = 'object'),
  rendered_answer text NOT NULL
    CONSTRAINT charlotte_results_rendered_answer_length
      CHECK (char_length(rendered_answer) BETWEEN 100 AND 20000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wilbur_actions (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL
    REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE,
  lifecycle_run_id uuid NOT NULL
    REFERENCES lifecycle_runs(id) ON DELETE CASCADE,
  charlotte_action_index smallint
    CONSTRAINT wilbur_actions_charlotte_action_index_valid
      CHECK (
        charlotte_action_index IS NULL
        OR charlotte_action_index BETWEEN 0 AND 2
      ),
  idempotency_key uuid NOT NULL,
  request_digest char(64) NOT NULL
    CONSTRAINT wilbur_actions_request_digest_valid
      CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  actor text NOT NULL,
  action text NOT NULL,
  tested_assumption text NOT NULL,
  expected_observation text NOT NULL,
  decision_threshold text NOT NULL,
  review_horizon text NOT NULL,
  status text NOT NULL
    CONSTRAINT wilbur_actions_status_valid
      CHECK (
        status IN (
          'planned',
          'in_progress',
          'completed',
          'abandoned',
          'inconclusive'
        )
      ),
  revision bigint NOT NULL DEFAULT 0
    CONSTRAINT wilbur_actions_revision_nonnegative CHECK (revision >= 0),
  record_version text NOT NULL
    CONSTRAINT wilbur_actions_record_version_length
      CHECK (char_length(record_version) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wilbur_actions_text_lengths CHECK (
    char_length(actor) BETWEEN 2 AND 240
    AND char_length(action) BETWEEN 8 AND 2000
    AND char_length(tested_assumption) BETWEEN 8 AND 1000
    AND char_length(expected_observation) BETWEEN 8 AND 1000
    AND char_length(decision_threshold) BETWEEN 8 AND 1000
    AND char_length(review_horizon) BETWEEN 2 AND 240
  ),
  UNIQUE (clerk_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS wilbur_actions_run_created
  ON wilbur_actions (lifecycle_run_id, created_at);

CREATE TABLE IF NOT EXISTS wilbur_observations (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL
    REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE,
  action_id uuid NOT NULL
    REFERENCES wilbur_actions(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  request_digest char(64) NOT NULL
    CONSTRAINT wilbur_observations_request_digest_valid
      CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  observation text NOT NULL,
  evidence_classification text NOT NULL,
  expected_effect text NOT NULL,
  unexpected_effect text NOT NULL,
  stakeholder_response text NOT NULL,
  assumption_result text NOT NULL
    CONSTRAINT wilbur_observations_assumption_result_valid
      CHECK (assumption_result IN ('supported', 'rejected', 'unresolved')),
  next_decision text NOT NULL,
  record_version text NOT NULL
    CONSTRAINT wilbur_observations_record_version_length
      CHECK (char_length(record_version) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wilbur_observations_text_lengths CHECK (
    char_length(observation) BETWEEN 3 AND 4000
    AND char_length(evidence_classification) BETWEEN 3 AND 240
    AND char_length(expected_effect) BETWEEN 1 AND 2000
    AND char_length(unexpected_effect) BETWEEN 1 AND 2000
    AND char_length(stakeholder_response) BETWEEN 1 AND 2000
    AND char_length(next_decision) BETWEEN 3 AND 2000
  ),
  UNIQUE (action_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS wilbur_observations_action_created
  ON wilbur_observations (action_id, created_at);

CREATE TABLE IF NOT EXISTS lifecycle_events (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL
    REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE,
  lifecycle_run_id uuid NOT NULL
    REFERENCES lifecycle_runs(id) ON DELETE CASCADE,
  sequence bigint NOT NULL
    CONSTRAINT lifecycle_events_sequence_positive CHECK (sequence >= 1),
  stage text NOT NULL
    CONSTRAINT lifecycle_events_stage_length
      CHECK (char_length(stage) BETWEEN 1 AND 40),
  activity_type text NOT NULL
    CONSTRAINT lifecycle_events_activity_type_length
      CHECK (char_length(activity_type) BETWEEN 1 AND 80),
  state_from text,
  state_to text NOT NULL,
  input_entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  responsible_agent_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  configuration_digest char(64) NOT NULL
    CONSTRAINT lifecycle_events_configuration_digest_valid
      CHECK (configuration_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL
    CONSTRAINT lifecycle_events_status_valid
      CHECK (status IN ('started', 'completed', 'failed', 'refused')),
  event_version smallint NOT NULL
    CONSTRAINT lifecycle_events_event_version_positive CHECK (event_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lifecycle_events_entity_shapes CHECK (
    jsonb_typeof(input_entity_ids) = 'array'
    AND jsonb_typeof(output_entity_ids) = 'array'
    AND jsonb_typeof(responsible_agent_ids) = 'array'
  ),
  UNIQUE (lifecycle_run_id, sequence)
);

CREATE INDEX IF NOT EXISTS lifecycle_events_owner_created
  ON lifecycle_events (clerk_user_id, created_at DESC);
