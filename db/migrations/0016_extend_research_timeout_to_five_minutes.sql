-- A single consented Codex Hosted Search may use up to five minutes. This
-- migration changes only the persisted research-request time ceiling; query,
-- source, result, page-fetch, consent, and synthesis bounds remain unchanged.
ALTER TABLE research_requests
  DROP CONSTRAINT research_requests_timeout_valid;

ALTER TABLE research_requests
  ADD CONSTRAINT research_requests_timeout_valid
    CHECK (timeout_ms BETWEEN 1000 AND 300000);
