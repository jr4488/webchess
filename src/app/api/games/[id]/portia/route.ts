import type { NextRequest } from 'next/server'
import { handlePortiaRequest } from '@/server/http'

export const dynamic = 'force-dynamic'
// Search may consume 300s before bounded, resumable Portia candidate turns.
export const maxDuration = 6_000
export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params
  return handlePortiaRequest(request, id)
}
