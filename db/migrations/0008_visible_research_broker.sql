-- Automatic research is a bounded, durable subactivity of one of WebChess's
-- seven visible stages. It has its own ledger so research progress never
-- mutates lifecycle revision fences used by Portia and Charlotte.
CREATE TABLE IF NOT EXISTS research_requests (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL
    REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE,
  game_id uuid NOT NULL
    REFERENCES games(id) ON DELETE CASCADE,
  lifecycle_run_id uuid
    REFERENCES lifecycle_runs(id) ON DELETE CASCADE,
  stage text NOT NULL
    CONSTRAINT research_requests_stage_valid
      CHECK (stage IN ('anansi', 'chess', 'portia', 'answer', 'charlotte', 'wilbur', 'web')),
  requested_by text NOT NULL DEFAULT 'research-policy'
    CONSTRAINT research_requests_requested_by_valid
      CHECK (requested_by = 'research-policy'),
  policy_version text NOT NULL
    CONSTRAINT research_requests_policy_version_length
      CHECK (char_length(policy_version) BETWEEN 1 AND 80),
  materiality text
    CONSTRAINT research_requests_materiality_valid
      CHECK (materiality IS NULL OR materiality IN ('helpful', 'required')),
  reason text NOT NULL
    CONSTRAINT research_requests_reason_length
      CHECK (char_length(reason) BETWEEN 8 AND 1000),
  query text
    CONSTRAINT research_requests_query_length
      CHECK (query IS NULL OR char_length(query) BETWEEN 3 AND 320),
  status text NOT NULL
    CONSTRAINT research_requests_status_valid
      CHECK (status IN ('searching', 'completed', 'not_needed', 'failed', 'timed_out', 'refused')),
  provider text NOT NULL DEFAULT 'codex'
    CONSTRAINT research_requests_provider_valid CHECK (provider = 'codex'),
  transport text NOT NULL DEFAULT 'local'
    CONSTRAINT research_requests_transport_valid CHECK (transport = 'local'),
  model text
    CONSTRAINT research_requests_model_length
      CHECK (model IS NULL OR char_length(model) BETWEEN 1 AND 200),

  invocation_limit smallint NOT NULL DEFAULT 1
    CONSTRAINT research_requests_invocation_limit_valid CHECK (invocation_limit = 1),
  result_limit smallint NOT NULL
    CONSTRAINT research_requests_result_limit_valid CHECK (result_limit BETWEEN 1 AND 5),
  source_limit smallint NOT NULL
    CONSTRAINT research_requests_source_limit_valid CHECK (source_limit BETWEEN 1 AND 8),
  timeout_ms integer NOT NULL
    CONSTRAINT research_requests_timeout_valid CHECK (timeout_ms BETWEEN 1000 AND 60000),
  synthesis_character_limit integer NOT NULL
    CONSTRAINT research_requests_synthesis_limit_valid
      CHECK (synthesis_character_limit BETWEEN 500 AND 32000),
  attempt_count smallint NOT NULL DEFAULT 0
    CONSTRAINT research_requests_attempt_count_valid CHECK (attempt_count BETWEEN 0 AND 1),

  executed_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  search_synthesis text,
  direct_page_text_fetched boolean NOT NULL DEFAULT false
    CONSTRAINT research_requests_no_page_fetch CHECK (NOT direct_page_text_fetched),
  retrieved_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  omitted_source_count smallint NOT NULL DEFAULT 0
    CONSTRAINT research_requests_omitted_source_count_valid
      CHECK (omitted_source_count BETWEEN 0 AND 100),
  injection_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_digest char(64)
    CONSTRAINT research_requests_content_digest_valid
      CHECK (content_digest IS NULL OR content_digest ~ '^[0-9a-f]{64}$'),
  failure_code text
    CONSTRAINT research_requests_failure_code_length
      CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 80),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT research_requests_json_shapes CHECK (
    jsonb_typeof(executed_queries) = 'array'
    AND jsonb_typeof(retrieved_facts) = 'array'
    AND jsonb_array_length(retrieved_facts) = 0
    AND jsonb_typeof(injection_signals) = 'array'
  ),
  CONSTRAINT research_requests_status_shape CHECK (
    (
      status = 'not_needed'
      AND materiality IS NULL
      AND query IS NULL
      AND attempt_count = 0
      AND started_at IS NULL
      AND completed_at IS NOT NULL
    )
    OR (
      status = 'searching'
      AND materiality IS NOT NULL
      AND query IS NOT NULL
      AND attempt_count = 1
      AND started_at IS NOT NULL
      AND completed_at IS NULL
    )
    OR (
      status IN ('completed', 'failed', 'timed_out', 'refused')
      AND materiality IS NOT NULL
      AND query IS NOT NULL
      AND attempt_count = 1
      AND started_at IS NOT NULL
      AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT research_requests_completed_shape CHECK (
    status <> 'completed'
    OR (
      model IS NOT NULL
      AND search_synthesis IS NOT NULL
      AND content_digest IS NOT NULL
      AND failure_code IS NULL
    )
  ),
  UNIQUE (id, clerk_user_id),
  UNIQUE (game_id, stage, policy_version)
);

CREATE INDEX IF NOT EXISTS research_requests_owner_created
  ON research_requests (clerk_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS research_requests_lifecycle_created
  ON research_requests (lifecycle_run_id, created_at);

CREATE TABLE IF NOT EXISTS research_sources (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL
    REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE,
  research_request_id uuid NOT NULL,
  ordinal smallint NOT NULL
    CONSTRAINT research_sources_ordinal_valid CHECK (ordinal BETWEEN 1 AND 8),
  citation_id text NOT NULL
    CONSTRAINT research_sources_citation_id_length
      CHECK (char_length(citation_id) BETWEEN 2 AND 40),
  title text NOT NULL
    CONSTRAINT research_sources_title_length
      CHECK (char_length(title) BETWEEN 1 AND 500),
  url text NOT NULL
    CONSTRAINT research_sources_url_length
      CHECK (
        char_length(url) BETWEEN 8 AND 2048
        AND url ~ '^https://'
      ),
  hostname text NOT NULL
    CONSTRAINT research_sources_hostname_length
      CHECK (char_length(hostname) BETWEEN 1 AND 253),
  trust text NOT NULL
    CONSTRAINT research_sources_trust_valid
      CHECK (trust IN ('government_or_education', 'general_web')),
  discovered_from text NOT NULL
    CONSTRAINT research_sources_discovery_valid
      CHECK (discovered_from IN ('search_activity', 'synthesis_link')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT research_sources_owned_request
    FOREIGN KEY (research_request_id, clerk_user_id)
    REFERENCES research_requests(id, clerk_user_id) ON DELETE CASCADE,
  CONSTRAINT research_sources_citation_id_valid CHECK (citation_id ~ '^R[1-8]$'),
  UNIQUE (research_request_id, ordinal),
  UNIQUE (research_request_id, url)
);

CREATE INDEX IF NOT EXISTS research_sources_request_ordinal
  ON research_sources (research_request_id, ordinal);
