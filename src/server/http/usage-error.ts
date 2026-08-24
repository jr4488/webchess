import type { UsageDenied } from '../usage/types'

import { ApiError } from './errors'

/**
 * Translate the durable usage service's closed denial vocabulary at the HTTP
 * boundary without importing any game, provider, lifecycle, or research code.
 */
export function usageError(denial: UsageDenied): ApiError {
  const options = denial.retryAfterSeconds === null
    ? {}
    : { retryAfterSeconds: denial.retryAfterSeconds }

  if (
    denial.code === 'ACCOUNT_SUSPENDED' ||
    denial.code === 'ACCOUNT_TEMPORARILY_BLOCKED' ||
    denial.code === 'ACCOUNT_DELETED'
  ) {
    return new ApiError(
      'FORBIDDEN',
      403,
      'This WebChess account cannot perform that operation.',
      options,
    )
  }

  if (
    denial.code === 'GAME_START_DAILY_QUOTA_EXCEEDED' ||
    denial.code === 'MODEL_DAILY_QUOTA_EXCEEDED'
  ) {
    return new ApiError(
      'QUOTA_EXCEEDED',
      429,
      'This account has reached its current WebChess allowance.',
      options,
    )
  }

  if (
    denial.code === 'MODEL_GLOBAL_DAILY_CAPACITY' ||
    denial.code === 'MODEL_GLOBAL_CAPACITY'
  ) {
    return new ApiError(
      'SERVICE_UNAVAILABLE',
      503,
      'WebChess model capacity is temporarily unavailable.',
      options,
    )
  }

  if (
    denial.code === 'GAME_OWNERSHIP_CONFLICT' ||
    denial.code === 'IDEMPOTENCY_CONFLICT' ||
    denial.code === 'WILBUR_MUTATION_EXPIRED' ||
    denial.code === 'WILBUR_MUTATION_CONFLICT' ||
    denial.code === 'GAME_REVISION_CONFLICT' ||
    denial.code === 'GAME_INVALID_REPLAY_STATE'
  ) {
    return new ApiError(
      'CONFLICT',
      409,
      'That operation conflicts with existing durable state.',
      options,
    )
  }

  return new ApiError(
    'RATE_LIMITED',
    429,
    'Too many WebChess operations were requested. Please wait and try again.',
    options,
  )
}
