import type { NextRequest } from 'next/server'
import { handleAnswerRequest } from '@/server/http'

export const dynamic = 'force-dynamic'
// Answer's authenticated aggregate window is 300s; 5s drains the loopback
// response and the final 30s is settlement-only grace.
export const maxDuration = 335
export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params
  return handleAnswerRequest(request, id)
}
