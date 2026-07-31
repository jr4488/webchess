import { handleOpenClawStatusRequest } from '@/server/openclaw'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const runtime = 'nodejs'

export function GET(request: Request): Promise<Response> {
  return handleOpenClawStatusRequest(request)
}
