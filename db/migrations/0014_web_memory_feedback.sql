-- Close the Wilbur -> Web -> later Anansi loop without silently reusing a
-- player's observations. Follow-up dates power visible in-app reminders, while
-- explicit links record exactly which prior observations the player consented
-- to carry into a later game.

ALTER TABLE wilbur_actions
  ADD COLUMN follow_up_at timestamptz;

-- Keep the exact follow-up value returned by an idempotent create/update.
-- Reading the current action row during a later replay could otherwise combine
-- an old status/revision with a follow-up timestamp from a newer mutation.
ALTER TABLE wilbur_mutation_requests
  ADD COLUMN result_follow_up_at timestamptz;

ALTER TABLE wilbur_mutation_requests
  DROP CONSTRAINT wilbur_mutation_requests_state_shape;

ALTER TABLE wilbur_mutation_requests
  ADD CONSTRAINT wilbur_mutation_requests_state_shape CHECK (
    (
      status = 'pending'
      AND denial_code IS NULL
      AND retry_at IS NULL
      AND result_entity_id IS NULL
      AND result_revision IS NULL
      AND result_status IS NULL
      AND result_follow_up_at IS NULL
      AND result_updated_at IS NULL
    )
    OR (
      status = 'denied'
      AND denial_code IS NOT NULL
      AND result_entity_id IS NULL
      AND result_revision IS NULL
      AND result_status IS NULL
      AND result_follow_up_at IS NULL
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
          AND result_follow_up_at IS NULL
          AND result_updated_at IS NULL
        )
      )
    )
  );

CREATE INDEX wilbur_actions_owner_follow_up
  ON wilbur_actions (clerk_user_id, follow_up_at)
  WHERE follow_up_at IS NOT NULL
    AND status IN ('planned', 'in_progress', 'inconclusive');

-- Composite candidate keys let the link row prove ownership at the database
-- boundary, instead of trusting two unrelated single-column foreign keys.
ALTER TABLE games
  ADD CONSTRAINT games_id_clerk_user_id_key
  UNIQUE (id, clerk_user_id);

ALTER TABLE wilbur_observations
  ADD CONSTRAINT wilbur_observations_id_clerk_user_id_key
  UNIQUE (id, clerk_user_id);

CREATE TABLE web_memory_links (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL
    REFERENCES user_controls(clerk_user_id) ON DELETE CASCADE,
  target_game_id uuid NOT NULL,
  source_observation_id uuid NOT NULL,
  selection_ordinal smallint NOT NULL
    CONSTRAINT web_memory_links_selection_ordinal_valid
      CHECK (selection_ordinal BETWEEN 0 AND 7),
  consent_version text NOT NULL
    CONSTRAINT web_memory_links_consent_version_valid
      CHECK (consent_version = 'webchess-web-memory-consent-v1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT web_memory_links_target_owner_fkey
    FOREIGN KEY (target_game_id, clerk_user_id)
    REFERENCES games(id, clerk_user_id) ON DELETE CASCADE,
  CONSTRAINT web_memory_links_source_owner_fkey
    FOREIGN KEY (source_observation_id, clerk_user_id)
    REFERENCES wilbur_observations(id, clerk_user_id) ON DELETE CASCADE,
  UNIQUE (target_game_id, source_observation_id),
  UNIQUE (target_game_id, selection_ordinal)
);

CREATE INDEX web_memory_links_owner_created
  ON web_memory_links (clerk_user_id, created_at DESC);

CREATE INDEX web_memory_links_source_observation
  ON web_memory_links (source_observation_id, target_game_id);

-- Migration 0012 deliberately treats the Charlotte binding, action text, and
-- durable identity as immutable. Keep that guard and its unique index intact,
-- while making the new follow-up timestamp one of the explicitly mutable
-- scheduling fields. Revision and updated_at still advance on every change.
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
      'A Wilbur action can only change status, revision, follow_up_at, and updated_at.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION
      'A Wilbur action update must advance revision by one.'
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
