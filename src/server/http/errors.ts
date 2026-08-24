import { MAX_PERSISTED_MODEL_PROMPT_CHARS } from '../../types'

export type ApiErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHENTICATION_UNAVAILABLE'
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'CROSS_ORIGIN_REQUEST'
  | 'FORBIDDEN'
  | 'GAME_NOT_FOUND'
  | 'LIFECYCLE_NOT_FOUND'
  | 'ILLEGAL_MOVE'
  | 'INTERNAL_ERROR'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UPSTREAM_FAILURE'
  | 'UPSTREAM_TIMEOUT'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly retryAfterSeconds?: number
  readonly issues?: readonly {
    path: string
    message: string
  }[]

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    options: {
      cause?: unknown
      issues?: readonly {
        path: string
        message: string
      }[]
      retryAfterSeconds?: number
    } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.retryAfterSeconds = options.retryAfterSeconds
    this.issues = options.issues
  }
}

/**
 * The sole public HTTP error allowed to carry prompt content. Its fixed
 * UPSTREAM_FAILURE/502 identity prevents unrelated API errors from becoming a
 * generic serialization path for server data.
 */
export class SafePromptApiError extends ApiError {
  override name = 'SafePromptApiError'

  constructor(message: string, readonly publicPrompt: string) {
    if (
      publicPrompt.length === 0 ||
      publicPrompt.length > MAX_PERSISTED_MODEL_PROMPT_CHARS ||
      publicPrompt.includes('\0')
    ) {
      throw new TypeError('The public prompt is outside its safe disclosure bounds.')
    }
    super('UPSTREAM_FAILURE', 502, message)
  }
}

export function isSafePromptApiError(
  error: unknown,
): error is SafePromptApiError {
  return error instanceof SafePromptApiError
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export function serviceUnavailable(message = 'The WebChess service is not configured.'): ApiError {
  return new ApiError('SERVICE_UNAVAILABLE', 503, message)
}
