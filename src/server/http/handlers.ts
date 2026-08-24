import 'server-only'

import type { NextRequest } from 'next/server'
import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { requireApiUser, verifySameOriginMutation } from '@/server/auth'
import {
  appendWilburObservationBodySchema,
  caseExportBodySchema,
  createWilburActionBodySchema,
  deleteAccountBodySchema,
  divideBodySchema,
  moveBodySchema,
  revisionBodySchema,
  updateWilburActionBodySchema,
} from './contracts'
import { ApiError } from './errors'
import {
  createRequestId,
  getClientIpAddress,
  parseStrictJson,
  requireDivisionIntentKey,
  requireGameId,
  requireIdempotencyKey,
} from './guards'
import type {
  AuthenticatedApiUser,
  ClerkWebhookDependencies,
  ClerkWebhookEvent,
  HttpDependencies,
  WebChessApiServices,
} from './ports'
import {
  emptyResponse,
  errorResponse,
  jsonResponse,
  noStoreHeaders,
  withNoStore,
} from './responses'
import { getApiServices } from './services'

type HandlerDependencies = Partial<HttpDependencies>

interface RequestScope {
  requestId: string
  services: WebChessApiServices
  user: AuthenticatedApiUser
}

async function establishRequestScope(
  request: Request,
  mutation: boolean,
  dependencies?: HandlerDependencies,
): Promise<RequestScope | Response> {
  const requestId = createRequestId()
  const authenticate = dependencies?.authenticate ?? requireApiUser
  const user = await authenticate(request)

  if (user instanceof Response) {
    return withNoStore(user, requestId)
  }

  if (mutation) {
    const sameOrigin = dependencies?.verifySameOrigin ?? verifySameOriginMutation
    const rejection = sameOrigin(request)

    if (rejection) {
      return withNoStore(rejection, requestId)
    }
  }

  return {
    requestId,
    services: dependencies?.services ?? (await getApiServices(user.source)),
    user,
  }
}

async function runAuthenticated(
  request: Request,
  mutation: boolean,
  operation: (scope: RequestScope) => Promise<Response>,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  let requestId = createRequestId()

  try {
    const scope = await establishRequestScope(request, mutation, dependencies)

    if (scope instanceof Response) {
      return scope
    }

    requestId = scope.requestId
    return withNoStore(await operation(scope), requestId)
  } catch (error) {
    return errorResponse(error, requestId)
  }
}

function ownerContext(scope: RequestScope, request: Request) {
  return {
    ownerId: scope.user.userId,
    requestId: scope.requestId,
    signal: request.signal,
  }
}

function operationContext(scope: RequestScope, request: Request) {
  return {
    ...ownerContext(scope, request),
    ipAddress: getClientIpAddress(request),
    idempotencyKey: requireIdempotencyKey(request),
  }
}

export function handleDivideRequest(
  request: Request,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    true,
    async (scope) => {
      const body = await parseStrictJson(request, divideBodySchema)
      const game = await scope.services.divide({
        ...operationContext(scope, request),
        problem: body.problem,
        memoryObservationIds: body.memoryObservationIds,
        researchConsent: body.researchConsent,
      })

      return jsonResponse({ game }, { status: 201 })
    },
    dependencies,
  )
}

export function handleWebMemoryRequest(
  request: Request,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    false,
    async (scope) => {
      const memory = await scope.services.getWebMemory(
        ownerContext(scope, request),
      )
      return jsonResponse({ memory })
    },
    dependencies,
  )
}

export function handleCurrentGameRequest(
  request: Request,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    false,
    async (scope) => {
      const game = await scope.services.getCurrentGame(ownerContext(scope, request))
      return jsonResponse({ game })
    },
    dependencies,
  )
}

export function handleGetGameRequest(
  request: Request,
  rawGameId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    false,
    async (scope) => {
      const gameId = requireGameId(rawGameId)
      const game = await scope.services.getGame({
        ...ownerContext(scope, request),
        gameId,
      })

      return jsonResponse({ game })
    },
    dependencies,
  )
}

export function handleDivisionIntentRequest(
  request: Request,
  rawIdempotencyKey: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    false,
    async (scope) => {
      const idempotencyKey = requireDivisionIntentKey(rawIdempotencyKey)
      const game = await scope.services.getDivisionIntent({
        ...ownerContext(scope, request),
        idempotencyKey,
      })

      return jsonResponse({ game })
    },
    dependencies,
  )
}

export function handleStartGameRequest(
  request: Request,
  rawGameId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runRevisionMutation(request, rawGameId, 'startGame', dependencies)
}

