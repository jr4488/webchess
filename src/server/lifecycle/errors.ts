export type LifecycleRepositoryErrorCode =
  | 'not-found'
  | 'invalid-input'
  | 'invalid-state'
  | 'conflict'
  | 'storage-limit'
  | 'integrity-error'

export class LifecycleRepositoryError extends Error {
  constructor(
    readonly code: LifecycleRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'LifecycleRepositoryError'
  }
}

export function isLifecycleRepositoryError(
  error: unknown,
): error is LifecycleRepositoryError {
  return error instanceof LifecycleRepositoryError
}
