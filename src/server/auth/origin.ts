import { forbiddenOriginJson } from './responses'
import { resolveLocalOpenClawUser } from './openclaw'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/gu, '')
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
}

function isLocalOpenClawOrigin(
  request: Request,
  originHeader: string | null,
): boolean {
  if (!resolveLocalOpenClawUser(request)) return false
  if (!originHeader) return true
  if (originHeader === 'null') return false

  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') return false
  try {
    const requestUrl = new URL(request.url)
    const suppliedOrigin = new URL(originHeader)
    return (
      originHeader === suppliedOrigin.origin &&
      isLoopbackHostname(suppliedOrigin.hostname) &&
      suppliedOrigin.port === requestUrl.port
    )
  } catch {
    return false
  }
}

/**
 * Returns null when a browser mutation is same-origin, otherwise a JSON 403
 * response that a Route Handler can return directly.
 */
export function verifySameOriginMutation(request: Request): Response | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return null
  }

  const originHeader = request.headers.get('origin')
  if (isLocalOpenClawOrigin(request, originHeader)) {
    return null
  }
  if (!originHeader || originHeader === 'null') {
    return forbiddenOriginJson()
  }

  let requestOrigin: string
  let suppliedOrigin: string
  try {
    requestOrigin = new URL(request.url).origin
    suppliedOrigin = new URL(originHeader).origin
  } catch {
    return forbiddenOriginJson()
  }

  if (requestOrigin !== suppliedOrigin || originHeader !== suppliedOrigin) {
    return forbiddenOriginJson()
  }

  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') {
    return forbiddenOriginJson()
  }

  return null
}
