import type { DurableGame } from '../../lib/webchess-api'
import type { GeneratedAnswer } from '../../types'

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export interface JsonObject {
  [key: string]: JsonValue
}

export interface UsageAmountDto {
  used: number
  reserved: number
  limit: number
  remaining: number
}

export interface AccountUsageDto {
  period: {
    startsAt: string
    endsAt: string
  }
  modelOperations: UsageAmountDto
  gameStarts: UsageAmountDto
  activeModelRequests: number
}

/**
 * Public game DTOs are deliberately opaque at the HTTP boundary. The domain
 * service owns their shape; route handlers only wrap them consistently and
 * never reconstruct authoritative game state from request data.
 */
export type DurableGameDto = DurableGame

export interface ApiOperationContext {
  /** Request-local only. The usage service must HMAC this before persistence. */
  ipAddress: string
  idempotencyKey: string
  requestId: string
  signal: AbortSignal
}

export interface OwnerContext {
  ownerId: string
  requestId: string
  signal: AbortSignal
}

export interface RevisionCommand extends ApiOperationContext {
  ownerId: string
  gameId: string
  expectedRevision: number
}

export interface MoveCommand extends RevisionCommand {
  pieceId: string
  to: {
    ring: number
    sector: number
  }
}

export interface WebChessApiServices {
  divide(input: {
    ownerId: string
    problem: string
  } & ApiOperationContext): Promise<DurableGameDto>

  getCurrentGame(input: OwnerContext): Promise<DurableGameDto | null>

  getGame(input: OwnerContext & {
    gameId: string
  }): Promise<DurableGameDto>

  getDivisionIntent(input: OwnerContext & {
    idempotencyKey: string
  }): Promise<DurableGameDto>

  startGame(input: RevisionCommand): Promise<DurableGameDto>

  move(input: MoveCommand): Promise<DurableGameDto>

  answer(input: RevisionCommand): Promise<{
    game: DurableGameDto
    answer: GeneratedAnswer
  }>

  replay(input: RevisionCommand): Promise<DurableGameDto>

  abandon(input: RevisionCommand): Promise<DurableGameDto>

  getAccountUsage(input: OwnerContext): Promise<AccountUsageDto>

  exportAccount(input: OwnerContext & {
    /** Request-local only. The usage service HMACs this before persistence. */
    ipAddress: string
  }): Promise<unknown>

  deleteAccountData(input: OwnerContext & ApiOperationContext): Promise<void>

  handleClerkUserDeleted(input: {
    clerkUserId: string
    webhookEventId: string
    requestId: string
  }): Promise<void>
}

export interface AuthenticatedApiUser {
  userId: string
  source: 'clerk' | 'local-e2e'
}

export interface HttpDependencies {
  authenticate(request: Request): Promise<AuthenticatedApiUser | Response>
  verifySameOrigin(request: Request): Response | null
  services: WebChessApiServices
}

export type ClerkWebhookEvent =
  | {
      type: 'user.deleted'
      data: {
        id?: string | null
      }
    }
  | {
      type: string
      data: unknown
    }

export interface ClerkWebhookDependencies {
  verify(request: Request): Promise<ClerkWebhookEvent>
  services: WebChessApiServices
}
