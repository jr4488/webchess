import type { NextRequest } from 'next/server'
import { handleWebMemoryRequest } from '@/server/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function GET(request: NextRequest): Promise<Response> {
  return handleWebMemoryRequest(request)
}
