import type { NextRequest } from 'next/server'
import { handleAnswerRequest } from '@/server/http'
import { ANSWER_OPERATION_TIMEOUT_MS } from '@/server/model-operation-timeouts'

export const dynamic = 'force-dynamic'
// The route-entry cutoff includes auth, service initialization, and parsing;
// 5s drains the response and 30s remains settlement-only headroom.
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
  const operationDeadlineAt = new Date(
    Date.now() + ANSWER_OPERATION_TIMEOUT_MS,
  )
  const { id } = await context.params
  return handleAnswerRequest(request, id, { operationDeadlineAt })
}
