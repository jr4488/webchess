-- Charlotte provider execution is resumable but must not retry forever. Bind
-- each running qualification to the exact durable model request and persist a
-- three-attempt technical failure budget, matching Portia's request fence.
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
        'charlotte_unavailable',
        'charlotte_complete',
        'wilbur_planning',
        'wilbur_in_progress',
        'wilbur_observed',
        'insufficient_basis',
        'abandoned'
      )
    );

ALTER TABLE lifecycle_runs
  ADD COLUMN IF NOT EXISTS charlotte_active_model_request_id uuid
    REFERENCES model_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS charlotte_failed_attempt_count smallint
    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS charlotte_failure_limit smallint
    NOT NULL DEFAULT 3;

-- Preserve every historical model request and every immutable Charlotte
-- result. Runs that have not produced a result start one fresh bounded budget
-- under the corrected current prompt. A formerly running v3 request remains
-- in the request ledger, but it no longer owns the upgraded lifecycle run.
UPDATE lifecycle_runs AS runs
SET state = CASE
      WHEN runs.state = 'charlotte_running' THEN 'charlotte_pending'
      ELSE runs.state
    END,
    charlotte_active_model_request_id = NULL,
    charlotte_failed_attempt_count = 0,
    charlotte_failure_limit = 3,
    lifecycle_version = 'webchess-lifecycle-v2.3',
    charlotte_prompt_version = 'webchess-charlotte-v4',
    updated_at = now()
WHERE runs.state IN (
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
    'charlotte_pending',
    'charlotte_running'
  )
  AND NOT EXISTS (
  SELECT 1
  FROM charlotte_results AS results
  WHERE results.lifecycle_run_id = runs.id
);

ALTER TABLE lifecycle_runs
  DROP CONSTRAINT IF EXISTS lifecycle_runs_charlotte_attempt_fence;

ALTER TABLE lifecycle_runs
  ADD CONSTRAINT lifecycle_runs_charlotte_attempt_fence
    CHECK (
      charlotte_failure_limit BETWEEN 1 AND 10
      AND charlotte_failed_attempt_count BETWEEN 0 AND charlotte_failure_limit
      AND (
        charlotte_active_model_request_id IS NULL
        OR state = 'charlotte_running'
      )
      AND (
        state <> 'charlotte_unavailable'
        OR (
          charlotte_active_model_request_id IS NULL
          AND charlotte_failed_attempt_count = charlotte_failure_limit
        )
      )
    );
