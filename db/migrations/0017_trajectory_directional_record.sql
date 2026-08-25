ALTER TABLE lifecycle_runs
  ADD COLUMN trajectory_directional_record_version text,
  ADD COLUMN trajectory_directional_record_digest char(64),
  ADD COLUMN trajectory_directional_record jsonb;

ALTER TABLE lifecycle_runs
  ADD CONSTRAINT lifecycle_runs_trajectory_directional_record_complete
    CHECK (
      (
        trajectory_directional_record_version IS NULL
        AND trajectory_directional_record_digest IS NULL
        AND trajectory_directional_record IS NULL
      )
      OR
      (
        trajectory_directional_record_version IS NOT NULL
        AND trajectory_directional_record_digest IS NOT NULL
        AND trajectory_directional_record IS NOT NULL
      )
    ),
  ADD CONSTRAINT lifecycle_runs_trajectory_directional_record_provenance_valid
    CHECK (
      (
        trajectory_directional_record_version IS NULL
        AND trajectory_directional_record_digest IS NULL
      )
      OR (
        trajectory_directional_record_version =
          'webchess-directional-record-v1'
        AND trajectory_directional_record_digest ~ '^[0-9a-f]{64}$'
      )
    ),
  ADD CONSTRAINT lifecycle_runs_trajectory_directional_record_shape_valid
    CHECK (
      trajectory_directional_record IS NULL
      OR (
        jsonb_typeof(trajectory_directional_record) = 'object'
        AND octet_length(trajectory_directional_record::text) <= 4000000
        AND trajectory_directional_record ? 'version'
        AND jsonb_typeof(trajectory_directional_record->'version') = 'string'
        AND (
          trajectory_directional_record->>'version' =
            trajectory_directional_record_version
        ) IS TRUE
        AND trajectory_directional_record ? 'digest'
        AND jsonb_typeof(trajectory_directional_record->'digest') = 'string'
        AND (
          trajectory_directional_record->>'digest' =
            trajectory_directional_record_digest
        ) IS TRUE
      )
    ),
  ADD CONSTRAINT lifecycle_runs_trajectory_directional_record_binding_valid
    CHECK (
      (
        trajectory_directional_record IS NULL
        AND (
          lifecycle_version <> 'webchess-lifecycle-v2.5'
          OR terminal_fingerprint IS NULL
        )
      )
      OR (
        trajectory_directional_record IS NOT NULL
        AND lifecycle_version = 'webchess-lifecycle-v2.5'
        AND terminal_fingerprint IS NOT NULL
        AND survivor_set IS NOT NULL
        AND state NOT IN (
          'anansi_pending',
          'anansi_running',
          'field_ready',
          'chess_ready',
          'chess_playing'
        )
      )
    );

CREATE OR REPLACE FUNCTION webchess_guard_trajectory_directional_record()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.trajectory_directional_record IS NOT NULL AND (
      NEW.trajectory_directional_record_version IS DISTINCT FROM
        OLD.trajectory_directional_record_version
      OR NEW.trajectory_directional_record_digest IS DISTINCT FROM
        OLD.trajectory_directional_record_digest
      OR NEW.trajectory_directional_record IS DISTINCT FROM
        OLD.trajectory_directional_record
      OR NEW.terminal_fingerprint IS DISTINCT FROM OLD.terminal_fingerprint
      OR NEW.survivor_set IS DISTINCT FROM OLD.survivor_set
    ) THEN
      RAISE EXCEPTION
        'Persisted trajectory directional and terminal evidence is immutable.'
        USING ERRCODE = '23514';
    END IF;

    IF
      OLD.trajectory_directional_record IS NULL
      AND NEW.trajectory_directional_record IS NOT NULL
      AND (
        OLD.state <> 'chess_playing'
        OR NEW.state <> 'chess_terminal'
        OR NEW.revision <> OLD.revision + 1
        OR NEW.terminal_fingerprint IS NULL
        OR NEW.survivor_set IS NULL
      )
    THEN
      RAISE EXCEPTION
        'A trajectory directional record must be bound by the terminal compare-and-swap.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.trajectory_directional_record IS NOT NULL THEN
    RAISE EXCEPTION
      'A trajectory directional record cannot be inserted before terminal replay settlement.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER lifecycle_runs_trajectory_directional_record_guard
BEFORE INSERT OR UPDATE ON lifecycle_runs
FOR EACH ROW
EXECUTE FUNCTION webchess_guard_trajectory_directional_record();
