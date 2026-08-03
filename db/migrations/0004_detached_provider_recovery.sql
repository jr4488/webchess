-- Provider work is durable once its fenced model request begins. Earlier
-- WebChess 2.0 builds still coupled that work to the browser request signal,
-- so navigation or a local launcher restart could consume the bounded Portia
-- failure budget even though no semantic review result had been produced.
--
-- Preserve every request, progress draft, and lifecycle event. Grant only
-- unfinished v2 Portia runs a fresh bounded technical budget so the detached
-- provider execution can finish them. Terminal and completed runs are never
-- rewritten.
UPDATE lifecycle_runs AS runs
SET portia_failed_attempt_count = 0,
    updated_at = now()
WHERE runs.state IN ('portia_pending', 'portia_running')
  AND runs.portia_prompt_version = 'webchess-portia-v2'
  AND runs.portia_failed_attempt_count > 0
  AND NOT EXISTS (
    SELECT 1
    FROM portia_reviews AS reviews
    WHERE reviews.lifecycle_run_id = runs.id
  );
