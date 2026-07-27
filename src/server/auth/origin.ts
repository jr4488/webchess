import { forbiddenOriginJson } from './responses'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Returns null when a browser mutation is same-origin, otherwise a JSON 403
 * response that a Route Handler can return directly.
 */
export function verifySameOriginMutation(request: Request): Response | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return null
  }

  const originHeader = request.headers.get('origin')
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
