import { handleOpenClawCaseVerificationRequest } from '@/server/openclaw'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function POST(request: Request): Promise<Response> {
  return handleOpenClawCaseVerificationRequest(request)
}
