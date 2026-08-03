import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'

const MIGRATION_FILENAME_PATTERN =
  /^(\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/
const MIGRATION_ID_PATTERN =
  /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/
const MIGRATION_CHECKSUM_PATTERN = /^[0-9a-f]{64}$/
const MIGRATION_LOCK_KEY = '8120371142281'
const DEFAULT_MIGRATION_DIRECTORY = new URL(
  '../db/migrations/',
  import.meta.url,
)

const CREATE_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS webchess_schema_migrations (
    id text PRIMARY KEY
      CHECK (id ~ '^[0-9]{4}_[a-z0-9]+(?:_[a-z0-9]+)*$'),
    checksum char(64) NOT NULL
      CHECK (checksum ~ '^[0-9a-f]{64}$'),
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`

const READ_MIGRATIONS_SQL = `
  SELECT id, checksum
  FROM webchess_schema_migrations
  ORDER BY id
`

const INSPECT_MIGRATION_LEDGER_SQL = `
  SELECT
    to_regclass('webchess_schema_migrations')::text
      AS migration_ledger,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = current_schema()
        AND relation.relname IN (
          'deleted_user_tombstones',
          'user_controls',
          'games',
          'game_events',
          'model_requests',
          'game_start_requests',
          'usage_buckets',
          'rate_buckets',
          'model_concurrency_slots',
          'lifecycle_runs',
          'portia_reviews',
          'gate_decisions',
          'charlotte_results',
          'wilbur_actions',
          'wilbur_observations',
          'lifecycle_events',
          'research_requests',
          'research_sources'
        )
    ) AS has_webchess_objects
`

const RUNTIME_TABLE_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
]

const RUNTIME_COLUMN_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'REFERENCES',
]

const RUNTIME_TABLE_PRIVILEGE_CONTRACT = {
  webchess_schema_migrations: ['SELECT'],
  deleted_user_tombstones: ['SELECT', 'INSERT', 'UPDATE'],
  user_controls: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  games: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  game_events: ['SELECT', 'INSERT'],
  model_requests: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  game_start_requests: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  usage_buckets: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  rate_buckets: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  model_concurrency_slots: ['SELECT', 'UPDATE'],
  lifecycle_runs: ['SELECT', 'INSERT', 'UPDATE'],
  portia_reviews: ['SELECT', 'INSERT'],
  gate_decisions: ['SELECT', 'INSERT'],
  charlotte_results: ['SELECT', 'INSERT'],
  wilbur_actions: ['SELECT', 'INSERT', 'UPDATE'],
  wilbur_observations: ['SELECT', 'INSERT'],
  lifecycle_events: ['SELECT', 'INSERT'],
  research_requests: ['SELECT', 'INSERT', 'UPDATE'],
  research_sources: ['SELECT', 'INSERT'],
}

const RUNTIME_COLUMN_CONTRACT = {
  webchess_schema_migrations: [
    ['id', 'text', true],
    ['checksum', 'character(64)', true],
    ['applied_at', 'timestamp with time zone', true],
  ],
  deleted_user_tombstones: [
    ['user_key_hash', 'character(64)', true],
    ['deleted_at', 'timestamp with time zone', true],
  ],
  user_controls: [
    ['clerk_user_id', 'text', true],
    ['suspended', 'boolean', true],
    ['blocked_until', 'timestamp with time zone', false],
    ['reason_code', 'text', false],
    ['daily_game_limit', 'integer', false],
    ['daily_model_request_limit', 'integer', false],
    ['hourly_model_request_limit', 'integer', false],
    ['concurrent_model_limit', 'smallint', false],
    ['created_at', 'timestamp with time zone', true],
    ['last_seen_at', 'timestamp with time zone', true],
    ['updated_at', 'timestamp with time zone', true],
  ],
  games: [
    ['id', 'uuid', true],
    ['clerk_user_id', 'text', true],
    ['source_game_id', 'uuid', false],
    ['is_current', 'boolean', true],
    ['revision', 'bigint', true],
    ['status', 'text', true],
    ['problem', 'text', true],
    ['problem_sha256', 'character(64)', true],
    ['division_seed', 'text', false],
    ['division_facets', 'jsonb', false],
    ['problem_parts', 'jsonb', false],
    ['division_model', 'text', false],
    ['division_prompt_version', 'text', false],
    ['division_prompt_sha256', 'character(64)', false],
    ['division_digest', 'character(64)', false],
    ['rules_version', 'text', true],
    ['engine_version', 'text', true],
    ['cast_version', 'text', true],
    ['event_version', 'smallint', true],
    ['software_version', 'text', true],
    ['outcome', 'jsonb', false],
    ['answer_payload', 'jsonb', false],
    ['created_at', 'timestamp with time zone', true],
    ['updated_at', 'timestamp with time zone', true],
    ['completed_at', 'timestamp with time zone', false],
    ['answered_at', 'timestamp with time zone', false],
  ],
  game_events: [
    ['game_id', 'uuid', true],
    ['ply', 'smallint', true],
    ['kind', 'text', true],
    ['source', 'text', true],
    ['side', 'text', true],
    ['piece_id', 'text', false],
    ['captured_piece_id', 'text', false],
    ['promoted_to', 'text', false],
    ['from_ring', 'smallint', false],
    ['from_sector', 'smallint', false],
    ['to_ring', 'smallint', false],
    ['to_sector', 'smallint', false],
    ['idempotency_key', 'uuid', false],
    ['request_sha256', 'character(64)', false],
    ['game_revision', 'bigint', true],
    ['created_at', 'timestamp with time zone', true],
  ],
  model_requests: [
    ['id', 'uuid', true],
    ['clerk_user_id', 'text', true],
    ['game_id', 'uuid', false],
    ['operation', 'text', true],
    ['idempotency_key', 'uuid', true],
    ['request_sha256', 'character(64)', true],
    ['status', 'text', true],
    ['attempt', 'smallint', true],
    ['provider', 'text', true],
    ['model', 'text', true],
    ['prompt_version', 'text', true],
    ['software_version', 'text', true],
    ['provider_response_id', 'text', false],
    ['response_sha256', 'character(64)', false],
    ['result_payload', 'jsonb', false],
    ['usage_reported', 'boolean', true],
    ['input_tokens', 'bigint', false],
    ['cached_input_tokens', 'bigint', false],
    ['cache_write_input_tokens', 'bigint', false],
    ['output_tokens', 'bigint', false],
    ['reasoning_tokens', 'bigint', false],
    ['total_tokens', 'bigint', false],
    ['provider_started_at', 'timestamp with time zone', false],
    ['completed_at', 'timestamp with time zone', false],
    ['failure_code', 'text', false],
    ['provider_http_status', 'smallint', false],
    ['created_at', 'timestamp with time zone', true],
    ['updated_at', 'timestamp with time zone', true],
  ],
  game_start_requests: [
    ['idempotency_key', 'uuid', true],
    ['clerk_user_id', 'text', true],
    ['kind', 'text', true],
    ['source_game_id', 'uuid', true],
    ['expected_revision', 'bigint', true],
    ['created_at', 'timestamp with time zone', true],
    ['updated_at', 'timestamp with time zone', true],
    ['activated_at', 'timestamp with time zone', false],
  ],
  usage_buckets: [
    ['subject_type', 'text', true],
    ['subject_key', 'text', true],
    ['metric', 'text', true],
    ['bucket_start', 'timestamp with time zone', true],
    ['bucket_seconds', 'integer', true],
    ['used', 'bigint', true],
    ['reserved', 'bigint', true],
    ['updated_at', 'timestamp with time zone', true],
  ],
  rate_buckets: [
    ['key_type', 'text', true],
    ['key_hash', 'character(64)', true],
    ['action', 'text', true],
    ['window_start', 'timestamp with time zone', true],
    ['window_seconds', 'integer', true],
    ['count', 'integer', true],
    ['expires_at', 'timestamp with time zone', true],
  ],
  model_concurrency_slots: [
    ['slot', 'smallint', true],
    ['enabled', 'boolean', true],
    ['request_id', 'uuid', false],
    ['clerk_user_id', 'text', false],
    ['lease_token', 'uuid', false],
    ['lease_expires_at', 'timestamp with time zone', false],
  ],
  lifecycle_runs: [
    ['id', 'uuid', true],
    ['clerk_user_id', 'text', true],
    ['game_id', 'uuid', true],
    ['root_run_id', 'uuid', true],
    ['parent_run_id', 'uuid', false],
    ['state', 'text', true],
    ['revision', 'bigint', true],
    ['field_generation', 'smallint', true],
    ['game_attempt', 'smallint', true],
    ['same_field_retry_count', 'smallint', true],
    ['field_regeneration_count', 'smallint', true],
    ['division_seed', 'text', true],
    ['cast_seed', 'text', true],
    ['trajectory_seed', 'text', true],
    ['retry_reason', 'text', false],
    ['terminal_fingerprint', 'character(64)', false],
    ['survivor_set', 'jsonb', false],
    ['software_version', 'text', true],
    ['lifecycle_version', 'text', true],
    ['rules_version', 'text', true],
    ['engine_version', 'text', true],
    ['cast_version', 'text', true],
    ['event_version', 'smallint', true],
    ['portia_prompt_version', 'text', true],
    ['portia_contract_version', 'text', true],
    ['gate_algorithm_version', 'text', true],
    ['retry_policy_version', 'text', true],
    ['charlotte_prompt_version', 'text', true],
    ['charlotte_contract_version', 'text', true],
    ['wilbur_record_version', 'text', true],
    ['created_at', 'timestamp with time zone', true],
    ['updated_at', 'timestamp with time zone', true],
    ['answer_prompt_digest', 'character(64)', false],
    ['portia_current_candidate_id', 'text', false],
    ['portia_active_model_request_id', 'uuid', false],
    ['portia_failed_attempt_count', 'smallint', true],
    ['portia_failure_limit', 'smallint', true],
    ['portia_completed_candidate_ids', 'jsonb', true],
    ['portia_assessment_drafts', 'jsonb', true],
    ['charlotte_active_model_request_id', 'uuid', false],
    ['charlotte_failed_attempt_count', 'smallint', true],
    ['charlotte_failure_limit', 'smallint', true],
  ],
  portia_reviews: [
    ['id', 'uuid', true],
    ['clerk_user_id', 'text', true],
    ['lifecycle_run_id', 'uuid', true],
    ['model_request_id', 'uuid', true],
    ['input_digest', 'character(64)', true],
    ['output_digest', 'character(64)', true],
    ['prompt_version', 'text', true],
    ['contract_version', 'text', true],
    ['review', 'jsonb', true],
    ['created_at', 'timestamp with time zone', true],
  ],
  gate_decisions: [
    ['id', 'uuid', true],
    ['clerk_user_id', 'text', true],
    ['lifecycle_run_id', 'uuid', true],
    ['algorithm_version', 'text', true],
    ['input_digest', 'character(64)', true],
    ['passed', 'boolean', true],
    ['result', 'jsonb', true],
    ['created_at', 'timestamp with time zone', true],
    ['answer_user_prompt', 'text', false],
    ['answer_user_prompt_sha256', 'character(64)', false],
  ],
  charlotte_results: [
    ['id', 'uuid', true],
    ['clerk_user_id', 'text', true],
    ['lifecycle_run_id', 'uuid', true],
    ['model_request_id', 'uuid', true],
    ['input_digest', 'character(64)', true],
    ['output_digest', 'character(64)', true],
    ['prompt_version', 'text', true],
    ['contract_version', 'text', true],
    ['result', 'jsonb', true],
    ['rendered_answer', 'text', true],
    ['created_at', 'timestamp with time zone', true],
  ],
  wilbur_actions: [
    ['id', 'uuid', true],
    ['clerk_user_id', 'text', true],
    ['lifecycle_run_id', 'uuid', true],
    ['charlotte_action_index', 'smallint', false],
    ['idempotency_key', 'uuid', true],
    ['request_digest', 'character(64)', true],
    ['actor', 'text', true],
    ['action', 'text', true],
    ['tested_assumption', 'text', true],
    ['expected_observation', 'text', true],
    ['decision_threshold', 'text', true],
    ['review_horizon', 'text', true],
    ['status', 'text', true],
    ['revision', 'bigint', true],
    ['record_version', 'text', true],
    ['created_at', 'timestamp with time zone', true],
    ['updated_at', 'timestamp with time zone', true],
  ],
  wilbur_observations: [
    ['id', 'uuid', true],
    ['clerk_user_id', 'text', true],
    ['action_id', 'uuid', true],
    ['idempotency_key', 'uuid', true],
    ['request_digest', 'character(64)', true],
    ['observed_at', 'timestamp with time zone', true],
    ['observation', 'text', true],
    ['evidence_classification', 'text', true],
    ['expected_effect', 'text', true],
    ['unexpected_effect', 'text', true],
    ['stakeholder_response', 'text', true],
    ['assumption_result', 'text', true],
    ['next_decision', 'text', true],
    ['record_version', 'text', true],
    ['created_at', 'timestamp with time zone', true],
  ],
  lifecycle_events: [
    ['id', 'uuid', true],
    ['clerk_user_id', 'text', true],
    ['lifecycle_run_id', 'uuid', true],
    ['sequence', 'bigint', true],
    ['stage', 'text', true],
    ['activity_type', 'text', true],
    ['state_from', 'text', false],
    ['state_to', 'text', true],
    ['input_entity_ids', 'jsonb', true],
    ['output_entity_ids', 'jsonb', true],
    ['responsible_agent_ids', 'jsonb', true],
    ['configuration_digest', 'character(64)', true],
    ['status', 'text', true],
    ['event_version', 'smallint', true],
    ['created_at', 'timestamp with time zone', true],
  ],
  research_requests: [
    ['id', 'uuid', true],
    ['clerk_user_id', 'text', true],
    ['game_id', 'uuid', true],
    ['lifecycle_run_id', 'uuid', false],
    ['stage', 'text', true],
    ['requested_by', 'text', true],
    ['policy_version', 'text', true],
    ['materiality', 'text', false],
    ['reason', 'text', true],
    ['query', 'text', false],
    ['status', 'text', true],
    ['provider', 'text', true],
    ['transport', 'text', true],
    ['model', 'text', false],
    ['invocation_limit', 'smallint', true],
    ['result_limit', 'smallint', true],
    ['source_limit', 'smallint', true],
    ['timeout_ms', 'integer', true],
    ['synthesis_character_limit', 'integer', true],
    ['attempt_count', 'smallint', true],
    ['executed_queries', 'jsonb', true],
    ['search_synthesis', 'text', false],
    ['direct_page_text_fetched', 'boolean', true],
    ['retrieved_facts', 'jsonb', true],
    ['omitted_source_count', 'smallint', true],
    ['injection_signals', 'jsonb', true],
    ['content_digest', 'character(64)', false],
    ['failure_code', 'text', false],
    ['started_at', 'timestamp with time zone', false],
    ['completed_at', 'timestamp with time zone', false],
    ['created_at', 'timestamp with time zone', true],
    ['updated_at', 'timestamp with time zone', true],
  ],
  research_sources: [
    ['id', 'uuid', true],
    ['clerk_user_id', 'text', true],
    ['research_request_id', 'uuid', true],
    ['ordinal', 'smallint', true],
    ['citation_id', 'text', true],
    ['title', 'text', true],
    ['url', 'text', true],
    ['hostname', 'text', true],
    ['trust', 'text', true],
    ['discovered_from', 'text', true],
    ['created_at', 'timestamp with time zone', true],
  ],
}

const RUNTIME_INDEX_CONTRACT = [
  {
    index_name: 'games_one_current_per_user',
    table_name: 'games',
    key_columns: 'clerk_user_id',
    predicate: 'is_current',
  },
  {
    index_name:
      'model_requests_one_succeeded_operation_per_game',
    table_name: 'model_requests',
    key_columns: 'game_id,operation',
    predicate:
      "((game_id IS NOT NULL) AND (status = 'succeeded'::text))",
  },
  {
    index_name: 'lifecycle_runs_game_id_key',
    table_name: 'lifecycle_runs',
    key_columns: 'game_id',
    predicate: null,
  },
  {
    index_name:
      'research_requests_game_id_stage_policy_version_key',
    table_name: 'research_requests',
    key_columns: 'game_id,stage,policy_version',
    predicate: null,
  },
  {
    index_name:
      'research_sources_research_request_id_ordinal_key',
    table_name: 'research_sources',
    key_columns: 'research_request_id,ordinal',
    predicate: null,
  },
  {
    index_name: 'research_sources_research_request_id_url_key',
    table_name: 'research_sources',
    key_columns: 'research_request_id,url',
    predicate: null,
  },
]

const runtimeColumnContractRows = Object.entries(
  RUNTIME_COLUMN_CONTRACT,
).flatMap(([tableName, columns]) =>
  columns.map(([columnName, dataType, notNull], index) => ({
    table_name: tableName,
    column_name: columnName,
    ordinal_position: index + 1,
    data_type: dataType,
    not_null: notNull,
  })),
)

const runtimePrivilegeContractRows = Object.entries(
  RUNTIME_TABLE_PRIVILEGE_CONTRACT,
).flatMap(([tableName, grantedPrivileges]) =>
  RUNTIME_TABLE_PRIVILEGES.map((privilege) => ({
    table_name: tableName,
    privilege,
    allowed: grantedPrivileges.includes(privilege),
  })),
)

const runtimeColumnPrivilegeContractRows = Object.entries(
  RUNTIME_COLUMN_CONTRACT,
).flatMap(([tableName, columns]) =>
  columns.flatMap(([columnName]) =>
    RUNTIME_COLUMN_PRIVILEGES.map((privilege) => ({
      table_name: tableName,
      column_name: columnName,
      privilege,
      allowed:
        RUNTIME_TABLE_PRIVILEGE_CONTRACT[tableName].includes(privilege) ||
        (
          tableName === 'gate_decisions' &&
          privilege === 'UPDATE' &&
          (
            columnName === 'answer_user_prompt' ||
            columnName === 'answer_user_prompt_sha256'
          )
        ),
    })),
  ),
)

const RUNTIME_COMPATIBILITY_SQL = `
  /* webchess_runtime_compatibility_probe */
  WITH
  active_schema AS (
    SELECT current_schema() AS schema_name
  ),
  expected_columns AS (
    SELECT *
    FROM jsonb_to_recordset($1::jsonb) AS expected (
      table_name text,
      column_name text,
      ordinal_position integer,
      data_type text,
      not_null boolean
    )
  ),
  expected_tables AS (
    SELECT DISTINCT table_name
    FROM expected_columns
  ),
  actual_tables AS (
    SELECT relation.relname AS table_name
    FROM pg_catalog.pg_class AS relation
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    INNER JOIN active_schema
      ON active_schema.schema_name = namespace.nspname
    WHERE relation.relkind IN ('r', 'p')
  ),
  actual_columns AS (
    SELECT
      relation.relname AS table_name,
      attribute.attname AS column_name,
      attribute.attnum::integer AS ordinal_position,
      pg_catalog.format_type(
        attribute.atttypid,
        attribute.atttypmod
      ) AS data_type,
      attribute.attnotnull AS not_null
    FROM pg_catalog.pg_class AS relation
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    INNER JOIN active_schema
      ON active_schema.schema_name = namespace.nspname
    INNER JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
    WHERE relation.relkind IN ('r', 'p')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  expected_privileges AS (
    SELECT *
    FROM jsonb_to_recordset($2::jsonb) AS expected (
      table_name text,
      privilege text,
      allowed boolean
    )
  ),
  actual_privileges AS (
    SELECT
      expected.table_name,
      expected.privilege,
      CASE
        WHEN relation.oid IS NULL THEN NULL
        ELSE pg_catalog.has_table_privilege(
          current_user,
          relation.oid,
          expected.privilege
        )
      END AS allowed
    FROM expected_privileges AS expected
    CROSS JOIN active_schema
    LEFT JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.nspname = active_schema.schema_name
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.relnamespace = namespace.oid
      AND relation.relname = expected.table_name
      AND relation.relkind IN ('r', 'p')
  ),
  expected_column_privileges AS (
    SELECT *
    FROM jsonb_to_recordset($4::jsonb) AS expected (
      table_name text,
      column_name text,
      privilege text,
      allowed boolean
    )
  ),
  actual_column_privileges AS (
    SELECT
      expected.table_name,
      expected.column_name,
      expected.privilege,
      CASE
        WHEN relation.oid IS NULL THEN NULL
        ELSE pg_catalog.has_column_privilege(
          current_user,
          relation.oid,
          expected.column_name,
          expected.privilege
        )
      END AS allowed
    FROM expected_column_privileges AS expected
    CROSS JOIN active_schema
    LEFT JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.nspname = active_schema.schema_name
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.relnamespace = namespace.oid
      AND relation.relname = expected.table_name
      AND relation.relkind IN ('r', 'p')
  ),
  expected_indexes AS (
    SELECT *
    FROM jsonb_to_recordset($3::jsonb) AS expected (
      index_name text,
      table_name text,
      key_columns text,
      predicate text
    )
  ),
  actual_indexes AS (
    SELECT
      index_relation.relname AS index_name,
      table_relation.relname AS table_name,
      array_to_string(
        ARRAY(
          SELECT pg_catalog.pg_get_indexdef(
            index_catalog.indexrelid,
            key_position,
            true
          )
          FROM generate_series(
            1,
            index_catalog.indnkeyatts
          ) AS key_position
          ORDER BY key_position
        ),
        ','
      ) AS key_columns,
      pg_catalog.pg_get_expr(
        index_catalog.indpred,
        index_catalog.indrelid
      ) AS predicate,
      index_catalog.indisunique AS is_unique,
      index_catalog.indisvalid AS is_valid,
      index_catalog.indisready AS is_ready
    FROM pg_catalog.pg_index AS index_catalog
    INNER JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_catalog.indexrelid
    INNER JOIN pg_catalog.pg_class AS table_relation
      ON table_relation.oid = index_catalog.indrelid
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = table_relation.relnamespace
    INNER JOIN active_schema
      ON active_schema.schema_name = namespace.nspname
    INNER JOIN expected_indexes AS expected
      ON expected.index_name = index_relation.relname
  )
  SELECT
    active_schema.schema_name IS NOT NULL AS schema_resolved,
    COALESCE(
      pg_catalog.has_schema_privilege(
        current_user,
        active_schema.schema_name,
        'USAGE'
      ),
      false
    ) AS schema_usage,
    COALESCE(
      pg_catalog.has_schema_privilege(
        current_user,
        active_schema.schema_name,
        'CREATE'
      ),
      false
    ) AS schema_create,
    COALESCE(
      pg_catalog.has_schema_privilege(
        current_user,
        pg_catalog.to_regnamespace('public'),
        'CREATE'
      ),
      false
    ) AS public_schema_create,
    NOT EXISTS (
      (
        SELECT table_name FROM expected_tables
        EXCEPT
        SELECT table_name FROM actual_tables
      )
      UNION ALL
      (
        SELECT table_name FROM actual_tables
        EXCEPT
        SELECT table_name FROM expected_tables
      )
    ) AS tables_exact,
    NOT EXISTS (
      (
        SELECT
          table_name,
          column_name,
          ordinal_position,
          data_type,
          not_null
        FROM expected_columns
        EXCEPT
        SELECT
          table_name,
          column_name,
          ordinal_position,
          data_type,
          not_null
        FROM actual_columns
      )
      UNION ALL
      (
        SELECT
          table_name,
          column_name,
          ordinal_position,
          data_type,
          not_null
        FROM actual_columns
        EXCEPT
        SELECT
          table_name,
          column_name,
          ordinal_position,
          data_type,
          not_null
        FROM expected_columns
      )
    ) AS columns_exact,
    NOT EXISTS (
      SELECT 1
      FROM expected_privileges AS expected
      INNER JOIN actual_privileges AS actual
        USING (table_name, privilege)
      WHERE actual.allowed IS DISTINCT FROM expected.allowed
    ) AS privileges_exact,
    NOT EXISTS (
      SELECT 1
      FROM expected_column_privileges AS expected
      INNER JOIN actual_column_privileges AS actual
        USING (table_name, column_name, privilege)
      WHERE actual.allowed IS DISTINCT FROM expected.allowed
    ) AS column_privileges_exact,
    NOT EXISTS (
      SELECT 1
      FROM expected_tables AS expected
      CROSS JOIN active_schema
      LEFT JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.nspname = active_schema.schema_name
      LEFT JOIN pg_catalog.pg_class AS relation
        ON relation.relnamespace = namespace.oid
        AND relation.relname = expected.table_name
        AND relation.relkind IN ('r', 'p')
      WHERE relation.oid IS NULL
        OR pg_catalog.pg_has_role(
          current_user,
          relation.relowner,
          'MEMBER'
        )
    ) AS owner_isolated,
    NOT EXISTS (
      SELECT 1
      FROM expected_indexes AS expected
      LEFT JOIN actual_indexes AS actual
        USING (index_name)
      WHERE actual.index_name IS NULL
        OR actual.table_name IS DISTINCT FROM expected.table_name
        OR actual.key_columns IS DISTINCT FROM expected.key_columns
        OR actual.predicate IS DISTINCT FROM expected.predicate
        OR NOT actual.is_unique
        OR NOT actual.is_valid
        OR NOT actual.is_ready
    ) AS indexes_exact
  FROM active_schema
`

const RUNTIME_COMPATIBILITY_FIELDS = [
  'schema_resolved',
  'schema_usage',
  'schema_create',
  'public_schema_create',
  'tables_exact',
  'columns_exact',
  'privileges_exact',
  'column_privileges_exact',
  'owner_isolated',
  'indexes_exact',
]

const RUNTIME_COMPATIBILITY_FAILURES = [
  [
    'schema_resolved',
    false,
    'The runtime database search path does not resolve a WebChess application schema.',
  ],
  [
    'schema_usage',
    false,
    'The runtime role lacks USAGE on the WebChess application schema.',
  ],
  [
    'schema_create',
    true,
    'The runtime role must not have CREATE on the WebChess application schema.',
  ],
  [
    'public_schema_create',
    true,
    'The runtime role must not have CREATE on the public schema.',
  ],
  [
    'tables_exact',
    false,
    'The runtime database table set does not match this release.',
  ],
  [
    'columns_exact',
    false,
    'The runtime database column contract does not match this release.',
  ],
  [
    'indexes_exact',
    false,
    'The runtime database critical index contract does not match this release.',
  ],
  [
    'owner_isolated',
    false,
    'The runtime role must not own or be able to assume ownership of application tables.',
  ],
  [
    'privileges_exact',
    false,
    'The runtime database role privileges do not match the least-privilege contract.',
  ],
  [
    'column_privileges_exact',
    false,
    'The runtime database column privileges do not match the least-privilege contract.',
  ],
]

export class DeploymentMigrationError extends Error {
  constructor(message, migrationId) {
    super(message)
    this.name = 'DeploymentMigrationError'
    this.migrationId = migrationId
  }
}

export function deploymentMigrationChecksum(sql) {
  const normalized = `${sql.replace(/\r\n?/g, '\n').trim()}\n`
  return createHash('sha256').update(normalized).digest('hex')
}

function compareAscii(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function dollarQuoteAt(sql, offset) {
  return sql
    .slice(offset)
    .match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
}

function splitTrustedSqlStatements(sql) {
  const statements = []
  let current = ''
  let singleQuoted = false
  let doubleQuoted = false
  let lineComment = false
  let blockCommentDepth = 0
  let dollarQuote

  const finishStatement = () => {
    const statement = current.trim()
    if (statement.length > 0) statements.push(statement)
    current = ''
  }

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]
    const next = sql[index + 1]

    if (lineComment) {
      current += character
      if (character === '\n') lineComment = false
      continue
    }
    if (blockCommentDepth > 0) {
      current += character
      if (character === '/' && next === '*') {
        current += next
        blockCommentDepth += 1
        index += 1
      } else if (character === '*' && next === '/') {
        current += next
        blockCommentDepth -= 1
        index += 1
      }
      continue
    }
    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        current += dollarQuote
        index += dollarQuote.length - 1
        dollarQuote = undefined
      } else {
        current += character
      }
      continue
    }
    if (singleQuoted) {
      current += character
      if (character === "'" && next === "'") {
        current += next
        index += 1
      } else if (character === '\\' && next !== undefined) {
        current += next
        index += 1
      } else if (character === "'") {
        singleQuoted = false
      }
      continue
    }
    if (doubleQuoted) {
      current += character
      if (character === '"' && next === '"') {
        current += next
        index += 1
      } else if (character === '"') {
        doubleQuoted = false
      }
      continue
    }
    if (character === '-' && next === '-') {
      current += character + next
      lineComment = true
      index += 1
      continue
    }
    if (character === '/' && next === '*') {
      current += character + next
      blockCommentDepth = 1
      index += 1
      continue
    }
    if (character === "'") {
      current += character
      singleQuoted = true
      continue
    }
    if (character === '"') {
      current += character
      doubleQuoted = true
      continue
    }
    if (character === '$') {
      const tag = dollarQuoteAt(sql, index)
      if (tag) {
        current += tag
        dollarQuote = tag
        index += tag.length - 1
        continue
      }
    }
    if (character === ';') {
      finishStatement()
      continue
    }
    current += character
  }

  if (
    singleQuoted ||
    doubleQuoted ||
    blockCommentDepth > 0 ||
    dollarQuote !== undefined
  ) {
    throw new DeploymentMigrationError(
      'Canonical migration SQL contains an unterminated quoted value or comment.',
    )
  }

  finishStatement()
  return statements
}

function withoutLeadingComments(statement) {
  let remaining = statement.trimStart()
  while (remaining.startsWith('--') || remaining.startsWith('/*')) {
    if (remaining.startsWith('--')) {
      const lineEnd = remaining.indexOf('\n')
      remaining =
        lineEnd === -1
          ? ''
          : remaining.slice(lineEnd + 1).trimStart()
      continue
    }

    let depth = 0
    let index = 0
    for (; index < remaining.length - 1; index += 1) {
      const pair = remaining.slice(index, index + 2)
      if (pair === '/*') {
        depth += 1
        index += 1
      } else if (pair === '*/') {
        depth -= 1
        index += 1
        if (depth === 0) break
      }
    }
    remaining = remaining.slice(index + 1).trimStart()
  }
  return remaining
}

const FORBIDDEN_TRANSACTION_STATEMENT =
  /^(?:BEGIN|START\s+TRANSACTION|COMMIT|END(?:\s+(?:WORK|TRANSACTION))?|ROLLBACK|ABORT|SAVEPOINT|RELEASE\s+SAVEPOINT|PREPARE\s+TRANSACTION|SET\s+TRANSACTION)\b/i
const FORBIDDEN_NONTRANSACTIONAL_DDL =
  /^(?:(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY|REINDEX\b[\s\S]*\bCONCURRENTLY\b|VACUUM\b)/i

export function validateCanonicalMigrations(migrations) {
  if (!Array.isArray(migrations) || migrations.length === 0) {
    throw new DeploymentMigrationError(
      'No canonical database migrations were found.',
    )
  }

  let previousId
  for (const migration of migrations) {
    if (
      !migration ||
      typeof migration !== 'object' ||
      typeof migration.id !== 'string' ||
      !MIGRATION_ID_PATTERN.test(migration.id) ||
      typeof migration.sql !== 'string' ||
      migration.sql.trim().length === 0
    ) {
      throw new DeploymentMigrationError(
        'A canonical database migration is invalid.',
      )
    }

    const statements = splitTrustedSqlStatements(migration.sql)
    if (statements.length === 0) {
      throw new DeploymentMigrationError(
        `Canonical database migration ${migration.id} is empty.`,
        migration.id,
      )
    }
    for (const statement of statements) {
      const significantStatement = withoutLeadingComments(statement)
      if (
        FORBIDDEN_TRANSACTION_STATEMENT.test(significantStatement) ||
        FORBIDDEN_NONTRANSACTIONAL_DDL.test(significantStatement)
      ) {
        throw new DeploymentMigrationError(
          `Canonical database migration ${migration.id} contains transaction control or nontransactional DDL.`,
          migration.id,
        )
      }
    }

    if (
      previousId !== undefined &&
      compareAscii(previousId, migration.id) >= 0
    ) {
      throw new DeploymentMigrationError(
        'Canonical database migrations must have unique, increasing IDs.',
      )
    }
    previousId = migration.id
  }

  return migrations
}

export async function loadCanonicalMigrations(
  directoryUrl = DEFAULT_MIGRATION_DIRECTORY,
) {
  const entries = await readdir(directoryUrl, { withFileTypes: true })
  const filenames = []

  for (const entry of entries) {
    if (!entry.isFile() || !MIGRATION_FILENAME_PATTERN.test(entry.name)) {
      throw new DeploymentMigrationError(
        'The migration directory contains an unexpected entry.',
      )
    }
    filenames.push(entry.name)
  }

  filenames.sort(compareAscii)
  const migrations = await Promise.all(
    filenames.map(async (filename) => {
      const match = filename.match(MIGRATION_FILENAME_PATTERN)
      if (!match) {
        throw new DeploymentMigrationError(
          'A canonical migration filename is invalid.',
        )
      }
      return {
        id: match[1],
        sql: await readFile(new URL(filename, directoryUrl), 'utf8'),
      }
    }),
  )

  return validateCanonicalMigrations(migrations)
}

function parseMigrationLedger(rows) {
  if (!Array.isArray(rows)) {
    throw new DeploymentMigrationError(
      'The database migration ledger is invalid.',
    )
  }

  const parsed = []
  let previousId
  for (const row of rows) {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.id !== 'string' ||
      !MIGRATION_ID_PATTERN.test(row.id) ||
      typeof row.checksum !== 'string' ||
      !MIGRATION_CHECKSUM_PATTERN.test(row.checksum)
    ) {
      throw new DeploymentMigrationError(
        'The database migration ledger is invalid.',
      )
    }

    if (
      previousId !== undefined &&
      compareAscii(previousId, row.id) >= 0
    ) {
      throw new DeploymentMigrationError(
        'The database migration ledger is not uniquely ordered.',
      )
    }
    previousId = row.id
    parsed.push({ id: row.id, checksum: row.checksum })
  }

  return parsed
}

export function planCanonicalMigrations(migrations, databaseRows) {
  validateCanonicalMigrations(migrations)
  const ledger = parseMigrationLedger(databaseRows)
  const expectedById = new Map(
    migrations.map((migration) => [
      migration.id,
      deploymentMigrationChecksum(migration.sql),
    ]),
  )

  for (const databaseMigration of ledger) {
    const expectedChecksum = expectedById.get(databaseMigration.id)
    if (expectedChecksum === undefined) {
      throw new DeploymentMigrationError(
        `Database migration ${databaseMigration.id} is not present in the release.`,
        databaseMigration.id,
      )
    }
    if (databaseMigration.checksum !== expectedChecksum) {
      throw new DeploymentMigrationError(
        `Database migration ${databaseMigration.id} has a checksum mismatch.`,
        databaseMigration.id,
      )
    }
  }

  for (let index = 0; index < ledger.length; index += 1) {
    if (ledger[index].id !== migrations[index]?.id) {
      throw new DeploymentMigrationError(
        'The database migration ledger is not an exact prefix of this release.',
      )
    }
  }

  return migrations.slice(ledger.length)
}

export function assertCanonicalMigrationCompatibility(
  migrations,
  databaseRows,
) {
  const missing = planCanonicalMigrations(migrations, databaseRows)
  if (missing.length > 0) {
    throw new DeploymentMigrationError(
      `Database migration ${missing[0].id} has not been applied.`,
      missing[0].id,
    )
  }
}

export async function readCanonicalMigrationLedger(client) {
  try {
    const result = await client.query(READ_MIGRATIONS_SQL)
    return parseMigrationLedger(result.rows)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      error.code === '42P01'
    ) {
      throw new DeploymentMigrationError(
        'The database migration ledger is missing.',
      )
    }
    throw error
  }
}

export async function assertRuntimeDatabaseCompatibility(client) {
  const inspection = await client.query(
    RUNTIME_COMPATIBILITY_SQL,
    [
      JSON.stringify(runtimeColumnContractRows),
      JSON.stringify(runtimePrivilegeContractRows),
      JSON.stringify(RUNTIME_INDEX_CONTRACT),
      JSON.stringify(runtimeColumnPrivilegeContractRows),
    ],
  )
  const row = inspection.rows?.[0]

  if (
    !row ||
    RUNTIME_COMPATIBILITY_FIELDS.some(
      (field) => typeof row[field] !== 'boolean',
    )
  ) {
    throw new DeploymentMigrationError(
      'The runtime database compatibility probe returned an invalid result.',
    )
  }

  for (const [field, failedValue, message] of
    RUNTIME_COMPATIBILITY_FAILURES) {
    if (row[field] === failedValue) {
      throw new DeploymentMigrationError(message)
    }
  }
}

export async function applyCanonicalMigrations(client, migrations) {
  validateCanonicalMigrations(migrations)
  let transactionStarted = false

  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    transactionStarted = true
    await client.query(
      'SELECT pg_advisory_xact_lock($1::bigint)',
      [MIGRATION_LOCK_KEY],
    )
    const inspection = await client.query(
      INSPECT_MIGRATION_LEDGER_SQL,
    )
    const inspectionRow = inspection.rows?.[0]
    if (
      !inspectionRow ||
      (
        inspectionRow.migration_ledger !== null &&
        typeof inspectionRow.migration_ledger !== 'string'
      ) ||
      typeof inspectionRow.has_webchess_objects !== 'boolean'
    ) {
      throw new DeploymentMigrationError(
        'The existing database schema could not be inspected safely.',
      )
    }
    if (
      inspectionRow.migration_ledger === null &&
      inspectionRow.has_webchess_objects
    ) {
      throw new DeploymentMigrationError(
        'Existing WebChess schema objects have no migration ledger; automatic adoption is forbidden.',
      )
    }
    await client.query(CREATE_MIGRATIONS_TABLE_SQL)

    const databaseRows = await readCanonicalMigrationLedger(client)
    const pending = planCanonicalMigrations(migrations, databaseRows)

    for (const migration of pending) {
      const checksum = deploymentMigrationChecksum(migration.sql)
      await client.query(migration.sql)
      await client.query(
        `
          INSERT INTO webchess_schema_migrations (id, checksum)
          VALUES ($1, $2)
        `,
        [migration.id, checksum],
      )
    }

    await client.query('COMMIT')
    transactionStarted = false
    return {
      applied: pending.map((migration) => migration.id),
      alreadyApplied: databaseRows.map((migration) => migration.id),
    }
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the original migration failure.
      }
    }
    throw error
  }
}

export async function checkCanonicalMigrationsReadOnly(
  client,
  migrations,
) {
  let transactionStarted = false

  try {
    await client.query(
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    )
    transactionStarted = true
    await assertRuntimeDatabaseCompatibility(client)
    const databaseRows = await readCanonicalMigrationLedger(client)
    assertCanonicalMigrationCompatibility(migrations, databaseRows)
    await client.query('COMMIT')
    transactionStarted = false
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the original compatibility failure.
      }
    }
    throw error
  }
}
