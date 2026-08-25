import type { NextRequest } from 'next/server'
import { handleCharlotteRequest } from '@/server/http'

export const dynamic = 'force-dynamic'
// 300s authenticated envelope, 5s response drain, plus 30s settlement.
export const maxDuration = 335
export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params
  return handleCharlotteRequest(request, id)
}
