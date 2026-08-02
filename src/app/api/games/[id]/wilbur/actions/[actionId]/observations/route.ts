import type { NextRequest } from 'next/server'
import { handleAppendWilburObservationRequest } from '@/server/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ id: string; actionId: string }>
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { id, actionId } = await context.params
  return handleAppendWilburObservationRequest(request, id, actionId)
}
