import type { NextRequest } from 'next/server'
import { handleDeleteAccountRequest } from '@/server/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function DELETE(request: NextRequest): Promise<Response> {
  return handleDeleteAccountRequest(request)
}
