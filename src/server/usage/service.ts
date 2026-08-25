import { randomUUID } from 'node:crypto'

import type { SqlResult, SqlRow } from '../db/sql'
import {
  hashDeletedUserKey,
  hashIpRateKey,
  hashUserRateKey,
} from './identifiers'
import {
  buildBeginProviderCallStatement,
  buildActivateReplayGameStatement,
  buildAcquireUsageLockStatement,
  buildAttachModelRequestGameStatement,
  buildCleanupExpiredLeasesStatement,
  buildCleanupExpiredRateBucketsStatement,
  buildConsumeAccountExportRateStatement,
  buildConsumeGameMoveRateStatement,
  buildConsumeReplayGameStartStatement,
  buildConsumeWilburMutationRateStatement,
  buildDeleteAccountDataStatement,
  buildDeleteAccountGamesStatement,
  buildEnsureUsageBucketsStatement,
  buildGetModelRequestByIdempotencyKeyStatement,
  buildGetModelRequestResultStatement,
  buildGetLatestModelRequestForGameStatement,
  buildGetSucceededModelResultForGameStatement,
  buildReleaseReservationStatement,
  buildReserveModelRequestStatement,
  buildSettleModelRequestStatement,
  buildUsageSummaryStatement,
  buildVerifyReplayGameInvariantStatement,
} from './queries'
import type {
  AttachModelRequestGameInput,
  AttachModelRequestGameResult,
  BeginProviderCallInput,
  BeginProviderCallResult,
  ConsumeAccountExportRateInput,
  ConsumeAccountExportRateResult,
  ConsumeGameMoveRateInput,
  ConsumeGameMoveRateResult,
  ConsumeReplayGameStartInput,
  ConsumeReplayGameStartResult,
  ConsumeWilburMutationRateInput,
  ConsumeWilburMutationRateResult,
  DeleteAccountDataResult,
  DeleteAccountDataOptions,
  GetModelRequestByIdempotencyKeyInput,
  GetModelRequestResultInput,
  GetModelRequestResultResult,
  GetLatestModelRequestForGameInput,
  ModelOperation,
  ModelRequestStatus,
  ModelResultPayload,
  ReconcileExpiredLeasesResult,
  ReleaseReservationInput,
  ReleaseReservationResult,
  ReserveModelRequestInput,
  ReserveModelRequestResult,
  SettleModelRequestInput,
  SettleModelRequestResult,
  UsageController,
  UsageControllerDependencies,
  UsageDenialCode,
  UsageDenied,
  UsageSummary,
} from './types'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/

interface ReservationRow extends SqlRow {
  readonly code: string
  readonly retry_at: Date | string | null
  readonly request_id: string | null
  readonly game_id: string | null
  readonly status: ModelRequestStatus | null
  readonly lease_token: string | null
  readonly lease_expires_at: Date | string | null
}

interface DecisionRow extends SqlRow {
  readonly code: string
}

interface MoveRateRow extends SqlRow {
  readonly code: string
  readonly retry_at: Date | string | null
  readonly user_count: number | string
  readonly ip_count: number | string
  readonly resets_at: Date | string
}

interface WilburRateRow extends MoveRateRow {
  readonly persisted: number | string
}

interface ReplayGameStartRow extends SqlRow {
  readonly code: string
  readonly retry_at: Date | string | null
  readonly game_id: string | null
}

interface ModelResultRow extends SqlRow {
  readonly request_id: string
  readonly game_id: string | null
  readonly operation: ModelOperation
  readonly request_sha256: string
  readonly prompt_version: string
  readonly status: ModelRequestStatus
  readonly result_payload: ModelResultPayload | null
}

interface SummaryRow extends SqlRow {
  readonly code: string
  readonly retry_at: Date | string | null
  readonly model_used: bigint | number | string
  readonly model_reserved: bigint | number | string
  readonly game_used: bigint | number | string
  readonly game_reserved: bigint | number | string
  readonly model_limit: number | string
  readonly game_limit: number | string
  readonly active_count: number | string
}

interface ReconciliationRow extends SqlRow {
  readonly expired_requests: number | string
  readonly cleared_slots: number | string
}

interface AccountDeletionRow extends SqlRow {
  readonly code: 'ALLOW' | 'ACTIVE_MODEL_REQUEST'
  readonly retry_at: Date | string | null
  readonly deleted: boolean
}

const DENIAL_STATUS: Readonly<
  Record<UsageDenialCode, UsageDenied['httpStatus']>
