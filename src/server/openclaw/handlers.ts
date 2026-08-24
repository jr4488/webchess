import { z } from 'zod'

import {
  getOpenClawStatus,
  OpenClawCliError,
  type OpenClawExecutor,
} from './cli'
import {
  OpenClawConfigurationError,
  resolveOpenClawConfig,
  type OpenClawEnvironment,
} from './config'
import {
  isOpenClawPublicError,
  OpenClawPublicError,
} from './errors'
import {
  generateOpenClawAnswer,
  generateOpenClawDivision,
  OpenClawAnswerBodySchema,
  OpenClawDivideBodySchema,
} from './generation'
import {
  assertOpenClawLocalRequest,
  readBoundedJson,
} from './request-guard'
import {
  getOpenClawDatabaseStatus,
  OpenClawDatabaseReadinessError,
  type OpenClawDatabaseStatus,
} from './services'

const LOCAL_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Cross-Origin-Resource-Policy': 'same-origin',
  Expires: '0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
} as const

export interface OpenClawHandlerDependencies {
  environment?: OpenClawEnvironment
  ensureServices?: () => Promise<OpenClawDatabaseStatus>
  execute?: OpenClawExecutor
  seed?: () => string
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: LOCAL_NO_STORE_HEADERS,
  })
}

function unavailableDatabaseStatus(error: unknown) {
  if (error instanceof OpenClawDatabaseReadinessError) {
    return {
      available: false as const,
      ...(error.detectedMajorVersion === undefined
        ? {}
        : { detectedMajorVersion: error.detectedMajorVersion }),
      ...(error.detectedServerVersion === undefined
        ? {}
        : { detectedServerVersion: error.detectedServerVersion }),
      engine: 'PostgreSQL' as const,
      reason: error.reason,
      scope: 'dedicated-local' as const,
    }
  }
  return {
    available: false as const,
    engine: 'PostgreSQL' as const,
    reason: 'unavailable' as const,
    scope: 'dedicated-local' as const,
  }
}

function mapCliError(error: OpenClawCliError): OpenClawPublicError {
  switch (error.kind) {
    case 'not-found':
      return new OpenClawPublicError(
        'OPENCLAW_NOT_FOUND',
        503,
        'OpenClaw was not found. Install it locally or configure the plugin with its executable path.',
      )
    case 'timeout':
      return new OpenClawPublicError(
        'OPENCLAW_TIMEOUT',
        504,
        'The local OpenClaw model turn timed out. Try again or choose a faster configured model.',
      )
    case 'aborted':
      return new OpenClawPublicError(
        'OPENCLAW_REQUEST_ABORTED',
        408,
        'The local OpenClaw model turn was cancelled.',
      )
    case 'invalid-output':
      return new OpenClawPublicError(
        'INVALID_MODEL_RESPONSE',
        502,
        'OpenClaw returned an unexpected local model response.',
      )
    case 'failed':
      return new OpenClawPublicError(
        'OPENCLAW_REQUEST_FAILED',
        502,
        'OpenClaw could not complete this model turn. Check your local default model and authentication.',
      )
  }
}

function errorResponse(error: unknown): Response {
  let publicError: OpenClawPublicError
  if (isOpenClawPublicError(error)) {
    publicError = error
  } else if (error instanceof OpenClawCliError) {
    publicError = mapCliError(error)
  } else if (error instanceof OpenClawConfigurationError) {
    publicError = new OpenClawPublicError(
      'OPENCLAW_CONFIGURATION_ERROR',
      503,
      'The local OpenClaw bridge configuration is invalid.',
    )
  } else {
    publicError = new OpenClawPublicError(
      'OPENCLAW_REQUEST_FAILED',
      500,
      'Local WebChess could not complete this request.',
    )
  }

  return jsonResponse(
    {
      error: {
        code: publicError.code,
        message: publicError.message,
      },
    },
    publicError.status,
  )
}

function invalidBody(error: z.ZodError): OpenClawPublicError {
  const hasUnknownFields = error.issues.some(
    (issue) => issue.code === 'unrecognized_keys',
  )
  return new OpenClawPublicError(
    'INVALID_REQUEST',
    400,
    hasUnknownFields
      ? 'The local WebChess request contains unsupported fields.'
      : 'The local WebChess request does not match the required format.',
  )
}

export async function handleOpenClawStatusRequest(
  request: Request,
  dependencies: OpenClawHandlerDependencies = {},
): Promise<Response> {
  try {
    assertOpenClawLocalRequest(request, {
      environment: dependencies.environment,
    })
    const config = resolveOpenClawConfig(dependencies.environment)
    const [modelStatus, databaseResult] = await Promise.all([
      getOpenClawStatus(config, {
        execute: dependencies.execute,
        signal: request.signal,
      }),
      (dependencies.ensureServices ?? getOpenClawDatabaseStatus)()
        .then((database) => ({ database, error: null }))
        .catch((error: unknown) => ({ database: null, error })),
    ])
    const database = databaseResult.database ??
      unavailableDatabaseStatus(databaseResult.error)
    const available = modelStatus.available && database.available
    return jsonResponse({
      available,
      database,
      lifecycle: 'webchess-2.0',
      model: {
        checked: 'configuration',
        configurationReady: modelStatus.available,
        ...(modelStatus.message ? { message: modelStatus.message } : {}),
        ...(modelStatus.model
          ? { configuredModel: modelStatus.model }
          : {}),
        ...(modelStatus.reason ? { reason: modelStatus.reason } : {}),
        transport: modelStatus.transport,
        ...(modelStatus.version ? { version: modelStatus.version } : {}),
      },
      search: {
        available: null,
        checked: false,
        reason: 'not-probed',
        requiredForLaunch: false,
      },
    }, available ? 200 : 503)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function handleOpenClawDivideRequest(
  request: Request,
  dependencies: OpenClawHandlerDependencies = {},
): Promise<Response> {
  try {
    assertOpenClawLocalRequest(request, {
      environment: dependencies.environment,
      mutation: true,
    })
    const body = OpenClawDivideBodySchema.safeParse(
      await readBoundedJson(request),
    )
    if (!body.success) throw invalidBody(body.error)

    const result = await generateOpenClawDivision(
      body.data.problem,
      resolveOpenClawConfig(dependencies.environment),
      {
        execute: dependencies.execute,
        seed: dependencies.seed,
        signal: request.signal,
      },
    )
    return jsonResponse(result, 201)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function handleOpenClawAnswerRequest(
  request: Request,
  dependencies: OpenClawHandlerDependencies = {},
): Promise<Response> {
  try {
    assertOpenClawLocalRequest(request, {
      environment: dependencies.environment,
      mutation: true,
    })
    const body = OpenClawAnswerBodySchema.safeParse(
      await readBoundedJson(request),
    )
    if (!body.success) throw invalidBody(body.error)

    const result = await generateOpenClawAnswer(
      body.data,
      resolveOpenClawConfig(dependencies.environment),
      {
        execute: dependencies.execute,
        signal: request.signal,
      },
    )
    return jsonResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
