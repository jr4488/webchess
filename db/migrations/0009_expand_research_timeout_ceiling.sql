-- Preserve the production research timeout default while permitting an
-- explicitly configured, bounded local/test run to wait up to two minutes.
-- This is a forward-only replacement because 0008 may already be recorded in
-- the canonical migration ledger.
ALTER TABLE research_requests
  DROP CONSTRAINT research_requests_timeout_valid;

ALTER TABLE research_requests
  ADD CONSTRAINT research_requests_timeout_valid
    CHECK (timeout_ms BETWEEN 1000 AND 120000);
