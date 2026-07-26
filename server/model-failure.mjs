export const MODEL_CONTRACT_FAILURE = 'model_contract'
export const PROVIDER_BUSY_FAILURE = 'provider_busy'
export const PROVIDER_AUTH_FAILURE = 'provider_auth'
export const PROVIDER_UNAVAILABLE_FAILURE = 'provider_unavailable'
export const REQUEST_CANCELLED_FAILURE = 'request_cancelled'

const MAX_LOGGED_DETAIL_CHARS = 2_000

function statusOf(error) {
  const status = error?.status ?? error?.response?.status
  return Number.isInteger(status) ? status : undefined
}

function isCancellation(error) {
  return (
    error?.name === 'AbortError' ||
    error?.name === 'APIUserAbortError' ||
    error?.code === 'ABORT_ERR'
  )
}

/**
 * Classify a failed model run into a client-safe body and an operator detail.
 *
 * The distinction that matters is between a contract failure, where the
 * provider answered and WebChess rejected the content, and a transport failure,
 * where no usable answer arrived. Collapsing the two told operators to check
 * credentials that were working correctly.
 */
export function describeModelFailure(error, options = {}) {
  const { contractError, contractMessage, unavailableMessage } = options

  if (contractError && error instanceof contractError) {
    return {
      status: 502,
      code: MODEL_CONTRACT_FAILURE,
      error: contractMessage,
      detail: error.message,
      expected: true,
    }
  }
  if (isCancellation(error)) {
    return {
      status: 499,
      code: REQUEST_CANCELLED_FAILURE,
      error: 'The request was cancelled before the model finished.',
      detail: error?.message ?? 'aborted',
      expected: true,
    }
  }

  const status = statusOf(error)
  if (status === 429) {
    return {
      status: 429,
      code: PROVIDER_BUSY_FAILURE,
      error: 'The model provider is busy right now. Wait a moment, then try again.',
      detail: error?.message ?? 'rate limited',
      expected: true,
    }
  }
  if (status === 401 || status === 403) {
    return {
      status: 502,
      code: PROVIDER_AUTH_FAILURE,
      error: 'The model provider rejected the configured credentials.',
      detail: error?.message ?? `provider returned ${status}`,
      expected: false,
    }
  }

  return {
    status: 502,
    code: PROVIDER_UNAVAILABLE_FAILURE,
    error: unavailableMessage,
    detail: error?.message ?? String(error),
    expected: false,
  }
}

/**
 * Record why a model run failed. The detail never reaches the HTTP response,
 * so this is the only place an operator can see a quality rejection.
 */
export function logModelFailure(logger, operation, failure, error) {
  const record = `WebChess ${operation} failed [${failure.code}]: ${
    String(failure.detail ?? '').slice(0, MAX_LOGGED_DETAIL_CHARS)
  }`
  if (failure.expected) {
    logger?.warn?.(record) ?? logger?.log?.(record)
    return
  }
  if (logger?.error) {
    logger.error(record, error)
    return
  }
  logger?.log?.(record)
}
