import type { DurableGame } from '../../lib/webchess-api'
import type {
  AssumptionResult,
  LifecycleActivity,
  LifecycleAggregate,
  WilburAction,
  WilburActionStatus,
  WilburObservation,
  WebMemoryIndex,
} from '../../lib/lifecycle'
import type { ResearchConsent } from '../../lib/research'
import type { WebChessCaseProfile } from '../../lib/case-bundle-contract'
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

export interface CreateWilburActionCommand extends ApiOperationContext {
  ownerId: string
  gameId: string
  charlotteActionIndex: number
  actor: string
  action: string
  testedAssumption: string
  expectedObservation: string
  decisionThreshold: string
  reviewHorizon: string
  followUpAt?: string | null
}

export interface UpdateWilburActionCommand extends ApiOperationContext {
  ownerId: string
  gameId: string
  actionId: string
  expectedRevision: number
  status: WilburActionStatus
  followUpAt?: string | null
}

export interface AppendWilburObservationCommand extends ApiOperationContext {
  ownerId: string
  gameId: string
  actionId: string
  observedAt: string
  observation: string
  evidenceClassification: string
  expectedEffect: string
  unexpectedEffect: string
  stakeholderResponse: string
  assumptionResult: AssumptionResult
  nextDecision: string
}

export interface WebChessApiServices {
  divide(input: {
    ownerId: string
    problem: string
    memoryObservationIds?: readonly string[]
    researchConsent: Omit<ResearchConsent, 'recordedAt'>
  } & ApiOperationContext): Promise<DurableGameDto>

  getCurrentGame(input: OwnerContext): Promise<DurableGameDto | null>

  getWebMemory(input: OwnerContext): Promise<WebMemoryIndex>

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

  getLifecycle(input: OwnerContext & {
    gameId: string
  }): Promise<LifecycleAggregate>

  runPortia(input: RevisionCommand): Promise<LifecycleAggregate>

  retryLifecycle(input: RevisionCommand): Promise<{
    game: DurableGameDto | null
    lifecycle: LifecycleAggregate
  }>

  runCharlotte(input: RevisionCommand): Promise<LifecycleAggregate>

  getProvenance(input: OwnerContext & {
    gameId: string
  }): Promise<readonly LifecycleActivity[]>

  createWilburAction(
    input: CreateWilburActionCommand,
  ): Promise<WilburAction>

  updateWilburAction(
    input: UpdateWilburActionCommand,
  ): Promise<WilburAction>

  appendWilburObservation(
    input: AppendWilburObservationCommand,
  ): Promise<WilburObservation>

  replay(input: RevisionCommand): Promise<DurableGameDto>

  abandon(input: RevisionCommand): Promise<DurableGameDto>

  getAccountUsage(input: OwnerContext): Promise<AccountUsageDto>

  exportAccount(input: OwnerContext & {
    /** Request-local only. The usage service HMACs this before persistence. */
    ipAddress: string
  }): Promise<unknown>

  exportCase(input: OwnerContext & {
    readonly gameId: string
    readonly profile: WebChessCaseProfile
    /** Request-local only. The usage service HMACs this before persistence. */
    readonly ipAddress: string
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
  source: 'clerk' | 'local-e2e' | 'local-openclaw' | 'local-hosted'
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
