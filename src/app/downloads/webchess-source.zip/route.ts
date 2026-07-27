const REPOSITORY_ARCHIVE_ROOT =
  'https://github.com/jr4488/webchess/archive'
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}$/i

function archiveUrl(): string | null {
  const commit = (
    process.env.WEBCHESS_RELEASE_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA
  )?.trim()

  if (commit && GIT_COMMIT_PATTERN.test(commit)) {
    return `${REPOSITORY_ARCHIVE_ROOT}/${commit}.zip`
  }

  if (process.env.VERCEL !== undefined || process.env.VERCEL_ENV !== undefined) {
    return null
  }

  return `${REPOSITORY_ARCHIVE_ROOT}/refs/heads/main.zip`
}

export function GET(): Response {
  const location = archiveUrl()
  if (!location) {
    return Response.json(
      {
        error: {
          code: 'RELEASE_SHA_UNAVAILABLE',
          message: 'The source archive is temporarily unavailable.',
        },
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    )
  }

  return new Response(null, {
    status: 307,
    headers: {
      'Cache-Control': 'no-store',
      Location: location,
    },
  })
}
