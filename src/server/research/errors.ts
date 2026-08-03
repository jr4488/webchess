export type ResearchRepositoryErrorCode =
  | 'conflict'
  | 'integrity-error'
  | 'invalid-input'
  | 'not-found'

export class ResearchRepositoryError extends Error {
  readonly code: ResearchRepositoryErrorCode

  constructor(
    code: ResearchRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ResearchRepositoryError'
    this.code = code
  }
}

export function isResearchRepositoryError(
  error: unknown,
): error is ResearchRepositoryError {
  return error instanceof ResearchRepositoryError
}