> = {
  ACCOUNT_SUSPENDED: 403,
  ACCOUNT_DELETED: 403,
  ACCOUNT_TEMPORARILY_BLOCKED: 403,
  GAME_START_DAILY_QUOTA_EXCEEDED: 429,
  MODEL_DAILY_QUOTA_EXCEEDED: 429,
  MODEL_GLOBAL_DAILY_CAPACITY: 503,
  MODEL_HOURLY_RATE_LIMITED: 429,
  IP_HOURLY_RATE_LIMITED: 429,
  GAME_START_HOURLY_RATE_LIMITED: 429,
  IP_GAME_START_HOURLY_RATE_LIMITED: 429,
  GAME_MOVE_HOURLY_RATE_LIMITED: 429,
  IP_GAME_MOVE_HOURLY_RATE_LIMITED: 429,
  ACCOUNT_EXPORT_HOURLY_RATE_LIMITED: 429,
  IP_ACCOUNT_EXPORT_HOURLY_RATE_LIMITED: 429,
  WILBUR_ACTION_HOURLY_RATE_LIMITED: 429,
  IP_WILBUR_ACTION_HOURLY_RATE_LIMITED: 429,
  WILBUR_OBSERVATION_HOURLY_RATE_LIMITED: 429,
  IP_WILBUR_OBSERVATION_HOURLY_RATE_LIMITED: 429,
  WILBUR_MUTATION_EXPIRED: 409,
  WILBUR_MUTATION_CONFLICT: 409,
  MODEL_USER_CONCURRENCY_LIMIT: 429,
  MODEL_GLOBAL_CAPACITY: 503,
  GAME_OWNERSHIP_CONFLICT: 409,
  GAME_REVISION_CONFLICT: 409,
  GAME_INVALID_REPLAY_STATE: 409,
  IDEMPOTENCY_CONFLICT: 409,
}

function assertUuid(value: string, name: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a UUID.`)
  }
}

function assertText(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): void {
  const length = value.trim().length
  if (length < minimum || length > maximum) {
    throw new TypeError(
      `${name} must contain between ${minimum} and ${maximum} characters.`,
    )
  }
}

function assertSha256(value: string, name: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256 digest.`)
  }
}

function assertNonnegativeInteger(
  value: number | undefined,
  name: string,
): void {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new TypeError(`${name} must be a nonnegative safe integer.`)
  }
}

const FORBIDDEN_RESULT_KEYS = new Set([
  'api_key',
  'chain_of_thought',
  'raw_provider_response',
  'raw_reasoning',
  'reasoning',
])

