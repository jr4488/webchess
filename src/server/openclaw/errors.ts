import { ModelContractError } from '../openai/types'
import { MAX_PERSISTED_MODEL_PROMPT_CHARS } from '../../types'

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

export class OpenClawAnswerPublicError extends OpenClawPublicError {
  override name = 'OpenClawAnswerPublicError'

  constructor(readonly publicPrompt: string) {
    if (
      publicPrompt.length === 0 ||
      publicPrompt.length > MAX_PERSISTED_MODEL_PROMPT_CHARS ||
      publicPrompt.includes('\0')
    ) {
      throw new TypeError('The public prompt is outside its safe disclosure bounds.')
    }
    super(
      'INVALID_MODEL_RESPONSE',
      502,
      'The configured OpenClaw model did not satisfy the WebChess response contract after one corrective turn.',
    )
  }
}

/**
 * A terminal OpenClaw Answer contract failure whose secret-free role
 * projection is safe to disclose. It combines the applicable pinned OpenClaw
 * system role with the exact WebChess user role; invalid provider output,
 * credentials, private reasoning, headers, and logs are not retained.
 */
export class OpenClawAnswerContractError extends ModelContractError {
  override name = 'OpenClawAnswerContractError'

  constructor(readonly publicPrompt: string) {
    super(
      'The configured OpenClaw model did not satisfy the WebChess Answer contract after one corrective turn.',
    )
  }
}

export class OpenClawProviderError extends Error {
  override name = 'OpenClawProviderError'

  constructor(
    readonly failureCode: string,
    readonly ambiguous: boolean,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options)
  }
}

export function isOpenClawPublicError(
  value: unknown,
): value is OpenClawPublicError {
  return value instanceof OpenClawPublicError
}

export function isOpenClawAnswerPublicError(
  value: unknown,
): value is OpenClawAnswerPublicError {
  return value instanceof OpenClawAnswerPublicError
}
