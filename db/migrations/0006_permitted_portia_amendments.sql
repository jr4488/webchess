-- A permitted v3 Portia review carries its exact prompt amendments forward to
-- answer generation. Update only runs that have no immutable Portia artifact;
-- completed v2 reviews and Gate decisions retain their recorded semantics.
UPDATE lifecycle_runs AS runs
SET lifecycle_version = 'webchess-lifecycle-v2.2',
    portia_prompt_version = 'webchess-portia-v3',
    gate_algorithm_version = 'webchess-gate-v3',
    updated_at = now()
WHERE NOT EXISTS (
  SELECT 1
  FROM portia_reviews AS reviews
  WHERE reviews.lifecycle_run_id = runs.id
);
