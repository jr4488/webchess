export type OpenClawTransport = 'local' | 'gateway'

export type OpenClawEnvironment = Readonly<
  Record<string, string | undefined>
>

export interface OpenClawConfig {
  binary: string
  bridgeToken: string | null
  bridgeUrl: string | null
  maxOutputBytes: number
  timeoutMs: number
  transport: OpenClawTransport
}

export const DEFAULT_OPENCLAW_TIMEOUT_MS = 130_000
export const MIN_OPENCLAW_TIMEOUT_MS = 1_000
export const MAX_OPENCLAW_TIMEOUT_MS = 150_000
export const MAX_OPENCLAW_OUTPUT_BYTES = 4 * 1024 * 1024

export class OpenClawConfigurationError extends Error {
  override name = 'OpenClawConfigurationError'
}

export function isOpenClawLocalModeEnabled(
  environment: OpenClawEnvironment = process.env,
): boolean {
  if (
    environment.VERCEL !== undefined ||
    environment.VERCEL_ENV !== undefined ||
    environment.VERCEL_TARGET_ENV !== undefined ||
    environment.VERCEL_URL !== undefined
  ) {
    return false
  }
  return environment.WEBCHESS_OPENCLAW_ENABLED === 'true'
}

function resolveTimeout(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_OPENCLAW_TIMEOUT_MS
  }

  const timeout = Number(value)
  if (
    !Number.isInteger(timeout) ||
    timeout < MIN_OPENCLAW_TIMEOUT_MS ||
    timeout > MAX_OPENCLAW_TIMEOUT_MS
  ) {
    throw new OpenClawConfigurationError(
      `WEBCHESS_OPENCLAW_TIMEOUT_MS must be an integer from ${MIN_OPENCLAW_TIMEOUT_MS} through ${MAX_OPENCLAW_TIMEOUT_MS}.`,
    )
  }
  return timeout
}

function resolveTransport(value: string | undefined): OpenClawTransport {
  if (value === undefined || value.trim() === '') return 'local'
  if (value === 'local' || value === 'gateway') return value
  throw new OpenClawConfigurationError(
    'WEBCHESS_OPENCLAW_TRANSPORT must be local or gateway.',
  )
}

function resolveBridge(environment: OpenClawEnvironment): {
  bridgeToken: string | null
  bridgeUrl: string | null
} {
  const rawUrl = environment.WEBCHESS_OPENCLAW_BRIDGE_URL?.trim()
  const rawToken = environment.WEBCHESS_OPENCLAW_BRIDGE_TOKEN
  if (!rawUrl && !rawToken) {
    return { bridgeToken: null, bridgeUrl: null }
  }
  if (!rawUrl || !rawToken) {
    throw new OpenClawConfigurationError(
      'The OpenClaw bridge URL and bearer must be configured together.',
    )
  }
  if (
    Buffer.byteLength(rawToken, 'utf8') < 32 ||
    Buffer.byteLength(rawToken, 'utf8') > 512 ||
    /[\p{C}\s]/gu.test(rawToken)
  ) {
    throw new OpenClawConfigurationError(
      'WEBCHESS_OPENCLAW_BRIDGE_TOKEN is invalid.',
    )
  }
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new OpenClawConfigurationError(
      'WEBCHESS_OPENCLAW_BRIDGE_URL is invalid.',
    )
  }
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new OpenClawConfigurationError(
      'WEBCHESS_OPENCLAW_BRIDGE_URL must be an uncredentialed 127.0.0.1 HTTP origin with an explicit port.',
    )
  }
  return {
    bridgeToken: rawToken,
    bridgeUrl: parsed.origin,
  }
}

export function resolveOpenClawConfig(
  environment: OpenClawEnvironment = process.env,
): OpenClawConfig {
  const binary = environment.WEBCHESS_OPENCLAW_BIN?.trim() || 'openclaw'
  if (binary.includes('\0')) {
    throw new OpenClawConfigurationError(
      'WEBCHESS_OPENCLAW_BIN contains an invalid character.',
    )
  }

  return {
    binary,
    ...resolveBridge(environment),
    maxOutputBytes: MAX_OPENCLAW_OUTPUT_BYTES,
    timeoutMs: resolveTimeout(environment.WEBCHESS_OPENCLAW_TIMEOUT_MS),
    transport: resolveTransport(environment.WEBCHESS_OPENCLAW_TRANSPORT),
  }
}