function validateResultValue(
  value: unknown,
  path: string,
  depth: number,
): void {
  if (depth > 12) {
    throw new TypeError('resultPayload exceeds the maximum nesting depth.')
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain a finite number.`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateResultValue(item, `${path}[${index}]`, depth + 1),
    )
    return
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${path} contains a non-JSON value.`)
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain only plain JSON objects.`)
  }
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_RESULT_KEYS.has(key.toLowerCase())) {
      throw new TypeError(`${path}.${key} is not allowed in resultPayload.`)
    }
    validateResultValue(item, `${path}.${key}`, depth + 1)
  }
}

function validateResultPayload(value: ModelResultPayload): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError('resultPayload must be a JSON object.')
  }
  validateResultValue(value, 'resultPayload', 0)
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 512 * 1024) {
    throw new TypeError('resultPayload must not exceed 512 KiB.')
  }
}

function validateReservationInput(input: ReserveModelRequestInput): void {
  assertUuid(input.requestId, 'requestId')
  assertUuid(input.idempotencyKey, 'idempotencyKey')
  if (input.gameId !== undefined && input.gameId !== null) {
    assertUuid(input.gameId, 'gameId')
  }
  assertText(input.userId, 'userId', 3, 255)
  assertSha256(input.requestSha256, 'requestSha256')
  assertText(input.provider, 'provider', 1, 40)
  assertText(input.model, 'model', 1, 120)
  assertText(input.promptVersion, 'promptVersion', 1, 80)
  assertText(input.softwareVersion, 'softwareVersion', 1, 120)
  assertText(input.ipAddress, 'ipAddress', 1, 255)

  if (input.countsAsGameStart !== (input.operation === 'division')) {
    throw new TypeError(
      'Division requests must count as game starts; later lifecycle operations must not.',
    )
  }
  if (input.operation === 'answer') {
    if (
      !(input.leaseExpiresAtCap instanceof Date) ||
      !Number.isFinite(input.leaseExpiresAtCap.valueOf())
    ) {
      throw new TypeError(
        'Answer requests require a valid fixed leaseExpiresAtCap.',
      )
    }
  } else if (input.leaseExpiresAtCap !== undefined) {
    throw new TypeError(
      'leaseExpiresAtCap is only valid for Answer requests.',
    )
  }
}

function validateTransitionIdentity(input: {
  readonly userId: string
  readonly requestId: string
  readonly leaseToken: string
}): void {
  assertText(input.userId, 'userId', 3, 255)
  assertUuid(input.requestId, 'requestId')
  assertUuid(input.leaseToken, 'leaseToken')
}

function validateReplayGameStartInput(
  input: ConsumeReplayGameStartInput,
): void {
  assertText(input.userId, 'userId', 3, 255)
  assertUuid(input.sourceGameId, 'sourceGameId')
  assertUuid(input.idempotencyKey, 'idempotencyKey')
  assertText(input.ipAddress, 'ipAddress', 1, 255)
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  ) {
    throw new TypeError(
      'expectedRevision must be a nonnegative safe integer.',
    )
  }
}

function validateSettlement(input: SettleModelRequestInput): void {
  validateTransitionIdentity(input)

  const usage = input.usage
  if (usage !== undefined && typeof usage.reported !== 'boolean') {
    throw new TypeError('reported must be a boolean.')
  }
  assertNonnegativeInteger(usage?.inputTokens, 'inputTokens')
  assertNonnegativeInteger(usage?.cachedInputTokens, 'cachedInputTokens')
  assertNonnegativeInteger(
    usage?.cacheWriteInputTokens,
    'cacheWriteInputTokens',
  )
  assertNonnegativeInteger(usage?.outputTokens, 'outputTokens')
  assertNonnegativeInteger(usage?.reasoningTokens, 'reasoningTokens')
  assertNonnegativeInteger(usage?.totalTokens, 'totalTokens')

  if (input.outcome === 'succeeded') {
    if (input.providerResponseId !== undefined) {
      assertText(input.providerResponseId, 'providerResponseId', 1, 255)
    }
    assertSha256(input.responseSha256, 'responseSha256')
    validateResultPayload(input.resultPayload)
    return
  }

  assertText(input.failureCode, 'failureCode', 1, 80)
  if (input.providerResponseId !== undefined) {
    assertText(input.providerResponseId, 'providerResponseId', 1, 255)
  }
  if (
    input.providerHttpStatus !== undefined &&
    (!Number.isInteger(input.providerHttpStatus) ||
      input.providerHttpStatus < 100 ||
      input.providerHttpStatus > 599)
  ) {
    throw new TypeError('providerHttpStatus must be between 100 and 599.')
  }
}

function firstRow<Row extends SqlRow>(result: SqlResult): Row {
  const row = result.rows[0]
  if (!row) {
    throw new Error('Usage accounting query returned no decision row.')
  }
  return row as Row
}

function modelResultFromRows(
  rows: readonly SqlRow[],
): GetModelRequestResultResult {
  const row = rows[0] as ModelResultRow | undefined
  if (!row) {
    return { found: false }
  }
  if (
    row.operation !== 'division' &&
    row.operation !== 'answer' &&
    row.operation !== 'portia' &&
    row.operation !== 'charlotte'
  ) {
    throw new Error('Model result query returned an invalid operation.')
  }
  if (row.result_payload !== null) {
    validateResultPayload(row.result_payload)
  }
  return {
    found: true,
    requestId: row.request_id,
    gameId: row.game_id,
    operation: row.operation,
    requestSha256: row.request_sha256,
    promptVersion: row.prompt_version,
    status: row.status,
    resultPayload: row.result_payload,
  }
}

function isoTimestamp(value: Date | string | null): string | null {
  if (value === null) {
    return null
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.valueOf())) {
    throw new Error('Usage accounting returned an invalid timestamp.')
  }
  return date.toISOString()
}

function retryAfterSeconds(
  retryAt: Date | string | null,
  now: Date,
): number | null {
  if (retryAt === null) {
    return null
  }

  const timestamp = retryAt instanceof Date ? retryAt : new Date(retryAt)
  if (Number.isNaN(timestamp.valueOf())) {
    throw new Error('Usage accounting returned an invalid retry timestamp.')
  }
  return Math.max(1, Math.ceil((timestamp.valueOf() - now.valueOf()) / 1000))
}

function toSafeNumber(
  value: bigint | number | string,
  name: string,
): number {
  const number = typeof value === 'bigint' ? Number(value) : Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Usage accounting returned an invalid ${name}.`)
  }
  return number
}

function usageDenial(
  codeValue: string,
  retryAt: Date | string | null,
  now: Date,
): UsageDenied {
  if (!Object.hasOwn(DENIAL_STATUS, codeValue)) {
    throw new Error(`Unknown usage denial code: ${codeValue}`)
  }
  const code = codeValue as UsageDenialCode
  return {
    ok: false,
    code,
    httpStatus: DENIAL_STATUS[code],
    retryAfterSeconds: retryAfterSeconds(retryAt, now),
  }
}

