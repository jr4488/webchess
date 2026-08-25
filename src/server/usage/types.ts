import type { SqlAdapter } from '../db/sql'

export type ModelOperation = 'division' | 'answer' | 'portia' | 'charlotte'

export type ModelRequestStatus =
  | 'reserved'
  | 'in_progress'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'indeterminate'

export type ModelResultValue =
  | null
  | boolean
  | number
  | string
  | readonly ModelResultValue[]
  | ModelResultPayload

export interface ModelResultPayload {
  readonly [key: string]: ModelResultValue
}

export interface UsageConfig {
  readonly hmacSecret: string
  readonly deletionHmacSecret: string
  readonly dailyGameLimit: number
  readonly dailyModelRequestLimit: number
  readonly dailyGlobalModelRequestLimit: number
  readonly hourlyModelRequestLimit: number
  readonly hourlyIpModelRequestLimit: number
  readonly hourlyGameStartLimit: number
  readonly hourlyIpGameStartLimit: number
  readonly hourlyGameMoveLimit: number
  readonly hourlyIpGameMoveLimit: number
  readonly hourlyAccountExportLimit: number
  readonly hourlyIpAccountExportLimit: number
  readonly hourlyWilburActionLimit: number
  readonly hourlyIpWilburActionLimit: number
  readonly hourlyWilburObservationLimit: number
  readonly hourlyIpWilburObservationLimit: number
  readonly concurrentModelLimit: 1
  readonly globalModelConcurrentLimit: number
  readonly modelLeaseSeconds: number
}

export interface UsageControllerDependencies {
  readonly db: SqlAdapter
  readonly config: UsageConfig
  readonly now?: () => Date
  readonly randomUuid?: () => string
}

export interface ReserveModelRequestInput {
  readonly requestId: string
  readonly gameId: string | null
  readonly userId: string
  readonly operation: ModelOperation
  readonly idempotencyKey: string
  readonly requestSha256: string
  readonly provider: string
  readonly model: string
  readonly promptVersion: string
  readonly softwareVersion: string
  /**
   * Immutable logical cutoff for one Answer operation. Provider success must
   * be durably committed before this instant. Required for Answer and
   * forbidden for every other model operation.
   */
  readonly operationDeadlineAt?: Date
  /**
   * Fixed lease/fence boundary for one Answer operation. It is the logical
   * cutoff plus response and settlement headroom, established when Answer
   * enters rather than when a late reservation is written. Required for
   * Answer and forbidden for every other model operation.
   */
  readonly leaseExpiresAtCap?: Date
  /**
   * Division requests that create a new game reserve the separate daily game
   * allowance. All later lifecycle operations must leave this false.
   */
  readonly countsAsGameStart: boolean
  readonly ipAddress: string
}

export type UsageDenialCode =
  | 'ACCOUNT_DELETED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_TEMPORARILY_BLOCKED'
  | 'GAME_START_DAILY_QUOTA_EXCEEDED'
  | 'MODEL_DAILY_QUOTA_EXCEEDED'
  | 'MODEL_GLOBAL_DAILY_CAPACITY'
  | 'MODEL_HOURLY_RATE_LIMITED'
  | 'IP_HOURLY_RATE_LIMITED'
  | 'GAME_START_HOURLY_RATE_LIMITED'
  | 'IP_GAME_START_HOURLY_RATE_LIMITED'
  | 'GAME_MOVE_HOURLY_RATE_LIMITED'
  | 'IP_GAME_MOVE_HOURLY_RATE_LIMITED'
  | 'ACCOUNT_EXPORT_HOURLY_RATE_LIMITED'
  | 'IP_ACCOUNT_EXPORT_HOURLY_RATE_LIMITED'
  | 'WILBUR_ACTION_HOURLY_RATE_LIMITED'
  | 'IP_WILBUR_ACTION_HOURLY_RATE_LIMITED'
  | 'WILBUR_OBSERVATION_HOURLY_RATE_LIMITED'
  | 'IP_WILBUR_OBSERVATION_HOURLY_RATE_LIMITED'
  | 'WILBUR_MUTATION_EXPIRED'
  | 'WILBUR_MUTATION_CONFLICT'
  | 'MODEL_USER_CONCURRENCY_LIMIT'
  | 'MODEL_GLOBAL_CAPACITY'
  | 'GAME_OWNERSHIP_CONFLICT'
  | 'GAME_REVISION_CONFLICT'
  | 'GAME_INVALID_REPLAY_STATE'
  | 'IDEMPOTENCY_CONFLICT'

export interface UsageDenied {
  readonly ok: false
  readonly code: UsageDenialCode
  readonly httpStatus: 403 | 409 | 429 | 503
  readonly retryAfterSeconds: number | null
}

