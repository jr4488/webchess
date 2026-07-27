import type { NextRequest } from 'next/server'
import { handleAccountUsageRequest } from '@/server/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function GET(request: NextRequest): Promise<Response> {
  return handleAccountUsageRequest(request)
}