export function createUsageController(
  dependencies: UsageControllerDependencies,
): UsageController {
  const { db, config } = dependencies
  const now = dependencies.now ?? (() => new Date())
  const nextUuid = dependencies.randomUuid ?? randomUUID

  return {
    async reserveModelRequest(
      input: ReserveModelRequestInput,
    ): Promise<ReserveModelRequestResult> {
      validateReservationInput(input)
      const requestedAt = now()
      const dayStart = new Date(requestedAt)
      dayStart.setUTCHours(0, 0, 0, 0)
      const leaseToken = nextUuid()
      assertUuid(leaseToken, 'generated lease token')

      const results = await db.transaction(
        [
          buildAcquireUsageLockStatement(),
          buildCleanupExpiredLeasesStatement(requestedAt),
          buildCleanupExpiredRateBucketsStatement(requestedAt),
          buildEnsureUsageBucketsStatement(
            input.userId,
            dayStart,
            requestedAt,
            hashDeletedUserKey(
              config.deletionHmacSecret,
              input.userId,
            ),
          ),
          buildReserveModelRequestStatement(input, config, {
            now: requestedAt,
            leaseToken,
            userRateKey: hashUserRateKey(config.hmacSecret, input.userId),
            ipRateKey: hashIpRateKey(config.hmacSecret, input.ipAddress),
            deletedUserKey: hashDeletedUserKey(
              config.deletionHmacSecret,
              input.userId,
            ),
          }),
        ],
        { isolationLevel: 'ReadCommitted' },
      )

      const reservationResult = results[4]
      if (!reservationResult) {
        throw new Error('Usage reservation transaction returned no result.')
      }
      const row = firstRow<ReservationRow>(reservationResult)

      if (row.code !== 'ALLOW' && row.code !== 'EXISTING') {
        return usageDenial(row.code, row.retry_at, requestedAt)
      }
      if (!row.request_id || !row.status) {
        throw new Error('Usage reservation did not return a request record.')
      }
      if (
        row.status === 'reserved' &&
        (row.lease_token === null || row.lease_expires_at === null)
      ) {
        throw new Error(
          'Reserved model request is missing its durable concurrency lease.',
        )
      }

      return {
        ok: true,
        kind: row.code === 'ALLOW' ? 'reserved' : 'existing',
        requestId: row.request_id,
        gameId: row.game_id,
        status: row.status,
        leaseToken: row.lease_token,
        leaseExpiresAt: isoTimestamp(row.lease_expires_at),
      }
    },

    async attachModelRequestGame(
      input: AttachModelRequestGameInput,
    ): Promise<AttachModelRequestGameResult> {
      assertText(input.userId, 'userId', 3, 255)
      assertUuid(input.requestId, 'requestId')
      assertUuid(input.gameId, 'gameId')
      const result = await db.transaction(
        [
          buildAcquireUsageLockStatement(),
          buildAttachModelRequestGameStatement(input, now()),
        ],
        { isolationLevel: 'ReadCommitted' },
      )
      const transactionResult = result[1]
      if (!transactionResult) {
        throw new Error('Game attachment transaction returned no result.')
      }
      const row = firstRow<DecisionRow>(transactionResult)

      if (row.code === 'ALLOW' || row.code === 'ALREADY_ATTACHED') {
        return {
          ok: true,
          attached: row.code === 'ALLOW',
        }
      }
      if (
        row.code !== 'REQUEST_NOT_FOUND' &&
        row.code !== 'GAME_NOT_FOUND' &&
        row.code !== 'INVALID_REQUEST_OPERATION' &&
        row.code !== 'INVALID_REQUEST_STATE' &&
        row.code !== 'GAME_LINK_CONFLICT'
      ) {
        throw new Error(`Unknown game attachment code: ${row.code}`)
      }
      return {
        ok: false,
        code: row.code,
        httpStatus: 409,
      }
    },

    async consumeGameMoveRate(
      input: ConsumeGameMoveRateInput,
    ): Promise<ConsumeGameMoveRateResult> {
      assertText(input.userId, 'userId', 3, 255)
      assertText(input.ipAddress, 'ipAddress', 1, 255)
      const requestedAt = now()
      const result = await db.transaction(
        [
          buildAcquireUsageLockStatement(),
          buildCleanupExpiredRateBucketsStatement(requestedAt),
          buildConsumeGameMoveRateStatement(input, config, {
            now: requestedAt,
            userRateKey: hashUserRateKey(config.hmacSecret, input.userId),
            ipRateKey: hashIpRateKey(config.hmacSecret, input.ipAddress),
            deletedUserKey: hashDeletedUserKey(
              config.deletionHmacSecret,
              input.userId,
            ),
          }),
        ],
        { isolationLevel: 'ReadCommitted' },
      )
      const transactionResult = result[2]
      if (!transactionResult) {
        throw new Error('Game move rate transaction returned no result.')
      }
      const row = firstRow<MoveRateRow>(transactionResult)
      if (row.code !== 'ALLOW') {
        return usageDenial(row.code, row.retry_at, requestedAt)
      }

      const userCount = toSafeNumber(row.user_count, 'user move rate')
      const ipCount = toSafeNumber(row.ip_count, 'IP move rate')
      const resetsAt = isoTimestamp(row.resets_at)
      if (!resetsAt) {
        throw new Error('Game move rate query returned no reset timestamp.')
      }
      return {
        ok: true,
        remaining: {
          user: Math.max(0, config.hourlyGameMoveLimit - userCount),
          ip: Math.max(0, config.hourlyIpGameMoveLimit - ipCount),
        },
        resetsAt,
      }
    },

    async consumeAccountExportRate(
      input: ConsumeAccountExportRateInput,
    ): Promise<ConsumeAccountExportRateResult> {
      assertText(input.userId, 'userId', 3, 255)
      assertText(input.ipAddress, 'ipAddress', 1, 255)
      const requestedAt = now()
      const result = await db.transaction(
        [
          buildAcquireUsageLockStatement(),
          buildCleanupExpiredRateBucketsStatement(requestedAt),
          buildConsumeAccountExportRateStatement(input, config, {
            now: requestedAt,
            userRateKey: hashUserRateKey(config.hmacSecret, input.userId),
            ipRateKey: hashIpRateKey(config.hmacSecret, input.ipAddress),
            deletedUserKey: hashDeletedUserKey(
              config.deletionHmacSecret,
              input.userId,
            ),
          }),
        ],
        { isolationLevel: 'ReadCommitted' },
      )
      const transactionResult = result[2]
      if (!transactionResult) {
        throw new Error('Account export rate transaction returned no result.')
      }
      const row = firstRow<MoveRateRow>(transactionResult)
      if (row.code !== 'ALLOW') {
        return usageDenial(row.code, row.retry_at, requestedAt)
      }

      const userCount = toSafeNumber(row.user_count, 'user export rate')
      const ipCount = toSafeNumber(row.ip_count, 'IP export rate')
      const resetsAt = isoTimestamp(row.resets_at)
      if (!resetsAt) {
        throw new Error('Account export rate query returned no reset timestamp.')
      }
      return {
        ok: true,
        remaining: {
          user: Math.max(0, config.hourlyAccountExportLimit - userCount),
          ip: Math.max(0, config.hourlyIpAccountExportLimit - ipCount),
        },
        resetsAt,
      }
    },

    async consumeWilburMutationRate(
      input: ConsumeWilburMutationRateInput,
    ): Promise<ConsumeWilburMutationRateResult> {
      assertText(input.userId, 'userId', 3, 255)
      assertText(input.ipAddress, 'ipAddress', 1, 255)
      if (input.kind !== 'action' && input.kind !== 'observation') {
        throw new TypeError('kind must be action or observation.')
      }
      if (
        input.operation !== 'create_action' &&
        input.operation !== 'update_action' &&
        input.operation !== 'append_observation'
      ) {
        throw new TypeError(
          'operation must be create_action, update_action, or append_observation.',
        )
      }
      if (
        (input.operation === 'append_observation') !==
        (input.kind === 'observation')
      ) {
        throw new TypeError('operation and kind must describe the same Wilbur mutation.')
      }
      assertUuid(input.idempotencyKey, 'idempotencyKey')
      assertSha256(input.requestDigest, 'requestDigest')
      const requestedAt = now()
      const result = await db.transaction(
        [
          buildAcquireUsageLockStatement(),
          buildCleanupExpiredRateBucketsStatement(requestedAt),
          buildConsumeWilburMutationRateStatement(input, config, {
            now: requestedAt,
            userRateKey: hashUserRateKey(config.hmacSecret, input.userId),
            ipRateKey: hashIpRateKey(config.hmacSecret, input.ipAddress),
            deletedUserKey: hashDeletedUserKey(
              config.deletionHmacSecret,
              input.userId,
            ),
          }),
        ],
        { isolationLevel: 'ReadCommitted' },
      )
      const transactionResult = result[2]
      if (!transactionResult) {
        throw new Error('Wilbur mutation rate transaction returned no result.')
      }
      const row = firstRow<WilburRateRow>(transactionResult)
      if (row.code !== 'ALLOW' && row.code !== 'EXISTING') {
        return usageDenial(row.code, row.retry_at, requestedAt)
      }
      if (
        row.code === 'ALLOW' &&
        toSafeNumber(row.persisted, 'Wilbur admission persistence') !== 1
      ) {
        throw new Error('Wilbur mutation admission was not persisted exactly once.')
      }

      const userCount = toSafeNumber(row.user_count, 'user Wilbur rate')
      const ipCount = toSafeNumber(row.ip_count, 'IP Wilbur rate')
      const resetsAt = isoTimestamp(row.resets_at)
      if (!resetsAt) {
        throw new Error('Wilbur mutation rate query returned no reset timestamp.')
      }
      const userLimit = input.kind === 'action'
        ? config.hourlyWilburActionLimit
        : config.hourlyWilburObservationLimit
      const ipLimit = input.kind === 'action'
        ? config.hourlyIpWilburActionLimit
        : config.hourlyIpWilburObservationLimit
      return {
        ok: true,
        kind: row.code === 'EXISTING' ? 'existing' : 'consumed',
        remaining: {
          user: Math.max(0, userLimit - userCount),
          ip: Math.max(0, ipLimit - ipCount),
        },
        resetsAt,
      }
    },

    async consumeReplayGameStart(
      input: ConsumeReplayGameStartInput,
    ): Promise<ConsumeReplayGameStartResult> {
      validateReplayGameStartInput(input)
      const requestedAt = now()
      const result = await db.transaction(
        [
          buildAcquireUsageLockStatement(),
          buildConsumeReplayGameStartStatement(input, config, {
            now: requestedAt,
            userRateKey: hashUserRateKey(config.hmacSecret, input.userId),
            ipRateKey: hashIpRateKey(config.hmacSecret, input.ipAddress),
            deletedUserKey: hashDeletedUserKey(
              config.deletionHmacSecret,
              input.userId,
            ),
          }),
          buildActivateReplayGameStatement(input, {
            now: requestedAt,
            deletedUserKey: hashDeletedUserKey(
              config.deletionHmacSecret,
              input.userId,
            ),
          }),
          buildVerifyReplayGameInvariantStatement(input, {
            now: requestedAt,
            deletedUserKey: hashDeletedUserKey(
              config.deletionHmacSecret,
              input.userId,
            ),
          }),
        ],
        { isolationLevel: 'ReadCommitted' },
      )
      const transactionResult = result[1]
      if (!transactionResult) {
        throw new Error(
          'Replay game-start accounting transaction returned no result.',
        )
      }
      const row = firstRow<ReplayGameStartRow>(transactionResult)
      if (row.code === 'ALLOW' || row.code === 'EXISTING') {
        if (!row.game_id) {
          throw new Error(
            'Replay game-start transaction returned no target game.',
          )
        }
        assertUuid(row.game_id, 'replay target game id')
        return {
          ok: true,
          kind: row.code === 'ALLOW' ? 'consumed' : 'existing',
          gameId: row.game_id,
        }
      }
      return usageDenial(row.code, row.retry_at, requestedAt)
    },

    async getModelRequestResult(
      input: GetModelRequestResultInput,
    ): Promise<GetModelRequestResultResult> {
      assertText(input.userId, 'userId', 3, 255)
      assertUuid(input.requestId, 'requestId')
      const result = await db.query(
        buildGetModelRequestResultStatement(input),
      )
      return modelResultFromRows(result.rows)
    },

    async getModelRequestByIdempotencyKey(
      input: GetModelRequestByIdempotencyKeyInput,
    ): Promise<GetModelRequestResultResult> {
      assertText(input.userId, 'userId', 3, 255)
      assertUuid(input.idempotencyKey, 'idempotencyKey')
      const result = await db.query(
        buildGetModelRequestByIdempotencyKeyStatement(input),
      )
      return modelResultFromRows(result.rows)
    },

    async getLatestModelRequestForGame(
      input: GetLatestModelRequestForGameInput,
    ): Promise<GetModelRequestResultResult> {
      assertText(input.userId, 'userId', 3, 255)
      assertUuid(input.gameId, 'gameId')
      if (input.requestSha256 !== undefined) {
        assertSha256(input.requestSha256, 'requestSha256')
      }
      if (input.promptVersion !== undefined) {
        assertText(input.promptVersion, 'promptVersion', 1, 80)
      }
      const result = await db.query(
        buildGetLatestModelRequestForGameStatement(input),
      )
      return modelResultFromRows(result.rows)
    },

    async getSucceededModelResultForGame(
      input: GetLatestModelRequestForGameInput,
    ): Promise<GetModelRequestResultResult> {
      assertText(input.userId, 'userId', 3, 255)
      assertUuid(input.gameId, 'gameId')
      if (input.requestSha256 !== undefined) {
        assertSha256(input.requestSha256, 'requestSha256')
      }
      if (input.promptVersion !== undefined) {
        assertText(input.promptVersion, 'promptVersion', 1, 80)
      }
      const result = await db.query(
        buildGetSucceededModelResultForGameStatement(input),
      )
      return modelResultFromRows(result.rows)
    },

    async beginProviderCall(
      input: BeginProviderCallInput,
    ): Promise<BeginProviderCallResult> {
      validateTransitionIdentity(input)
      const startedAt = now()
      const leaseExpiresAt = new Date(
        startedAt.valueOf() + config.modelLeaseSeconds * 1000,
      )
      const result = await db.transaction(
        [
          buildAcquireUsageLockStatement(),
          buildBeginProviderCallStatement(input, {
            now: startedAt,
            leaseExpiresAt,
            deletedUserKey: hashDeletedUserKey(
              config.deletionHmacSecret,
              input.userId,
            ),
          }),
        ],
        { isolationLevel: 'ReadCommitted' },
      )
      const transactionResult = result[1]
      if (!transactionResult) {
        throw new Error('Provider transition transaction returned no result.')
      }
      const row = firstRow<DecisionRow>(transactionResult)

      if (row.code === 'ALLOW' || row.code === 'ALREADY_STARTED') {
        return {
          ok: true,
          status: 'in_progress',
          alreadyStarted: row.code === 'ALREADY_STARTED',
        }
      }

      if (
        row.code !== 'REQUEST_NOT_FOUND' &&
        row.code !== 'ACCOUNT_DELETED' &&
        row.code !== 'ACCOUNT_SUSPENDED' &&
        row.code !== 'ACCOUNT_TEMPORARILY_BLOCKED' &&
        row.code !== 'LEASE_MISMATCH' &&
        row.code !== 'LEASE_EXPIRED' &&
        row.code !== 'INVALID_REQUEST_STATE'
      ) {
        throw new Error(`Unknown provider transition code: ${row.code}`)
      }
      return {
        ok: false,
        code: row.code,
        httpStatus:
          row.code === 'ACCOUNT_DELETED' ||
          row.code === 'ACCOUNT_SUSPENDED' ||
          row.code === 'ACCOUNT_TEMPORARILY_BLOCKED'
            ? 403
            : row.code === 'LEASE_EXPIRED'
              ? 410
              : 409,
      }
    },

    async settleModelRequest(
      input: SettleModelRequestInput,
    ): Promise<SettleModelRequestResult> {
      validateSettlement(input)
      const result = await db.transaction(
        [
          buildAcquireUsageLockStatement(),
          buildSettleModelRequestStatement(input, {
            now: now(),
          }),
        ],
        { isolationLevel: 'ReadCommitted' },
      )
      const transactionResult = result[1]
      if (!transactionResult) {
        throw new Error('Settlement transaction returned no result.')
      }
      const row = firstRow<DecisionRow>(transactionResult)

      if (row.code === 'ALLOW' || row.code === 'ALREADY_SETTLED') {
        return {
          ok: true,
          status: input.outcome,
          alreadySettled: row.code === 'ALREADY_SETTLED',
        }
      }
      if (
        row.code !== 'REQUEST_NOT_FOUND' &&
        row.code !== 'LEASE_EXPIRED' &&
        row.code !== 'INVALID_REQUEST_STATE' &&
        row.code !== 'SETTLEMENT_CONFLICT' &&
        row.code !== 'OPERATION_ALREADY_SUCCEEDED'
      ) {
        throw new Error(`Unknown settlement code: ${row.code}`)
      }
      return {
        ok: false,
        code: row.code,
        httpStatus: row.code === 'LEASE_EXPIRED' ? 410 : 409,
      }
    },

    async releaseReservation(
      input: ReleaseReservationInput,
    ): Promise<ReleaseReservationResult> {
      validateTransitionIdentity(input)
      const result = await db.transaction(
        [
          buildAcquireUsageLockStatement(),
          buildReleaseReservationStatement(input, {
            now: now(),
          }),
        ],
        { isolationLevel: 'ReadCommitted' },
      )
      const transactionResult = result[1]
      if (!transactionResult) {
        throw new Error('Release transaction returned no result.')
      }
      const row = firstRow<DecisionRow>(transactionResult)

      if (row.code === 'ALLOW' || row.code === 'ALREADY_RELEASED') {
        return {
          ok: true,
          released: row.code === 'ALLOW',
        }
      }
      if (
        row.code !== 'REQUEST_NOT_FOUND' &&
        row.code !== 'LEASE_MISMATCH' &&
        row.code !== 'INVALID_REQUEST_STATE'
      ) {
        throw new Error(`Unknown release code: ${row.code}`)
      }
      return {
        ok: false,
        code: row.code,
        httpStatus: 409,
      }
    },

    async reconcileExpiredLeases(): Promise<ReconcileExpiredLeasesResult> {
      const result = await db.transaction(
        [
          buildAcquireUsageLockStatement(),
          buildCleanupExpiredLeasesStatement(now()),
        ],
        { isolationLevel: 'ReadCommitted' },
      )
      const transactionResult = result[1]
      if (!transactionResult) {
        throw new Error('Lease reconciliation returned no result.')
      }
      const row = firstRow<ReconciliationRow>(transactionResult)
      return {
        expiredRequests: toSafeNumber(
          row.expired_requests,
          'expired request count',
        ),
        clearedSlots: toSafeNumber(
          row.cleared_slots,
          'cleared slot count',
        ),
      }
    },

    async deleteAccountData(
      userId: string,
      options: DeleteAccountDataOptions = {},
    ): Promise<DeleteAccountDataResult> {
      assertText(userId, 'userId', 3, 255)
      const requestedAt = now()
      const result = await db.transaction(
        [
          buildAcquireUsageLockStatement(),
          buildCleanupExpiredLeasesStatement(requestedAt),
          buildDeleteAccountGamesStatement(
            userId,
            requestedAt,
            options.force === true,
          ),
          buildDeleteAccountDataStatement(
            userId,
            hashUserRateKey(config.hmacSecret, userId),
            requestedAt,
            options.force === true,
            hashDeletedUserKey(
              config.deletionHmacSecret,
              userId,
            ),
          ),
        ],
        { isolationLevel: 'ReadCommitted' },
      )
      const transactionResult = result[3]
      if (!transactionResult) {
        throw new Error('Account deletion transaction returned no result.')
      }
      const row = firstRow<AccountDeletionRow>(transactionResult)
      if (row.code === 'ACTIVE_MODEL_REQUEST') {
        const retry = retryAfterSeconds(row.retry_at, requestedAt)
        if (retry === null) {
          throw new Error(
            'Active model request deletion denial has no retry timestamp.',
          )
        }
        return {
          ok: false,
          code: 'ACTIVE_MODEL_REQUEST',
          httpStatus: 409,
          retryAfterSeconds: retry,
        }
      }
      if (row.code !== 'ALLOW') {
        throw new Error(`Unknown account deletion code: ${row.code}`)
      }
      return {
        ok: true,
        deleted: row.deleted,
      }
    },

    async getUsageSummary(
      userId: string,
    ): Promise<UsageSummary | UsageDenied> {
      assertText(userId, 'userId', 3, 255)
      const requestedAt = now()
      const results = await db.transaction(
        [
          buildAcquireUsageLockStatement(),
          buildUsageSummaryStatement(
            userId,
            requestedAt,
            config,
            hashDeletedUserKey(config.deletionHmacSecret, userId),
          ),
        ],
        { isolationLevel: 'ReadCommitted' },
      )
      const result = results[1]
      if (!result) {
        throw new Error('Usage summary transaction returned no result.')
      }
      const row = firstRow<SummaryRow>(result)
      if (row.code !== 'ALLOW') {
        return usageDenial(row.code, row.retry_at, requestedAt)
      }
      const modelUsed = toSafeNumber(row.model_used, 'model usage')
      const modelReserved = toSafeNumber(
        row.model_reserved,
        'model reservations',
      )
      const gameUsed = toSafeNumber(row.game_used, 'game usage')
      const gameReserved = toSafeNumber(
        row.game_reserved,
        'game reservations',
      )
      const modelLimit = toSafeNumber(row.model_limit, 'model limit')
      const gameLimit = toSafeNumber(row.game_limit, 'game limit')
      const activeModelRequests = toSafeNumber(
        row.active_count,
        'active request count',
      )
      const periodStart = new Date(requestedAt)
      periodStart.setUTCHours(0, 0, 0, 0)
      const periodEnd = new Date(periodStart)
      periodEnd.setUTCDate(periodEnd.getUTCDate() + 1)

      return {
        period: {
          startsAt: periodStart.toISOString(),
          endsAt: periodEnd.toISOString(),
        },
        modelOperations: {
          used: modelUsed,
          reserved: modelReserved,
          limit: modelLimit,
          remaining: Math.max(0, modelLimit - modelUsed - modelReserved),
        },
        gameStarts: {
          used: gameUsed,
          reserved: gameReserved,
          limit: gameLimit,
          remaining: Math.max(0, gameLimit - gameUsed - gameReserved),
        },
        activeModelRequests,
      }
    },
  }
}
