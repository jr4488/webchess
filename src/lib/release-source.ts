const RELEASE_COMMIT_PATTERN = /^[a-f0-9]{40}$/u

export const WEBCHESS_REPOSITORY_URL =
  'https://github.com/jr4488/webchess' as const

type ReleaseEnvironment = Readonly<{
  VERCEL_GIT_COMMIT_SHA?: string
  WEBCHESS_RELEASE_SHA?: string
}>

/**
 * Resolve only an explicitly reviewed full release commit. Deployment
 * metadata may corroborate that identity but never creates one implicitly;
 * public source links never fall back to a branch, tag, or abbreviated SHA.
 */
export function configuredReleaseCommit(
  environment: ReleaseEnvironment = process.env as ReleaseEnvironment,
): string | null {
  const reviewed = environment.WEBCHESS_RELEASE_SHA?.trim().toLowerCase()
  const deployed = environment.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase()

  if (!reviewed || !RELEASE_COMMIT_PATTERN.test(reviewed)) {
    return null
  }

  if (deployed && (!RELEASE_COMMIT_PATTERN.test(deployed) || deployed !== reviewed)) {
    return null
  }

  return reviewed
}

export function immutableReleaseSourceUrl(
  environment: ReleaseEnvironment = process.env as ReleaseEnvironment,
): string | null {
  const commit = configuredReleaseCommit(environment)
  return commit ? `${WEBCHESS_REPOSITORY_URL}/tree/${commit}` : null
}
