import 'server-only'

export {
  canonicalJson,
  hashCanonicalJson,
  hashRateLimitKey,
  hmacSha256Hex,
  sha256Hex,
} from './hash'
export type { CanonicalJson } from './hash'

export {
  MigrationDriftError,
  splitSqlStatements,
} from './migrations'
export type { Migration, MigrationRunResult } from './migrations'

export {
  databaseScalarSchemas,
  deletedUserTombstoneRowSchema,
  gameStartRequestRowSchema,
  gameEventKindSchema,
  gameEventRowSchema,
  gameEventSourceSchema,
  gateDecisionRowSchema,
  gameRowSchema,
  gameSideSchema,
  gameStatusSchema,
  lifecycleEventRowSchema,
  lifecycleRunRowSchema,
  modelConcurrencySlotRowSchema,
  modelOperationSchema,
  modelRequestRowSchema,
  modelRequestStatusSchema,
  parseOptionalResultRow,
  parseResultRows,
  parseSingleResultRow,
  portiaReviewRowSchema,
  rateBucketRowSchema,
  charlotteResultRowSchema,
  usageBucketRowSchema,
  userControlsRowSchema,
  wilburActionRowSchema,
  wilburMutationRequestRowSchema,
  wilburObservationRowSchema,
} from './rows'
export type {
  GameEventRow,
  GameRow,
  GameStatus,
  GameStartRequestRow,
  DeletedUserTombstoneRow,
  ModelConcurrencySlotRow,
  ModelRequestRow,
  LifecycleRunRow,
  LifecycleEventRow,
  PortiaReviewRow,
  GateDecisionRow,
  CharlotteResultRow,
  WilburActionRow,
  WilburMutationRequestRow,
  WilburObservationRow,
  RateBucketRow,
  UsageBucketRow,
  UserControlsRow,
} from './rows'

export {
  isLoopbackHostname,
  isVercelRuntime,
  parseLoopbackPostgresUrl,
  resolveDatabaseAdapterKind,
  shouldUseLocalPostgresWireProtocol,
} from './adapter-kind'
export type { DatabaseAdapterKind } from './adapter-kind'
export {
  assertDedicatedLocalSchema,
  ensureLocalHostedSchema,
  loadCanonicalFilesystemMigrations,
} from './local-postgres'
export { createNeonSqlAdapter, getDatabase } from './sql'
export { createPostgresSqlAdapter } from './postgres'
export type {
  PostgresSqlAdapter,
  PostgresSqlAdapterOptions,
} from './postgres'
export type {
  SqlAdapter,
  SqlResult,
  SqlRow,
  SqlStatement,
  SqlTransactionOptions,
} from './sql'
