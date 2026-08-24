-- Research transmission is a per-game, versioned choice. Historical games
-- are conservatively backfilled as having no recorded consent and therefore
-- cannot trigger search or page retrieval.
ALTER TABLE games
  ADD COLUMN research_consent_version text NOT NULL
    DEFAULT 'legacy-no-research-consent-v0',
  ADD COLUMN research_consent_decision text NOT NULL
    DEFAULT 'no_external_research',
  ADD COLUMN research_consent_recorded_at timestamptz;

ALTER TABLE games
  ADD CONSTRAINT games_research_consent_version_valid CHECK (
    research_consent_version IN (
      'legacy-no-research-consent-v0',
      'webchess-research-consent-v1'
    )
  ),
  ADD CONSTRAINT games_research_consent_decision_valid CHECK (
    research_consent_decision IN (
      'allow_search_and_page_fetch',
      'no_external_research'
    )
  ),
  ADD CONSTRAINT games_research_consent_shape CHECK (
    (
      research_consent_version = 'legacy-no-research-consent-v0'
      AND research_consent_decision = 'no_external_research'
      AND research_consent_recorded_at IS NULL
    )
    OR (
      research_consent_version = 'webchess-research-consent-v1'
      AND research_consent_recorded_at IS NOT NULL
    )
  );

-- Persist the exact game consent alongside each immutable research decision
-- so exports remain interpretable without reconstructing application state.
ALTER TABLE research_requests
  ADD COLUMN research_consent_version text NOT NULL
    DEFAULT 'legacy-no-research-consent-v0',
  ADD COLUMN research_consent_decision text NOT NULL
    DEFAULT 'no_external_research',
  ADD COLUMN research_consent_recorded_at timestamptz,
  ADD COLUMN fetch_failures jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE research_requests
  DROP CONSTRAINT research_requests_no_page_fetch,
  DROP CONSTRAINT research_requests_json_shapes;

ALTER TABLE research_requests
  ADD CONSTRAINT research_requests_consent_shape CHECK (
    (
      research_consent_version = 'legacy-no-research-consent-v0'
      AND research_consent_decision = 'no_external_research'
      AND research_consent_recorded_at IS NULL
    )
    OR (
      research_consent_version = 'webchess-research-consent-v1'
      AND research_consent_decision IN (
        'allow_search_and_page_fetch',
        'no_external_research'
      )
      AND research_consent_recorded_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT research_requests_json_shapes CHECK (
    jsonb_typeof(executed_queries) = 'array'
    AND jsonb_typeof(retrieved_facts) = 'array'
    AND jsonb_array_length(retrieved_facts) BETWEEN 0 AND 3
    AND jsonb_typeof(fetch_failures) = 'array'
    AND jsonb_array_length(fetch_failures) BETWEEN 0 AND 3
    AND jsonb_array_length(retrieved_facts)
      + jsonb_array_length(fetch_failures) <= 3
    AND jsonb_typeof(injection_signals) = 'array'
  ),
  ADD CONSTRAINT research_requests_page_fetch_consistency CHECK (
    direct_page_text_fetched = (jsonb_array_length(retrieved_facts) > 0)
    AND (
      research_consent_decision = 'allow_search_and_page_fetch'
      OR (
        NOT direct_page_text_fetched
        AND jsonb_array_length(fetch_failures) = 0
      )
    )
  ),
  ADD CONSTRAINT research_requests_opt_out_shape CHECK (
    research_consent_version <> 'webchess-research-consent-v1'
    OR research_consent_decision <> 'no_external_research'
    OR (
      status = 'not_needed'
      AND query IS NULL
      AND attempt_count = 0
      AND jsonb_array_length(executed_queries) = 0
      AND jsonb_array_length(retrieved_facts) = 0
      AND jsonb_array_length(fetch_failures) = 0
    )
  );
