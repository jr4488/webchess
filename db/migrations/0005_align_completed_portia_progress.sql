-- Portia traverses survivors in a scrutiny order that is intentionally
-- different from the persisted board order. Early v2 completion code replaced
-- only the completed candidate IDs with board-order IDs while retaining the
-- assessment drafts in traversal order. Repair those completed v2 artifacts
-- from their immutable review so the visible progress and review stay aligned.
UPDATE lifecycle_runs AS runs
SET portia_completed_candidate_ids = (
      SELECT coalesce(
        jsonb_agg(assessment->>'candidateId' ORDER BY position),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(reviews.review->'assessments')
        WITH ORDINALITY AS completed(assessment, position)
    ),
    portia_assessment_drafts = reviews.review->'assessments',
    updated_at = now()
FROM portia_reviews AS reviews
WHERE reviews.lifecycle_run_id = runs.id
  AND runs.portia_contract_version = 'webchess-portia-review-v2'
  AND jsonb_typeof(reviews.review->'assessments') = 'array'
  AND reviews.review->>'contractVersion' = 'webchess-portia-review-v2'
  AND (
    runs.portia_completed_candidate_ids IS DISTINCT FROM (
      SELECT coalesce(
        jsonb_agg(assessment->>'candidateId' ORDER BY position),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(reviews.review->'assessments')
        WITH ORDINALITY AS completed(assessment, position)
    )
    OR runs.portia_assessment_drafts IS DISTINCT FROM reviews.review->'assessments'
  );
