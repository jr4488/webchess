export type OpenClawPublicErrorCode =
  | 'CROSS_ORIGIN_REQUEST'
  | 'GAME_NOT_COMPLETE'
  | 'INVALID_GAME_REPLAY'
  | 'INVALID_MODEL_RESPONSE'
  | 'INVALID_REQUEST'
  | 'LOCAL_MODE_DISABLED'
  | 'LOOPBACK_REQUIRED'
  | 'OPENCLAW_CONFIGURATION_ERROR'
  | 'OPENCLAW_NOT_FOUND'
  | 'OPENCLAW_REQUEST_ABORTED'
  | 'OPENCLAW_REQUEST_FAILED'
  | 'OPENCLAW_TIMEOUT'

export class OpenClawPublicError extends Error {
  readonly code: OpenClawPublicErrorCode
  readonly status: number

  constructor(
    code: OpenClawPublicErrorCode,
    status: number,
    message: string,
  ) {
    super(message)
    this.name = 'OpenClawPublicError'
    this.code = code
    this.status = status
  }
}

export function isOpenClawPublicError(
  value: unknown,
): value is OpenClawPublicError {
  return value instanceof OpenClawPublicError
}
