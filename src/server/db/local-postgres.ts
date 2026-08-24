import 'server-only'

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runMigrations } from './migrations'
import type { Migration } from './migrations'
import type { SqlAdapter } from './sql'

const MIGRATION_FILENAME = /^(\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/u
const preparedDatabases = new WeakMap<SqlAdapter, Promise<void>>()

// This explicit allowlist is the ownership boundary for the launcher's
// dedicated schema. PostgreSQL represents tables and indexes alike in
// pg_class, so both canonical relation kinds are named here. A migration that
// creates another relation must extend this list deliberately.
const CANONICAL_LOCAL_TABLE_RELATIONS = [
  'charlotte_results',
  'deleted_user_tombstones',
  'game_events',
  'game_start_requests',
  'games',
  'gate_decisions',
  'lifecycle_events',
  'lifecycle_runs',
  'model_concurrency_slots',
  'model_requests',
  'portia_reviews',
  'rate_buckets',
  'research_requests',
  'research_sources',
  'usage_buckets',
  'user_controls',
  'web_memory_links',
  'webchess_schema_migrations',
  'wilbur_actions',
  'wilbur_mutation_requests',
  'wilbur_observations',
] as const

const CANONICAL_LOCAL_INDEX_RELATIONS = [
  'charlotte_results_lifecycle_run_id_key',
  'charlotte_results_model_request_id_key',
  'charlotte_results_pkey',
  'deleted_user_tombstones_pkey',
  'game_events_game_id_idempotency_key_key',
  'game_events_pkey',
  'game_start_requests_owner_time',
  'game_start_requests_pkey',
  'games_one_current_per_user',
  'games_owner_created',
  'games_pkey',
  'games_id_clerk_user_id_key',
  'gate_decisions_lifecycle_run_id_key',
  'gate_decisions_pkey',
  'lifecycle_events_lifecycle_run_id_sequence_key',
  'lifecycle_events_owner_created',
  'lifecycle_events_pkey',
  'lifecycle_runs_game_id_key',
  'lifecycle_runs_owner_created',
  'lifecycle_runs_parent',
  'lifecycle_runs_pkey',
  'lifecycle_runs_root_run_id_field_generation_game_attempt_key',
  'model_concurrency_slots_clerk_user_id_key',
  'model_concurrency_slots_expiry',
  'model_concurrency_slots_pkey',
  'model_concurrency_slots_request_id_key',
  'model_requests_clerk_user_id_operation_idempotency_key_key',
  'model_requests_game',
  'model_requests_one_succeeded_operation_per_game',
  'model_requests_owner_time',
  'model_requests_pkey',
  'portia_reviews_lifecycle_run_id_key',
  'portia_reviews_model_request_id_key',
  'portia_reviews_pkey',
  'rate_buckets_expiry',
  'rate_buckets_pkey',
  'research_requests_game_id_stage_policy_version_key',
  'research_requests_id_clerk_user_id_key',
  'research_requests_lifecycle_created',
  'research_requests_owner_created',
  'research_requests_pkey',
  'research_sources_pkey',
  'research_sources_request_ordinal',
  'research_sources_research_request_id_ordinal_key',
  'research_sources_research_request_id_url_key',
  'usage_buckets_pkey',
  'usage_buckets_updated',
  'user_controls_pkey',
  'web_memory_links_owner_created',
  'web_memory_links_pkey',
  'web_memory_links_source_observation',
  'web_memory_links_target_game_id_source_observation_id_key',
  'web_memory_links_target_game_id_selection_ordinal_key',
  'webchess_schema_migrations_pkey',
  'wilbur_actions_clerk_user_id_idempotency_key_key',
  'wilbur_actions_one_per_charlotte_suggestion',
  'wilbur_actions_owner_follow_up',
  'wilbur_actions_pkey',
  'wilbur_actions_run_created',
  'wilbur_mutation_requests_pending_owner',
  'wilbur_mutation_requests_pkey',
  'wilbur_mutation_requests_target_action',
  'wilbur_mutation_requests_target_game_created',
  'wilbur_observations_action_created',
  'wilbur_observations_action_id_idempotency_key_key',
  'wilbur_observations_id_clerk_user_id_key',
  'wilbur_observations_pkey',
] as const

export async function loadCanonicalFilesystemMigrations(
  cwd: string = process.cwd(),
): Promise<readonly Migration[]> {
  const directory = join(cwd, 'db', 'migrations')
  const entries = await readdir(directory, { withFileTypes: true })
  const filenames = entries.map((entry) => {
    if (!entry.isFile() || !MIGRATION_FILENAME.test(entry.name)) {
      throw new Error('The local migration directory contains an unexpected entry.')
    }
    return entry.name
  }).sort()
  if (filenames.length === 0) {
    throw new Error('The local WebChess runtime has no database migrations.')
  }
  return Promise.all(filenames.map(async (filename) => ({
    id: MIGRATION_FILENAME.exec(filename)?.[1] ?? '',
    sql: await readFile(join(directory, filename), 'utf8'),
  })))
}

export async function assertDedicatedLocalSchema(
  database: SqlAdapter,
): Promise<void> {
  const inspection = await database.query({
    text: `
      WITH current_relations AS MATERIALIZED (
        SELECT
          relation.relkind::text AS relation_kind,
          relation.relname AS relation_name
        FROM pg_catalog.pg_class AS relation
        INNER JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = current_schema()
      )
      SELECT
        current_schema()::text AS schema_name,
        COUNT(*)::integer AS relation_count,
        COALESCE(
          BOOL_OR(
            relation_kind = 'r'
            AND relation_name = 'webchess_schema_migrations'
          ),
          false
        ) AS has_migration_ledger,
        (
          SELECT relation_kind || ':' || relation_name
          FROM current_relations AS candidate
          WHERE NOT (
            (
              candidate.relation_kind = 'r'
              AND candidate.relation_name = ANY($1::text[])
            )
            OR (
              candidate.relation_kind = 'i'
              AND candidate.relation_name = ANY($2::text[])
            )
          )
          ORDER BY candidate.relation_kind, candidate.relation_name
          LIMIT 1
        ) AS unexpected_relation
      FROM current_relations
    `,
    values: [
      [...CANONICAL_LOCAL_TABLE_RELATIONS],
      [...CANONICAL_LOCAL_INDEX_RELATIONS],
    ],
  })
  const row = inspection.rows[0]
  if (
    !row ||
    typeof row.schema_name !== 'string' ||
    typeof row.relation_count !== 'number' ||
    !Number.isSafeInteger(row.relation_count) ||
    row.relation_count < 0 ||
    typeof row.has_migration_ledger !== 'boolean' ||
    !(
      row.unexpected_relation === null ||
      typeof row.unexpected_relation === 'string'
    )
  ) {
    throw new Error('The dedicated local database could not be inspected safely.')
  }
  if (row.unexpected_relation !== null) {
    throw new Error(
      `The dedicated local database contains an unexpected relation (${row.unexpected_relation}); automatic migration is forbidden.`,
    )
  }
  if (row.relation_count > 0 && !row.has_migration_ledger) {
    throw new Error(
      'The dedicated local database has relations without a migration ledger; automatic adoption is forbidden.',
    )
  }
}

async function prepareLocalSchema(database: SqlAdapter): Promise<void> {
  await assertDedicatedLocalSchema(database)
  await runMigrations(database, await loadCanonicalFilesystemMigrations())
}

/**
 * Applies canonical migrations to a loopback database the first time this
 * adapter is seen. Hosted Neon still uses the guarded owner command instead.
 */
export async function ensureLocalHostedSchema(
  database: SqlAdapter,
): Promise<void> {
  let pending = preparedDatabases.get(database)
  if (!pending) {
    pending = prepareLocalSchema(database)
    preparedDatabases.set(database, pending)
  }

  try {
    await pending
  } catch (error) {
    preparedDatabases.delete(database)
    throw error
  }
}
