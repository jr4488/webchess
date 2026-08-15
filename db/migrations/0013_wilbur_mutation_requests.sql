CREATE TABLE wilbur_mutation_requests (
  clerk_user_id text NOT NULL
    REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  operation text NOT NULL
    CONSTRAINT wilbur_mutation_requests_operation_valid
      CHECK (
        operation IN (
          'create_action',
          'update_action',
          'append_observation'
        )
      ),
  request_digest char(64) NOT NULL
    CONSTRAINT wilbur_mutation_requests_request_digest_valid
      CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  target_game_id uuid NOT NULL
    REFERENCES games(id) ON DELETE CASCADE,
  target_action_id uuid
    REFERENCES wilbur_actions(id) ON DELETE CASCADE,
  rate_kind text NOT NULL
    CONSTRAINT wilbur_mutation_requests_rate_kind_valid
      CHECK (rate_kind IN ('action', 'observation')),
  rate_admitted_at timestamptz,
  denial_code text
    CONSTRAINT wilbur_mutation_requests_denial_code_length
      CHECK (char_length(denial_code) BETWEEN 1 AND 120),
  retry_at timestamptz,
  reserved_future_rows smallint NOT NULL DEFAULT 0
    CONSTRAINT wilbur_mutation_requests_reserved_rows_valid
      CHECK (reserved_future_rows BETWEEN 0 AND 2),
  reserved_text_bytes bigint NOT NULL DEFAULT 0
    CONSTRAINT wilbur_mutation_requests_reserved_bytes_valid
      CHECK (reserved_text_bytes >= 0),
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT wilbur_mutation_requests_status_valid
      CHECK (status IN ('pending', 'committed', 'denied')),
  result_entity_id uuid,
  result_revision bigint
    CONSTRAINT wilbur_mutation_requests_result_revision_valid
      CHECK (result_revision >= 0),
  result_status text
    CONSTRAINT wilbur_mutation_requests_result_status_length
      CHECK (
        result_status IS NULL
        OR result_status IN (
          'planned',
          'in_progress',
          'completed',
          'abandoned',
          'inconclusive'
        )
      ),
  result_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clerk_user_id, idempotency_key),
  CONSTRAINT wilbur_mutation_requests_target_shape CHECK (
    (
      operation = 'create_action'
      AND target_action_id IS NULL
    )
    OR (
      operation IN ('update_action', 'append_observation')
      AND target_action_id IS NOT NULL
    )
  ),
  CONSTRAINT wilbur_mutation_requests_rate_shape CHECK (
    (
      operation IN ('create_action', 'update_action')
      AND rate_kind = 'action'
    )
    OR (
      operation = 'append_observation'
      AND rate_kind = 'observation'
    )
  ),
  CONSTRAINT wilbur_mutation_requests_reservation_shape CHECK (
    (
      status = 'denied'
      AND reserved_future_rows = 0
      AND reserved_text_bytes = 0
    )
    OR (
      status = 'committed'
      AND reserved_future_rows = 0
      AND reserved_text_bytes = 0
    )
    OR (
      status = 'pending'
      AND operation = 'update_action'
      AND reserved_future_rows = 1
      AND reserved_text_bytes = 0
    )
    OR (
      status = 'pending'
      AND operation IN ('create_action', 'append_observation')
      AND reserved_future_rows = 2
      AND reserved_text_bytes > 0
    )
  ),
  CONSTRAINT wilbur_mutation_requests_state_shape CHECK (
    (
      status = 'pending'
      AND denial_code IS NULL
      AND retry_at IS NULL
      AND result_entity_id IS NULL
      AND result_revision IS NULL
      AND result_status IS NULL
      AND result_updated_at IS NULL
    )
    OR (
      status = 'denied'
      AND denial_code IS NOT NULL
      AND result_entity_id IS NULL
      AND result_revision IS NULL
      AND result_status IS NULL
      AND result_updated_at IS NULL
    )
    OR (
      status = 'committed'
      AND rate_admitted_at IS NOT NULL
      AND denial_code IS NULL
      AND retry_at IS NULL
      AND result_entity_id IS NOT NULL
      AND (
        (
          operation IN ('create_action', 'update_action')
          AND result_revision IS NOT NULL
          AND result_status IS NOT NULL
          AND result_updated_at IS NOT NULL
        )
        OR (
          operation = 'append_observation'
          AND result_revision IS NULL
          AND result_status IS NULL
          AND result_updated_at IS NULL
        )
      )
    )
  )
);

CREATE OR REPLACE FUNCTION webchess_guard_wilbur_mutation_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.rate_admitted_at IS NOT NULL THEN
      RAISE EXCEPTION
        'A Wilbur mutation request must begin pending and unadmitted.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF
    NEW.clerk_user_id IS DISTINCT FROM OLD.clerk_user_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.operation IS DISTINCT FROM OLD.operation
    OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
    OR NEW.target_game_id IS DISTINCT FROM OLD.target_game_id
    OR NEW.target_action_id IS DISTINCT FROM OLD.target_action_id
    OR NEW.rate_kind IS DISTINCT FROM OLD.rate_kind
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'A Wilbur mutation request cannot change its durable identity.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION
      'A terminal Wilbur mutation request is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF
    NEW.status = 'pending'
    AND (
      NEW.reserved_future_rows IS DISTINCT FROM OLD.reserved_future_rows
      OR NEW.reserved_text_bytes IS DISTINCT FROM OLD.reserved_text_bytes
    )
  THEN
    RAISE EXCEPTION
      'A pending Wilbur mutation reservation is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION
      'A Wilbur mutation update timestamp cannot move backward.'
      USING ERRCODE = '23514';
  END IF;

  IF
    OLD.rate_admitted_at IS NOT NULL
    AND NEW.rate_admitted_at IS DISTINCT FROM OLD.rate_admitted_at
  THEN
    RAISE EXCEPTION
      'A Wilbur mutation admission timestamp is immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF
    OLD.rate_admitted_at IS NULL
    AND NEW.rate_admitted_at IS NOT NULL
    AND NEW.status <> 'pending'
  THEN
    RAISE EXCEPTION
      'Wilbur admission must be recorded before terminal settlement.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'committed' AND OLD.rate_admitted_at IS NULL THEN
    RAISE EXCEPTION
      'A Wilbur mutation must be admitted before it can commit.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER wilbur_mutation_requests_state_guard
BEFORE INSERT OR UPDATE ON wilbur_mutation_requests
FOR EACH ROW
EXECUTE FUNCTION webchess_guard_wilbur_mutation_request();

CREATE INDEX wilbur_mutation_requests_target_game_created
  ON wilbur_mutation_requests (target_game_id, created_at);

CREATE INDEX wilbur_mutation_requests_target_action
  ON wilbur_mutation_requests (target_action_id)
  WHERE target_action_id IS NOT NULL;

CREATE INDEX wilbur_mutation_requests_pending_owner
  ON wilbur_mutation_requests (clerk_user_id, updated_at)
  WHERE status = 'pending';
