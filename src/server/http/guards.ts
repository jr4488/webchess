import type { ZodType } from 'zod'
import {
  MAX_JSON_BODY_BYTES,
  gameIdSchema,
  idempotencyKeySchema,
} from './contracts'
import { ApiError } from './errors'

function contentLength(request: Request): number | null {
  const value = request.headers.get('content-length')

  if (value === null) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function validationIssues(error: {
  issues: readonly {
    path: PropertyKey[]
    message: string
  }[]
}): readonly {
  path: string
  message: string
}[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }))
}

export async function parseStrictJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()

  if (mediaType !== 'application/json') {
    throw new ApiError(
      'UNSUPPORTED_MEDIA_TYPE',
      415,
      'This endpoint accepts application/json.',
    )
  }

  const declaredLength = contentLength(request)
  if (declaredLength !== null && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new ApiError('PAYLOAD_TOO_LARGE', 413, 'The request body is too large.')
  }

  let text: string
  try {
    text = await request.text()
  } catch (error) {
    throw new ApiError('BAD_REQUEST', 400, 'The request body could not be read.', {
      cause: error,
    })
  }

  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new ApiError('PAYLOAD_TOO_LARGE', 413, 'The request body is too large.')
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new ApiError('BAD_REQUEST', 400, 'The request body must be valid JSON.', {
      cause: error,
    })
  }

  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ApiError('BAD_REQUEST', 400, 'The request body is invalid.', {
      issues: validationIssues(result.error),
    })
  }

  return result.data
}

export function requireIdempotencyKey(request: Request): string {
  const result = idempotencyKeySchema.safeParse(request.headers.get('idempotency-key'))

  if (!result.success) {
    throw new ApiError(
      'BAD_REQUEST',
      400,
      'A UUID Idempotency-Key header is required.',
    )
  }

  return result.data.toLowerCase()
}

export function requireGameId(value: string): string {
  const result = gameIdSchema.safeParse(value)

  if (!result.success) {
    // Invalid and foreign identifiers intentionally have the same public shape.
    throw new ApiError('GAME_NOT_FOUND', 404, 'Game not found.')
  }

  return result.data.toLowerCase()
}

export function requireDivisionIntentKey(value: string): string {
  const result = idempotencyKeySchema.safeParse(value)

  if (!result.success) {
    // Invalid and foreign intent keys intentionally have the same public shape.
    throw new ApiError('GAME_NOT_FOUND', 404, 'Game not found.')
  }

  return result.data.toLowerCase()
}

export function createRequestId(): string {
  return crypto.randomUUID()
}

/**
 * Vercel overwrites x-forwarded-for rather than forwarding a visitor-supplied
 * value. The raw address is request-local; durable controls store only its
 * purpose-separated HMAC.
 */
export function getClientIpAddress(request: Request): string {
  const value = request.headers.get('x-forwarded-for')?.trim()
  const containsControlCharacter = [...(value ?? '')].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 32 || codePoint === 127
  })

  if (!value || value.length > 128 || containsControlCharacter) {
    return 'unknown'
  }

  return value
}
