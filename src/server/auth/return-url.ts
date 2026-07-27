const LOCAL_ORIGIN = 'https://webchess.invalid'
export const DEFAULT_RETURN_URL = '/play'

const hasUnsafeCharacters = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return character === '\\' || codePoint < 32 || codePoint === 127
  })

const localReturnPath = (
  value: string | string[] | null | undefined,
): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const candidateValue = value.trim()
  if (
    candidateValue.length === 0 ||
    !candidateValue.startsWith('/') ||
    candidateValue.startsWith('//') ||
    hasUnsafeCharacters(candidateValue)
  ) {
    return null
  }

  try {
    const candidate = new URL(candidateValue, LOCAL_ORIGIN)
    if (candidate.origin !== LOCAL_ORIGIN) {
      return null
    }

    return `${candidate.pathname}${candidate.search}${candidate.hash}`
  } catch {
    return null
  }
}

/**
 * Reduces a user-controlled return target to a path on this application.
 * Absolute, protocol-relative, malformed, and control-character URLs fall
 * back to a known local route.
 */
export function sanitizeReturnUrl(
  value: string | string[] | null | undefined,
  fallback = DEFAULT_RETURN_URL,
): string {
  return (
    localReturnPath(value) ??
    localReturnPath(fallback) ??
    DEFAULT_RETURN_URL
  )
}

function sameSiteClerkRedirect(
  value: string | string[] | null | undefined,
  siteUrl: string | undefined,
): string | null {
  const localPath = localReturnPath(value)
  if (localPath) {
    return localPath
  }

  if (
    typeof value !== 'string' ||
    typeof siteUrl !== 'string' ||
    hasUnsafeCharacters(value)
  ) {
    return null
  }

  try {
    const candidate = new URL(value.trim())
    const site = new URL(siteUrl)
    if (candidate.origin !== site.origin) {
      return null
    }

    return localReturnPath(
      `${candidate.pathname}${candidate.search}${candidate.hash}`,
    )
  } catch {
    return null
  }
}

/**
 * Resolves the app-owned return_url first, then Clerk's redirect_url. Clerk
 * supplies an absolute return URL from auth.protect(), so that form is accepted
 * only when its origin exactly matches the configured site.
 */
export function resolveAuthReturnUrl(
  returnUrl: string | string[] | null | undefined,
  clerkRedirectUrl: string | string[] | null | undefined,
  siteUrl: string | undefined,
): string {
  return (
    localReturnPath(returnUrl) ??
    sameSiteClerkRedirect(clerkRedirectUrl, siteUrl) ??
    DEFAULT_RETURN_URL
  )
}

export function buildSignInPath(
  returnUrl: string | string[] | null | undefined,
): string {
  const query = new URLSearchParams({
    return_url: sanitizeReturnUrl(returnUrl),
  })
  return `/sign-in?${query.toString()}`
}

export function buildSignUpPath(
  returnUrl: string | string[] | null | undefined,
): string {
  const query = new URLSearchParams({
    return_url: sanitizeReturnUrl(returnUrl),
  })
  return `/sign-up?${query.toString()}`
}
