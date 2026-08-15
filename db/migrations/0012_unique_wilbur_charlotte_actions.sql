ALTER TABLE wilbur_actions
  ADD COLUMN charlotte_binding_version text;

ALTER TABLE wilbur_actions
  ADD CONSTRAINT wilbur_actions_charlotte_binding_version_valid
  CHECK (
    charlotte_binding_version IS NULL
    OR charlotte_binding_version = 'webchess-charlotte-action-binding-v1'
  );

CREATE OR REPLACE FUNCTION webchess_guard_wilbur_charlotte_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.charlotte_action_index IS NULL THEN
      RAISE EXCEPTION
        'Current Wilbur actions require a Charlotte action index.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.charlotte_binding_version IS NULL THEN
      NEW.charlotte_binding_version :=
        'webchess-charlotte-action-binding-v1';
    ELSIF NEW.charlotte_binding_version <>
      'webchess-charlotte-action-binding-v1' THEN
      RAISE EXCEPTION
        'Unsupported Wilbur Charlotte binding version.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.status <> 'planned' OR NEW.revision <> 0 THEN
      RAISE EXCEPTION
        'A current Wilbur action must begin planned at revision zero.'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.clerk_user_id IS DISTINCT FROM OLD.clerk_user_id
    OR NEW.lifecycle_run_id IS DISTINCT FROM OLD.lifecycle_run_id
    OR NEW.charlotte_action_index IS DISTINCT FROM
      OLD.charlotte_action_index
    OR NEW.charlotte_binding_version IS DISTINCT FROM
      OLD.charlotte_binding_version
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
    OR NEW.actor IS DISTINCT FROM OLD.actor
    OR NEW.action IS DISTINCT FROM OLD.action
    OR NEW.tested_assumption IS DISTINCT FROM OLD.tested_assumption
    OR NEW.expected_observation IS DISTINCT FROM
      OLD.expected_observation
    OR NEW.decision_threshold IS DISTINCT FROM
      OLD.decision_threshold
    OR NEW.review_horizon IS DISTINCT FROM OLD.review_horizon
    OR NEW.record_version IS DISTINCT FROM OLD.record_version
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'A Wilbur action can only change status, revision, and updated_at.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION
      'A Wilbur action status update must advance revision by one.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION
      'A Wilbur action update timestamp cannot move backward.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER wilbur_actions_charlotte_binding_guard
BEFORE INSERT OR UPDATE ON wilbur_actions
FOR EACH ROW
EXECUTE FUNCTION webchess_guard_wilbur_charlotte_binding();

CREATE UNIQUE INDEX wilbur_actions_one_per_charlotte_suggestion
  ON wilbur_actions (lifecycle_run_id, charlotte_action_index)
  WHERE charlotte_binding_version =
    'webchess-charlotte-action-binding-v1';
