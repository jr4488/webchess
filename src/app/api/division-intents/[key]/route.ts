import type { NextRequest } from 'next/server'
import { handleDivisionIntentRequest } from '@/server/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{
    key: string
  }>
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { key } = await context.params
  return handleDivisionIntentRequest(request, key)
}
