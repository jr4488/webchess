import { ApiError, isApiError } from './errors'

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Expires: '0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
} as const

export function noStoreHeaders(additional?: HeadersInit): Headers {
  const headers = new Headers(NO_STORE_HEADERS)

  if (additional) {
    const additions = new Headers(additional)
    additions.forEach((value, key) => headers.set(key, value))
  }

  return headers
}

export function jsonResponse(
  body: unknown,
  options: {
    headers?: HeadersInit
    status?: number
  } = {},
): Response {
  return Response.json(body, {
    status: options.status ?? 200,
    headers: noStoreHeaders(options.headers),
  })
}

export function emptyResponse(status = 204, headers?: HeadersInit): Response {
  return new Response(null, {
    status,
    headers: noStoreHeaders(headers),
  })
}

export function withNoStore(response: Response, requestId?: string): Response {
  const headers = noStoreHeaders(response.headers)

  if (requestId) {
    headers.set('X-Request-Id', requestId)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function publicError(error: ApiError, requestId: string): Response {
  const headers = noStoreHeaders({
    'X-Request-Id': requestId,
  })

  if (error.retryAfterSeconds !== undefined) {
    headers.set('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterSeconds))))
  }

  return jsonResponse(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.issues ? { issues: error.issues } : {}),
        requestId,
      },
    },
    {
      status: error.status,
      headers,
    },
  )
}

export function errorResponse(error: unknown, requestId: string): Response {
  if (isApiError(error)) {
    return publicError(error, requestId)
  }

  return publicError(
    new ApiError(
      'INTERNAL_ERROR',
      500,
      'WebChess could not complete this request.',
      { cause: error },
    ),
    requestId,
  )
}
