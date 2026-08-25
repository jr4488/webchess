-- Persist the logical five-minute Answer cutoff independently from its longer
-- concurrency fence. The lease retains 35 seconds only for loopback response
-- drain and durable settlement; it is not permission for late success.
ALTER TABLE model_requests
  ADD COLUMN operation_deadline_at timestamptz;

-- Preserve migration validity for historical rows. An active legacy Answer
-- has the most faithful boundary in its fixed lease cap; completed rows no
-- longer execute, so their provider/start timestamp is sufficient provenance.
UPDATE model_requests AS requests
SET operation_deadline_at = coalesce(
  (
    SELECT slots.lease_expires_at - interval '35 seconds'
    FROM model_concurrency_slots AS slots
    WHERE slots.request_id = requests.id
  ),
  requests.provider_started_at + interval '300 seconds',
  requests.created_at + interval '300 seconds'
)
WHERE requests.operation = 'answer';

ALTER TABLE model_requests
  ADD CONSTRAINT model_requests_operation_deadline_valid
    CHECK (
      (
        operation = 'answer'
        AND operation_deadline_at IS NOT NULL
      )
      OR (
        operation <> 'answer'
        AND operation_deadline_at IS NULL
      )
    );

COMMENT ON COLUMN model_requests.operation_deadline_at IS
  'Immutable logical Answer cutoff. Success must settle before this instant; the concurrency lease may remain fenced briefly for terminal settlement.';

CREATE OR REPLACE FUNCTION webchess_guard_model_request_deadline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF NEW.operation_deadline_at IS DISTINCT FROM OLD.operation_deadline_at THEN
    RAISE EXCEPTION 'A model request operation deadline is immutable.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER model_requests_operation_deadline_guard
BEFORE UPDATE ON model_requests
FOR EACH ROW
EXECUTE FUNCTION webchess_guard_model_request_deadline();
