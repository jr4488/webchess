import { isOpenClawLocalModeEnabled, type OpenClawEnvironment } from './config'
import { OpenClawPublicError } from './errors'

export const MAX_OPENCLAW_JSON_BODY_BYTES = 512 * 1024

function normalizedHostname(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/gu, '')
}

export function isLoopbackHostname(value: string): boolean {
  const hostname = normalizedHostname(value)
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  )
}

function parseHostHeader(value: string): URL {
  if (
    value.trim() !== value ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('@')
  ) {
    throw new OpenClawPublicError(
      'LOOPBACK_REQUIRED',
      403,
      'The local OpenClaw bridge only accepts loopback requests.',
    )
  }

  try {
    return new URL(`http://${value}`)
  } catch {
    throw new OpenClawPublicError(
      'LOOPBACK_REQUIRED',
      403,
      'The local OpenClaw bridge only accepts loopback requests.',
    )
  }
}

export function assertOpenClawLocalRequest(
  request: Request,
  options: {
    environment?: OpenClawEnvironment
    mutation?: boolean
  } = {},
): void {
  if (!isOpenClawLocalModeEnabled(options.environment)) {
    throw new OpenClawPublicError(
      'LOCAL_MODE_DISABLED',
      404,
      'Local OpenClaw mode is not enabled on this WebChess server.',
    )
  }

  const requestUrl = new URL(request.url)
  const hostHeader = request.headers.get('host')
  if (!hostHeader) {
    throw new OpenClawPublicError(
      'LOOPBACK_REQUIRED',
      403,
      'The local OpenClaw bridge only accepts loopback requests.',
    )
  }

  const parsedHost = parseHostHeader(hostHeader)
  if (
    !isLoopbackHostname(requestUrl.hostname) ||
    !isLoopbackHostname(parsedHost.hostname) ||
    parsedHost.port !== requestUrl.port
  ) {
    throw new OpenClawPublicError(
      'LOOPBACK_REQUIRED',
      403,
      'The local OpenClaw bridge only accepts loopback requests.',
    )
  }

  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite !== null && fetchSite !== 'same-origin') {
    throw new OpenClawPublicError(
      'CROSS_ORIGIN_REQUEST',
      403,
      'The local OpenClaw bridge only accepts same-origin requests.',
    )
  }

  if (!options.mutation) return

  const origin = request.headers.get('origin')
  let parsedOrigin: URL
  try {
    if (!origin) throw new Error('Missing Origin header.')
    parsedOrigin = new URL(origin)
  } catch {
    throw new OpenClawPublicError(
      'CROSS_ORIGIN_REQUEST',
      403,
      'The local OpenClaw bridge only accepts same-origin changes.',
    )
  }

  if (
    parsedOrigin.origin !== parsedHost.origin
  ) {
    throw new OpenClawPublicError(
      'CROSS_ORIGIN_REQUEST',
      403,
      'The local OpenClaw bridge only accepts same-origin changes.',
    )
  }
}

export async function readBoundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new OpenClawPublicError(
      'INVALID_REQUEST',
      415,
      'The local OpenClaw bridge requires a JSON request.',
    )
  }

  const declaredLength = request.headers.get('content-length')
  if (
    declaredLength !== null &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > MAX_OPENCLAW_JSON_BODY_BYTES
  ) {
    throw new OpenClawPublicError(
      'INVALID_REQUEST',
      413,
      'The local WebChess request is too large.',
    )
  }

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_OPENCLAW_JSON_BODY_BYTES) {
    throw new OpenClawPublicError(
      'INVALID_REQUEST',
      413,
      'The local WebChess request is too large.',
    )
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new OpenClawPublicError(
      'INVALID_REQUEST',
      400,
      'The local WebChess request contains invalid JSON.',
    )
  }
}
