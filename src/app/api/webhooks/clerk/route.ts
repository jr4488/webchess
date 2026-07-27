import type { NextRequest } from 'next/server'
import { handleClerkWebhookRequest } from '@/server/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function POST(request: NextRequest): Promise<Response> {
  return handleClerkWebhookRequest(request)
}