export interface ModelReservation {
  readonly ok: true
  readonly kind: 'reserved' | 'existing'
  readonly requestId: string
  readonly gameId: string | null
  readonly status: ModelRequestStatus
  readonly leaseToken: string | null
  readonly leaseExpiresAt: string | null
}

export type ReserveModelRequestResult = ModelReservation | UsageDenied

export interface ConsumeGameMoveRateInput {
  readonly userId: string
  readonly ipAddress: string
}

export type ConsumeGameMoveRateResult =
  | {
      readonly ok: true
      readonly remaining: {
        readonly user: number
        readonly ip: number
      }
      readonly resetsAt: string
    }
  | UsageDenied

export interface ConsumeAccountExportRateInput {
  readonly userId: string
  readonly ipAddress: string
}

export type ConsumeAccountExportRateResult =
  | {
      readonly ok: true
      readonly remaining: {
        readonly user: number
        readonly ip: number
      }
      readonly resetsAt: string
    }
  | UsageDenied

export interface ConsumeWilburMutationRateInput {
  readonly userId: string
  readonly ipAddress: string
  readonly kind: 'action' | 'observation'
  readonly operation: 'create_action' | 'update_action' | 'append_observation'
  readonly idempotencyKey: string
  readonly requestDigest: string
}

export type ConsumeWilburMutationRateResult =
  | {
      readonly ok: true
      readonly kind: 'consumed' | 'existing'
      readonly remaining: {
        readonly user: number
        readonly ip: number
      }
      readonly resetsAt: string
    }
  | UsageDenied

export interface ConsumeReplayGameStartInput {
  readonly userId: string
  readonly sourceGameId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly ipAddress: string
}

export type ConsumeReplayGameStartResult =
  | {
      readonly ok: true
      readonly kind: 'consumed' | 'existing'
      readonly gameId: string
    }
  | UsageDenied

export interface GetModelRequestResultInput {
  readonly userId: string
  readonly requestId: string
}

export interface GetModelRequestByIdempotencyKeyInput {
  readonly userId: string
  readonly operation: ModelOperation
  readonly idempotencyKey: string
}

export interface GetLatestModelRequestForGameInput {
  readonly userId: string
  readonly gameId: string
  readonly operation: ModelOperation
  readonly requestSha256?: string
  readonly promptVersion?: string
}

export type GetModelRequestResultResult =
  | {
      readonly found: false
    }
  | {
      readonly found: true
      readonly requestId: string
      readonly gameId: string | null
      readonly operation: ModelOperation
      readonly requestSha256?: string
      readonly promptVersion?: string
      readonly status: ModelRequestStatus
      readonly resultPayload: ModelResultPayload | null
    }

export interface AttachModelRequestGameInput {
  readonly userId: string
  readonly requestId: string
  readonly gameId: string
}

export type AttachModelRequestGameResult =
  | {
      readonly ok: true
      readonly attached: boolean
    }
  | {
      readonly ok: false
      readonly code:
        | 'REQUEST_NOT_FOUND'
        | 'GAME_NOT_FOUND'
        | 'INVALID_REQUEST_OPERATION'
        | 'INVALID_REQUEST_STATE'
        | 'GAME_LINK_CONFLICT'
      readonly httpStatus: 409
    }

export interface BeginProviderCallInput {
  readonly userId: string
  readonly requestId: string
  readonly leaseToken: string
}

export type ProviderCallTransitionCode =
  | 'ACCOUNT_DELETED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_TEMPORARILY_BLOCKED'
  | 'REQUEST_NOT_FOUND'
  | 'LEASE_MISMATCH'
  | 'LEASE_EXPIRED'
  | 'INVALID_REQUEST_STATE'

export interface ProviderCallTransitionFailure {
  readonly ok: false
  readonly code: ProviderCallTransitionCode
  readonly httpStatus: 403 | 409 | 410
}

export interface ProviderCallTransitionSuccess {
  readonly ok: true
  readonly status: 'in_progress'
  readonly alreadyStarted: boolean
}

export type BeginProviderCallResult =
  | ProviderCallTransitionFailure
  | ProviderCallTransitionSuccess

export interface ProviderTokenUsage {
  readonly reported: boolean
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly cacheWriteInputTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  readonly totalTokens: number
}

interface SettleModelRequestBase {
  readonly userId: string
  readonly requestId: string
  readonly leaseToken: string
  readonly usage?: ProviderTokenUsage
}

