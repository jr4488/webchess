export type GameRepositoryErrorCode =
  | 'not-found'
  | 'conflict'
  | 'idempotency-conflict'
  | 'invalid-input'
  | 'invalid-state'
  | 'not-terminal'
  | 'integrity-error'

/**
 * An expected repository failure that route handlers can translate without
 * exposing database details. Missing and cross-owner games deliberately share
 * the same `not-found` code.
 */
export class GameRepositoryError extends Error {
  constructor(
    readonly code: GameRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'GameRepositoryError'
  }
}

export function isGameRepositoryError(
  error: unknown,
): error is GameRepositoryError {
  return error instanceof GameRepositoryError
}
