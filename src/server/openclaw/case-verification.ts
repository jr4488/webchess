import 'server-only'

import { WEBCHESS_CASE_BUNDLE_MAX_BYTES } from '../../lib/case-bundle-contract'
import { verifyCaseBundle } from '../case-bundle'
import { resolveLocalOpenClawUser } from '../auth/openclaw'
import type { OpenClawEnvironment } from './config'
import { OpenClawPublicError } from './errors'
import { assertOpenClawLocalRequest } from './request-guard'

const LOCAL_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Cross-Origin-Resource-Policy': 'same-origin',
  Expires: '0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
} as const

export interface OpenClawCaseVerificationDependencies {
  environment?: OpenClawEnvironment
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: LOCAL_NO_STORE_HEADERS,
  })
}

function invalidRequest(
  status: 400 | 413 | 415,
  message: string,
): OpenClawPublicError {
  return new OpenClawPublicError('INVALID_REQUEST', status, message)
}

async function readBoundedCaseBundle(request: Request): Promise<unknown> {
  const mediaType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase()
  if (mediaType !== 'application/json') {
    throw invalidRequest(
      415,
      'Local case verification requires one JSON case bundle.',
    )
  }

  const declaredLength = request.headers.get('content-length')
  if (
    declaredLength !== null &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > WEBCHESS_CASE_BUNDLE_MAX_BYTES
  ) {
    throw invalidRequest(413, 'The local case bundle is too large to verify.')
  }

  const reader = request.body?.getReader()
  if (!reader) {
    throw invalidRequest(400, 'The local case bundle is empty.')
  }

  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    byteLength += chunk.value.byteLength
    if (byteLength > WEBCHESS_CASE_BUNDLE_MAX_BYTES) {
      await reader.cancel()
      throw invalidRequest(413, 'The local case bundle is too large to verify.')
    }
    chunks.push(chunk.value)
  }
  if (byteLength < 2) {
    throw invalidRequest(400, 'The local case bundle is empty.')
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw invalidRequest(400, 'The local case bundle is not valid UTF-8 JSON.')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw invalidRequest(400, 'The local case bundle contains invalid JSON.')
  }
}

function errorResponse(error: unknown): Response {
  const publicError =
    error instanceof OpenClawPublicError
      ? error
      : new OpenClawPublicError(
      'OPENCLAW_REQUEST_FAILED',
          500,
          'Local WebChess could not verify this case bundle.',
        )
  return jsonResponse(
    {
      error: {
        code: publicError.code,
        message: publicError.message,
      },
    },
    publicError.status,
  )
}

/**
 * Verifies one uploaded artifact in process memory. This intentionally does
 * not supply local checkout context, persist content, or call any provider.
 */
export async function handleOpenClawCaseVerificationRequest(
  request: Request,
  dependencies: OpenClawCaseVerificationDependencies = {},
): Promise<Response> {
  try {
    const environment = dependencies.environment ?? process.env
    assertOpenClawLocalRequest(request, {
      environment,
      mutation: true,
    })
    if (!resolveLocalOpenClawUser(request, environment)) {
      throw new OpenClawPublicError(
        'INVALID_REQUEST',
        403,
        'Local case verification requires the authenticated OpenClaw runtime.',
      )
    }

    const bundle = await readBoundedCaseBundle(request)
    return jsonResponse({
      verification: verifyCaseBundle(bundle),
    })
  } catch (error) {
    return errorResponse(error)
  }
}
