import { createHmac } from 'node:crypto'

import { ModelConfigurationError, ModelInputError } from './types'

const SAFETY_IDENTIFIER_PREFIX = 'wc_'
const MINIMUM_HMAC_SECRET_BYTES = 32
const MAXIMUM_USER_ID_LENGTH = 512

function secretLength(secret: string | Uint8Array): number {
  return typeof secret === 'string'
    ? Buffer.byteLength(secret, 'utf8')
    : secret.byteLength
}

/**
 * Produce OpenAI's stable, privacy-preserving per-user safety identifier.
 *
 * The authenticated subject remains only on WebChess servers. The returned
 * value is 46 characters, below the Responses API's 64-character limit.
 */
export function createSafetyIdentifier(
  authenticatedUserId: string,
  secret: string | Uint8Array,
): string {
  if (typeof authenticatedUserId !== 'string') {
    throw new ModelInputError('Authenticated user ID must be text.')
  }
  const normalizedUserId = authenticatedUserId.trim()
  if (
    normalizedUserId.length === 0 ||
    normalizedUserId.length > MAXIMUM_USER_ID_LENGTH
  ) {
    throw new ModelInputError(
      `Authenticated user ID must contain 1–${MAXIMUM_USER_ID_LENGTH} characters.`,
    )
  }
  if (
    (typeof secret !== 'string' && !(secret instanceof Uint8Array)) ||
    secretLength(secret) < MINIMUM_HMAC_SECRET_BYTES
  ) {
    throw new ModelConfigurationError(
      `Safety HMAC secret must contain at least ${MINIMUM_HMAC_SECRET_BYTES} bytes.`,
    )
  }

  const digest = createHmac('sha256', secret)
    .update('webchess/openai-safety-identifier/v1\0', 'utf8')
    .update(normalizedUserId, 'utf8')
    .digest('base64url')

  return `${SAFETY_IDENTIFIER_PREFIX}${digest}`
}
