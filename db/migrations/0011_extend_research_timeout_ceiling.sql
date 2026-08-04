-- Codex hosted search may legitimately use the full two-minute provider
-- window. Give the local broker a separate, bounded 30-second envelope for
-- CLI startup, result normalization, and durable settlement.
ALTER TABLE research_requests
  DROP CONSTRAINT research_requests_timeout_valid;

ALTER TABLE research_requests
  ADD CONSTRAINT research_requests_timeout_valid
    CHECK (timeout_ms BETWEEN 1000 AND 150000);
