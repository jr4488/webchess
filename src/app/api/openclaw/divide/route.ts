import { handleOpenClawDivideRequest } from '@/server/openclaw'

export const dynamic = 'force-dynamic'
export const maxDuration = 150
export const runtime = 'nodejs'

export function POST(request: Request): Promise<Response> {
  return handleOpenClawDivideRequest(request)
}
