import { configuredReleaseCommit } from '@/lib/release-source'

const REPOSITORY_ARCHIVE_ROOT =
  'https://github.com/jr4488/webchess/archive'

function archiveUrl(): string | null {
  const commit = configuredReleaseCommit()
  return commit ? `${REPOSITORY_ARCHIVE_ROOT}/${commit}.zip` : null
}

export function GET(): Response {
  const location = archiveUrl()
  if (!location) {
    return Response.json(
      {
        error: {
          code: 'RELEASE_SHA_UNAVAILABLE',
          message:
            'The immutable release source identity is unavailable; branch archives are never substituted.',
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