export function handleMoveRequest(
  request: Request,
  rawGameId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    true,
    async (scope) => {
      const gameId = requireGameId(rawGameId)
      const body = await parseStrictJson(request, moveBodySchema)
      const game = await scope.services.move({
        ...operationContext(scope, request),
        gameId,
        expectedRevision: body.expectedRevision,
        pieceId: body.pieceId,
        to: body.to,
      })

      return jsonResponse({ game })
    },
    dependencies,
  )
}

export function handleAnswerRequest(
  request: Request,
  rawGameId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    true,
    async (scope) => {
      const gameId = requireGameId(rawGameId)
      const body = await parseStrictJson(request, revisionBodySchema)
      const result = await scope.services.answer({
        ...operationContext(scope, request),
        gameId,
        expectedRevision: body.expectedRevision,
      })

      return jsonResponse(result)
    },
    dependencies,
  )
}

export function handleLifecycleRequest(
  request: Request,
  rawGameId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    false,
    async (scope) => {
      const lifecycle = await scope.services.getLifecycle({
        ...ownerContext(scope, request),
        gameId: requireGameId(rawGameId),
      })
      return jsonResponse({ lifecycle })
    },
    dependencies,
  )
}

async function runLifecycleRevisionMutation(
  request: Request,
  rawGameId: string,
  method: 'runPortia' | 'runCharlotte',
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    true,
    async (scope) => {
      const body = await parseStrictJson(request, revisionBodySchema)
      const lifecycle = await scope.services[method]({
        ...operationContext(scope, request),
        gameId: requireGameId(rawGameId),
        expectedRevision: body.expectedRevision,
      })
      return jsonResponse({ lifecycle })
    },
    dependencies,
  )
}

export function handlePortiaRequest(
  request: Request,
  rawGameId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runLifecycleRevisionMutation(
    request,
    rawGameId,
    'runPortia',
    dependencies,
  )
}

export function handleCharlotteRequest(
  request: Request,
  rawGameId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runLifecycleRevisionMutation(
    request,
    rawGameId,
    'runCharlotte',
    dependencies,
  )
}

export function handleRetryLifecycleRequest(
  request: Request,
  rawGameId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    true,
    async (scope) => {
      const body = await parseStrictJson(request, revisionBodySchema)
      const result = await scope.services.retryLifecycle({
        ...operationContext(scope, request),
        gameId: requireGameId(rawGameId),
        expectedRevision: body.expectedRevision,
      })
      return jsonResponse(result, { status: result.game ? 201 : 200 })
    },
    dependencies,
  )
}

export function handleProvenanceRequest(
  request: Request,
  rawGameId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    false,
    async (scope) => {
      const activities = await scope.services.getProvenance({
        ...ownerContext(scope, request),
        gameId: requireGameId(rawGameId),
      })
      return jsonResponse({ activities })
    },
    dependencies,
  )
}

export function handleCreateWilburActionRequest(
  request: Request,
  rawGameId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    true,
    async (scope) => {
      const body = await parseStrictJson(request, createWilburActionBodySchema)
      const action = await scope.services.createWilburAction({
        ...operationContext(scope, request),
        gameId: requireGameId(rawGameId),
        ...body,
      })
      return jsonResponse({ action }, { status: 201 })
    },
    dependencies,
  )
}

export function handleUpdateWilburActionRequest(
  request: Request,
  rawGameId: string,
  rawActionId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    true,
    async (scope) => {
      const body = await parseStrictJson(request, updateWilburActionBodySchema)
      const action = await scope.services.updateWilburAction({
        ...operationContext(scope, request),
        gameId: requireGameId(rawGameId),
        actionId: requireGameId(rawActionId),
        ...body,
      })
      return jsonResponse({ action })
    },
    dependencies,
  )
}

export function handleAppendWilburObservationRequest(
  request: Request,
  rawGameId: string,
  rawActionId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    true,
    async (scope) => {
      const body = await parseStrictJson(
        request,
        appendWilburObservationBodySchema,
      )
      const observation = await scope.services.appendWilburObservation({
        ...operationContext(scope, request),
        gameId: requireGameId(rawGameId),
        actionId: requireGameId(rawActionId),
        ...body,
      })
      return jsonResponse({ observation }, { status: 201 })
    },
    dependencies,
  )
}

export function handleReplayRequest(
  request: Request,
  rawGameId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runRevisionMutation(request, rawGameId, 'replay', dependencies, 201)
}

export function handleAbandonRequest(
  request: Request,
  rawGameId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runRevisionMutation(request, rawGameId, 'abandon', dependencies)
}

