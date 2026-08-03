import type { NextRequest } from 'next/server'
import { handleRetryLifecycleRequest } from '@/server/http'

export const dynamic = 'force-dynamic'
export const maxDuration = 150
export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params
  return handleRetryLifecycleRequest(request, id)
}
