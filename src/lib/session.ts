export type SessionProviderId = 'openai-api' | 'codex-chatgpt' | 'ollama'
export type SessionProviderBilling =
  'platform-api' | 'chatgpt-workspace' | 'local-compute'
export type SessionProviderWebSearch = 'disabled' | 'cached' | 'indexed' | 'live'

export interface SessionProvider {
  id: SessionProviderId
  label: string
  billing: SessionProviderBilling
  localOnly: boolean
  dataControlsUrl: string
  model: string
  webSearch: SessionProviderWebSearch
}

export interface AuthenticatedSession {
  authenticated: true
  csrfToken: string
  expiresAt: string
  provider: SessionProvider
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

function parseProvider(value: unknown): SessionProvider | null {
  if (!value || typeof value !== 'object') return null

  const provider = value as Record<string, unknown>
  const id = provider.id
  const billing = provider.billing
  const label = provider.label
  const localOnly = provider.localOnly
  const dataControlsUrl = provider.dataControlsUrl
  const model = provider.model
  const webSearch = provider.webSearch

  if (
    (id !== 'openai-api' && id !== 'codex-chatgpt' && id !== 'ollama') ||
    (
      billing !== 'platform-api' &&
      billing !== 'chatgpt-workspace' &&
      billing !== 'local-compute'
    ) ||
    (
      webSearch !== 'disabled' &&
      webSearch !== 'cached' &&
      webSearch !== 'indexed' &&
      webSearch !== 'live'
    ) ||
    typeof label !== 'string' ||
    label.trim().length === 0 ||
    typeof localOnly !== 'boolean' ||
    typeof dataControlsUrl !== 'string' ||
    typeof model !== 'string' ||
    model.trim().length === 0
  ) {
    return null
  }

  const expectedBilling =
    id === 'openai-api'
      ? 'platform-api'
      : id === 'codex-chatgpt'
        ? 'chatgpt-workspace'
        : 'local-compute'

  let parsedDataControlsUrl: URL
  try {
    parsedDataControlsUrl = new URL(dataControlsUrl)
  } catch {
    return null
  }
  const validDataControlsUrl =
    parsedDataControlsUrl.protocol === 'https:' &&
    parsedDataControlsUrl.username.length === 0 &&
    parsedDataControlsUrl.password.length === 0

  if (
    billing !== expectedBilling ||
    (id === 'openai-api' && localOnly) ||
    (id === 'openai-api' && webSearch !== 'disabled') ||
    (id === 'codex-chatgpt' && !localOnly) ||
    (id === 'ollama' && !localOnly) ||
    (id === 'ollama' && webSearch !== 'disabled') ||
    !validDataControlsUrl
  ) {
    return null
  }

  return {
    id,
    label: label.trim(),
    billing,
    localOnly,
    dataControlsUrl,
    model: model.trim(),
    webSearch,
  }
}

function parseSession(value: unknown): WebChessSession {
  if (!value || typeof value !== 'object') {
    throw new Error('The access service returned an incomplete response.')
  }

  const payload = value as Record<string, unknown>
  if (payload.authenticated === false) {
    return { authenticated: false }
  }

  const provider = parseProvider(payload.provider)
  if (
    payload.authenticated !== true ||
    typeof payload.csrfToken !== 'string' ||
    payload.csrfToken.length === 0 ||
    typeof payload.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(payload.expiresAt)) ||
    !provider
  ) {
    throw new Error('The access service returned an incomplete session.')
  }

  return {
    authenticated: true,
    csrfToken: payload.csrfToken,
    expiresAt: payload.expiresAt,
    provider,
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
