import type { NextRequest } from 'next/server'
import { handleDivideRequest } from '@/server/http'

export const dynamic = 'force-dynamic'
export const maxDuration = 150
export const runtime = 'nodejs'

export function POST(request: NextRequest): Promise<Response> {
  return handleDivideRequest(request)
}
