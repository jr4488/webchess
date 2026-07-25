export interface AuthenticatedSession {
  authenticated: true
  csrfToken: string
  expiresAt: string
}

export interface AnonymousSession {
  authenticated: false
}

export type WebChessSession = AuthenticatedSession | AnonymousSession

interface SessionErrorPayload {
  error?: string
  message?: string
}

export class SessionRequiredError extends Error {
  readonly status = 401

  constructor(message = 'Your access session has expired. Enter the access code to continue.') {
    super(message)
    this.name = 'SessionRequiredError'
  }
}

export function isSessionRequiredError(error: unknown): error is SessionRequiredError {
  return (
    error instanceof SessionRequiredError ||
    (
      error instanceof Error &&
      'status' in error &&
      (error as Error & { status?: unknown }).status === 401
    )
  )
}

function parseSession(value: unknown): WebChessSession {
  if (!value || typeof value !== 'object') {
    throw new Error('The access service returned an incomplete response.')
  }

  const payload = value as Record<string, unknown>
  if (payload.authenticated === false) {
    return { authenticated: false }
  }

  if (
    payload.authenticated !== true ||
    typeof payload.csrfToken !== 'string' ||
    payload.csrfToken.length === 0 ||
    typeof payload.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(payload.expiresAt))
  ) {
    throw new Error('The access service returned an incomplete session.')
  }

  return {
    authenticated: true,
    csrfToken: payload.csrfToken,
    expiresAt: payload.expiresAt,
  }
}

async function readPayload(response: Response): Promise<Record<string, unknown> & SessionErrorPayload> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown> & SessionErrorPayload>
}

function requestFailure(
  response: Response,
  payload: SessionErrorPayload,
  fallback: string,
): Error {
  const message = payload.error ?? payload.message ?? fallback
  if (response.status === 401) return new SessionRequiredError(message)

  const error = new Error(message) as Error & { status?: number }
  error.status = response.status
  return error
}

export async function getWebChessSession(signal?: AbortSignal): Promise<WebChessSession> {
  const response = await fetch('/api/session', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  })
  const payload = await readPayload(response)

  if (!response.ok) {
    throw requestFailure(response, payload, 'WebChess could not check access right now.')
  }
  return parseSession(payload)
}

export async function createWebChessSession(
  accessCode: string,
  signal?: AbortSignal,
): Promise<AuthenticatedSession> {
  const response = await fetch('/api/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accessCode }),
    signal,
  })
  const payload = await readPayload(response)

  if (!response.ok) {
    throw requestFailure(response, payload, 'WebChess could not start an access session.')
  }

  const session = parseSession(payload)
  if (!session.authenticated) {
    throw new Error('The access service did not start a session.')
  }
  return session
}

export async function deleteWebChessSession(
  csrfToken: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/session', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'X-WebChess-CSRF': csrfToken,
    },
    signal,
  })
  const payload = await readPayload(response)

  if (!response.ok && response.status !== 401) {
    throw requestFailure(response, payload, 'WebChess could not end the access session.')
  }
}