async function runRevisionMutation(
  request: Request,
  rawGameId: string,
  method: 'abandon' | 'replay' | 'startGame',
  dependencies?: HandlerDependencies,
  successStatus = 200,
): Promise<Response> {
  return runAuthenticated(
    request,
    true,
    async (scope) => {
      const gameId = requireGameId(rawGameId)
      const body = await parseStrictJson(request, revisionBodySchema)
      const game = await scope.services[method]({
        ...operationContext(scope, request),
        gameId,
        expectedRevision: body.expectedRevision,
      })

      return jsonResponse({ game }, { status: successStatus })
    },
    dependencies,
  )
}

export function handleAccountUsageRequest(
  request: Request,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    false,
    async (scope) => {
      const usage = await scope.services.getAccountUsage(ownerContext(scope, request))
      return jsonResponse({ usage })
    },
    dependencies,
  )
}

export function handleAccountExportRequest(
  request: Request,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    true,
    async (scope) => {
      const exported = await scope.services.exportAccount({
        ...ownerContext(scope, request),
        ipAddress: getClientIpAddress(request),
      })
      const fileName = `webchess-export-${new Date().toISOString().slice(0, 10)}.json`

      return new Response(`${JSON.stringify(exported, null, 2)}\n`, {
        status: 200,
        headers: noStoreHeaders({
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Type': 'application/json; charset=utf-8',
        }),
      })
    },
    dependencies,
  )
}

export function handleCaseExportRequest(
  request: Request,
  rawGameId: string,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    true,
    async (scope) => {
      const gameId = requireGameId(rawGameId)
      const body = await parseStrictJson(request, caseExportBodySchema)
      const bundle = await scope.services.exportCase({
        ...ownerContext(scope, request),
        gameId,
        profile: body.profile,
        ipAddress: getClientIpAddress(request),
      })
      const date = new Date().toISOString().slice(0, 10)
      const fileName = `webchess-case-${gameId}-${body.profile}-${date}.json`

      return new Response(`${JSON.stringify(bundle, null, 2)}\n`, {
        status: 200,
        headers: noStoreHeaders({
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Type': 'application/json; charset=utf-8',
        }),
      })
    },
    dependencies,
  )
}

export function handleDeleteAccountRequest(
  request: Request,
  dependencies?: HandlerDependencies,
): Promise<Response> {
  return runAuthenticated(
    request,
    true,
    async (scope) => {
      await parseStrictJson(request, deleteAccountBodySchema)
      await scope.services.deleteAccountData(operationContext(scope, request))
      return emptyResponse()
    },
    dependencies,
  )
}

async function defaultVerifyClerkWebhook(request: Request): Promise<ClerkWebhookEvent> {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim()) {
    throw new ApiError(
      'SERVICE_UNAVAILABLE',
      503,
      'The Clerk webhook is not configured.',
    )
  }

  return (await verifyWebhook(request as NextRequest)) as ClerkWebhookEvent
}

export async function handleClerkWebhookRequest(
  request: Request,
  dependencies?: Partial<ClerkWebhookDependencies>,
): Promise<Response> {
  const requestId = createRequestId()

  try {
    let event: ClerkWebhookEvent
    try {
      event = await (dependencies?.verify ?? defaultVerifyClerkWebhook)(request)
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }

      throw new ApiError('BAD_REQUEST', 400, 'The webhook signature is invalid.', {
        cause: error,
      })
    }

    if (event.type !== 'user.deleted') {
      return jsonResponse(
        { received: true },
        { headers: { 'X-Request-Id': requestId } },
      )
    }

    const data =
      event.data && typeof event.data === 'object' && !Array.isArray(event.data)
        ? (event.data as { id?: unknown })
        : null
    if (
      !data ||
      typeof data.id !== 'string' ||
      data.id.length < 3 ||
      data.id.length > 255
    ) {
      throw new ApiError('BAD_REQUEST', 400, 'The deletion event is invalid.')
    }

    const webhookEventId = request.headers.get('svix-id')
    if (!webhookEventId || webhookEventId.length > 256) {
      throw new ApiError('BAD_REQUEST', 400, 'The webhook event identifier is invalid.')
    }

    const services = dependencies?.services ?? (await getApiServices('clerk'))
    await services.handleClerkUserDeleted({
      clerkUserId: data.id,
      webhookEventId,
      requestId,
    })

    return jsonResponse(
      { received: true },
      { headers: { 'X-Request-Id': requestId } },
    )
  } catch (error) {
    return errorResponse(error, requestId)
  }
}
