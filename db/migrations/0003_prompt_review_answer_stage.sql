ALTER TABLE lifecycle_runs
  DROP CONSTRAINT IF EXISTS lifecycle_runs_state_valid;

ALTER TABLE lifecycle_runs
  ADD CONSTRAINT lifecycle_runs_state_valid
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
        'portia_unavailable',
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
    );

ALTER TABLE lifecycle_runs
  ADD COLUMN IF NOT EXISTS answer_prompt_digest char(64),
  ADD COLUMN IF NOT EXISTS portia_current_candidate_id text,
  ADD COLUMN IF NOT EXISTS portia_active_model_request_id uuid
    REFERENCES model_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portia_failed_attempt_count smallint
    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS portia_failure_limit smallint
    NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS portia_completed_candidate_ids jsonb
    NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS portia_assessment_drafts jsonb
    NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE lifecycle_runs
  DROP CONSTRAINT IF EXISTS lifecycle_runs_answer_prompt_digest_valid;

ALTER TABLE lifecycle_runs
  ADD CONSTRAINT lifecycle_runs_answer_prompt_digest_valid
    CHECK (
      answer_prompt_digest IS NULL
      OR answer_prompt_digest ~ '^[0-9a-f]{64}$'
    );

ALTER TABLE lifecycle_runs
  DROP CONSTRAINT IF EXISTS lifecycle_runs_portia_progress_shape;

ALTER TABLE lifecycle_runs
  ADD CONSTRAINT lifecycle_runs_portia_progress_shape
    CHECK (
      jsonb_typeof(portia_completed_candidate_ids) = 'array'
      AND jsonb_typeof(portia_assessment_drafts) = 'array'
      AND portia_failure_limit BETWEEN 1 AND 10
      AND portia_failed_attempt_count BETWEEN 0 AND portia_failure_limit
      AND (
        portia_current_candidate_id IS NULL
        OR char_length(portia_current_candidate_id) BETWEEN 3 AND 220
      )
    );

-- A v1 review proves that its survivor traversal completed, but it does not
-- prove that any answer prompt was reviewed. Backfill only the visible
-- traversal markers; keep the prompt digest and v2 assessment drafts empty.
UPDATE lifecycle_runs AS runs
SET portia_completed_candidate_ids = (
  SELECT coalesce(jsonb_agg(candidate->>'candidateId'), '[]'::jsonb)
  FROM jsonb_array_elements(runs.survivor_set) AS candidate
),
updated_at = now()
WHERE jsonb_array_length(runs.portia_completed_candidate_ids) = 0
  AND EXISTS (
    SELECT 1 FROM portia_reviews AS reviews
    WHERE reviews.lifecycle_run_id = runs.id
  );

-- Prompt changes are safe only before their corresponding immutable result
-- exists. Completed v1 artifacts retain their recorded versions.
UPDATE lifecycle_runs AS runs
SET portia_prompt_version = 'webchess-portia-v2',
    portia_contract_version = 'webchess-portia-review-v2',
    gate_algorithm_version = 'webchess-gate-v2',
    lifecycle_version = 'webchess-lifecycle-v2.1',
    updated_at = now()
WHERE NOT EXISTS (
  SELECT 1 FROM portia_reviews AS reviews
  WHERE reviews.lifecycle_run_id = runs.id
);

UPDATE lifecycle_runs AS runs
SET charlotte_prompt_version = 'webchess-charlotte-v3',
    lifecycle_version = 'webchess-lifecycle-v2.1',
    updated_at = now()
WHERE NOT EXISTS (
  SELECT 1 FROM charlotte_results AS results
  WHERE results.lifecycle_run_id = runs.id
);
