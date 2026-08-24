import {
  loadPublicReleaseIdentity,
  retainedReleaseArchivePath,
} from '@/lib/release-source'
import type { PublicReleaseIdentity } from '@/lib/release-source'

type ReleaseEnvironment = Readonly<{
  VERCEL_GIT_COMMIT_SHA?: string
  WEBCHESS_RELEASE_SHA?: string
}>

export function sourceArchiveResponse({
  environment = process.env as ReleaseEnvironment,
  identity = loadPublicReleaseIdentity(),
}: {
  environment?: ReleaseEnvironment
  identity?: PublicReleaseIdentity | null
} = {}): Response {
  const location = retainedReleaseArchivePath(environment, identity)
  if (!location) {
    return Response.json(
      {
        error: {
          code: 'RELEASE_IDENTITY_UNAVAILABLE',
          message:
            'The resolved release identity and retained source artifact are unavailable; branch and generated GitHub archives are never substituted.',
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

export function GET(): Response {
  return sourceArchiveResponse()
}
