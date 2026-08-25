import type { NextRequest } from 'next/server'
import { handleDivideRequest } from '@/server/http'

export const dynamic = 'force-dynamic'
// 300s authenticated envelope, 5s response drain, plus 30s settlement.
export const maxDuration = 335
export const runtime = 'nodejs'

export function POST(request: NextRequest): Promise<Response> {
  return handleDivideRequest(request)
}