export interface SettleModelRequestSuccess extends SettleModelRequestBase {
  readonly outcome: 'succeeded'
  readonly usage: ProviderTokenUsage
  readonly providerResponseId?: string
  readonly responseSha256: string
  readonly resultPayload: ModelResultPayload
}

export interface SettleModelRequestFailure extends SettleModelRequestBase {
  /** Indeterminate means provider work began but no trustworthy result exists. */
  readonly outcome: 'failed' | 'indeterminate'
  readonly failureCode: string
  readonly providerResponseId?: string
  readonly providerHttpStatus?: number
}

export type SettleModelRequestInput =
  | SettleModelRequestSuccess
  | SettleModelRequestFailure

export type SettleModelRequestCode =
  | 'REQUEST_NOT_FOUND'
  | 'LEASE_EXPIRED'
  | 'INVALID_REQUEST_STATE'
  | 'SETTLEMENT_CONFLICT'
  | 'OPERATION_ALREADY_SUCCEEDED'

export type SettleModelRequestResult =
  | {
      readonly ok: true
      readonly status: 'succeeded' | 'failed' | 'indeterminate'
      readonly alreadySettled: boolean
    }
  | {
      readonly ok: false
      readonly code: SettleModelRequestCode
      readonly httpStatus: 409 | 410
    }

export interface ReleaseReservationInput {
  readonly userId: string
  readonly requestId: string
  readonly leaseToken: string
  readonly reason:
    | 'client_disconnected'
    | 'request_cancelled'
    | 'provider_not_started'
    | 'server_shutdown'
}

export type ReleaseReservationResult =
  | {
      readonly ok: true
      readonly released: boolean
    }
  | {
      readonly ok: false
      readonly code:
        | 'REQUEST_NOT_FOUND'
        | 'LEASE_MISMATCH'
        | 'INVALID_REQUEST_STATE'
      readonly httpStatus: 409
    }

export interface ReconcileExpiredLeasesResult {
  readonly expiredRequests: number
  readonly clearedSlots: number
}

export type DeleteAccountDataResult =
  | {
      readonly ok: true
      readonly deleted: boolean
    }
  | {
      readonly ok: false
      readonly code: 'ACTIVE_MODEL_REQUEST'
      readonly httpStatus: 409
      readonly retryAfterSeconds: number
    }

export interface DeleteAccountDataOptions {
  readonly force?: boolean
}

export interface UsageAmount {
  readonly used: number
  readonly reserved: number
  readonly limit: number
  readonly remaining: number
}

export interface UsageSummary {
  readonly period: {
    readonly startsAt: string
    readonly endsAt: string
  }
  readonly modelOperations: UsageAmount
  readonly gameStarts: UsageAmount
  readonly activeModelRequests: number
}

export interface UsageController {
  reserveModelRequest(
    input: ReserveModelRequestInput,
  ): Promise<ReserveModelRequestResult>
  attachModelRequestGame(
    input: AttachModelRequestGameInput,
  ): Promise<AttachModelRequestGameResult>
  consumeGameMoveRate(
    input: ConsumeGameMoveRateInput,
  ): Promise<ConsumeGameMoveRateResult>
  consumeAccountExportRate(
    input: ConsumeAccountExportRateInput,
  ): Promise<ConsumeAccountExportRateResult>
  consumeWilburMutationRate(
    input: ConsumeWilburMutationRateInput,
  ): Promise<ConsumeWilburMutationRateResult>
  consumeReplayGameStart(
    input: ConsumeReplayGameStartInput,
  ): Promise<ConsumeReplayGameStartResult>
  getModelRequestResult(
    input: GetModelRequestResultInput,
  ): Promise<GetModelRequestResultResult>
  getModelRequestByIdempotencyKey(
    input: GetModelRequestByIdempotencyKeyInput,
  ): Promise<GetModelRequestResultResult>
  getLatestModelRequestForGame(
    input: GetLatestModelRequestForGameInput,
  ): Promise<GetModelRequestResultResult>
  getSucceededModelResultForGame(
    input: GetLatestModelRequestForGameInput,
  ): Promise<GetModelRequestResultResult>
  beginProviderCall(
    input: BeginProviderCallInput,
  ): Promise<BeginProviderCallResult>
  settleModelRequest(
    input: SettleModelRequestInput,
  ): Promise<SettleModelRequestResult>
  releaseReservation(
    input: ReleaseReservationInput,
  ): Promise<ReleaseReservationResult>
  reconcileExpiredLeases(): Promise<ReconcileExpiredLeasesResult>
  deleteAccountData(
    userId: string,
    options?: DeleteAccountDataOptions,
  ): Promise<DeleteAccountDataResult>
  getUsageSummary(userId: string): Promise<UsageSummary | UsageDenied>
}
