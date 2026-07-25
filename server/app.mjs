import express from 'express'
import OpenAI from 'openai'

import { divideProblemSemantically, parseDivisionPayload } from './division.mjs'
import {
  buildWebChessInput,
  buildWebChessInstructions,
  buildWebChessPrompt,
  GamePayloadError,
  parseGamePayload,
  parseWebChessResponse,
  webChessAnswerTextFormat,
} from './prompt.mjs'
import {
  clearedSessionCookie,
  clientAddress,
  ConcurrencyGate,
  constantTimeStringEqual,
  createSessionManager,
  CSRF_HEADER_NAME,
  FixedWindowRateLimiter,
  requestOriginAllowed,
  resolveSecurityConfig,
  sessionCookie,
} from './security.mjs'

export const DEFAULT_MODEL = 'gpt-5.6-sol'
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 120_000

function requestOptions(options) {
  if (!options.signal) {
    return undefined
  }
  return {
    signal: options.signal,
    timeout: options.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
    maxRetries: 0,
  }
}

export async function answerCompletedGame(value, options = {}) {
  const model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
  const suppliedClient = options.client

  let game
  try {
    game = parseGamePayload(value)
  } catch (error) {
    if (error instanceof GamePayloadError) {
      return { status: 400, body: { error: error.message } }
    }
    throw error
  }

  const prompt = buildWebChessPrompt(game)
  const instructions = buildWebChessInstructions()
  const userInput = buildWebChessInput(game)
  if (!suppliedClient && !apiKey) {
    return {
      status: 503,
      body: {
        error: 'Set OPENAI_API_KEY on the WebChess server, then try the answer again.',
        prompt,
      },
    }
  }

  try {
    const client = suppliedClient ?? new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: options.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
    })
    const input = {
      model,
      reasoning: { mode: 'pro', effort: 'medium' },
      instructions,
      input: userInput,
      text: {
        format: webChessAnswerTextFormat(),
      },
      max_output_tokens: 12_000,
      store: false,
    }
    const scopedRequestOptions = requestOptions(options)
    const result = scopedRequestOptions
      ? await client.responses.parse(input, scopedRequestOptions)
      : await client.responses.parse(input)
    const parsed = parseWebChessResponse(result)

    return {
      status: 200,
      body: {
        answer: parsed.answer,
        sections: parsed.sections,
        wordCount: parsed.wordCount,
        model: result.model ?? model,
        prompt,
      },
    }
  } catch (error) {
    const status = error && typeof error === 'object' && error.status === 429 ? 429 : 502
    return {
      status,
      body: {
        error: status === 429
          ? 'The GPT service is busy right now. Wait a moment, then try the answer again.'
          : 'GPT could not complete this answer. Check the server key and model access, then try again.',
        prompt,
      },
    }
  }
}

function createScopedClient(client, signal, timeoutMs) {
  if (!client) {
    return undefined
  }
  const scopedOptions = { signal, timeout: timeoutMs, maxRetries: 0 }
  return {
    responses: {
      create(input, options = {}) {
        return client.responses.create(input, { ...options, ...scopedOptions })
      },
      parse(input, options = {}) {
        return client.responses.parse(input, { ...options, ...scopedOptions })
      },
    },
  }
}

function jsonFailure(response, status, error, extra = {}) {
  response.status(status).json({ error, ...extra })
}

function noStore(response) {
  response.set('Cache-Control', 'no-store')
}

export function createWebChessApp(options = {}) {
  const app = express()
  const model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS
  const security = resolveSecurityConfig(options)
  const upstreamConfigured = Boolean(options.client || apiKey)
  const ready = security.configured && upstreamConfigured
  const sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1_000
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production'
  const sessionManager = createSessionManager({
    secret: security.sessionSecret || 'unconfigured-webchess-session-secret',
    ttlMs: sessionTtlMs,
    now: options.now,
    randomBytes: options.randomBytes,
  })
  const loginLimiter = new FixedWindowRateLimiter({
    limit: options.loginRateLimit?.limit ?? 5,
    windowMs: options.loginRateLimit?.windowMs ?? 15 * 60 * 1_000,
    maxEntries: options.loginRateLimit?.maxEntries ?? 10_000,
    now: options.now,
  })
  const apiLimiter = new FixedWindowRateLimiter({
    limit: options.apiRateLimit?.limit ?? 20,
    windowMs: options.apiRateLimit?.windowMs ?? 60 * 60 * 1_000,
    maxEntries: options.apiRateLimit?.maxEntries ?? 10_000,
    now: options.now,
  })
  const globalQuota = new FixedWindowRateLimiter({
    limit: options.globalQuota?.limit ?? 100,
    windowMs: options.globalQuota?.windowMs ?? 24 * 60 * 60 * 1_000,
    maxEntries: 1,
    now: options.now,
  })
  const concurrency = new ConcurrencyGate(options.maxConcurrentRequests ?? 4)
  const baseClient = options.client ?? (
    apiKey
      ? new OpenAI({ apiKey, maxRetries: 0, timeout: timeoutMs })
      : undefined
  )

  app.disable('x-powered-by')
  app.use(express.json({ limit: '256kb', strict: true }))

  app.get('/api/health', (_request, response) => {
    noStore(response)
    response.json({ ok: true })
  })

  app.get('/api/ready', (_request, response) => {
    noStore(response)
    response.status(ready ? 200 : 503).json({
      ok: ready,
      configured: ready,
      model,
      ...(security.configured ? {} : { security: 'not-configured' }),
      ...(upstreamConfigured ? {} : { upstream: 'not-configured' }),
    })
  })

  app.get('/api/session', (request, response) => {
    noStore(response)
    if (!security.configured) {
      response.json({ authenticated: false })
      return
    }
    const session = sessionManager.fromRequest(request)
    if (!session) {
      response.json({ authenticated: false })
      return
    }
    response.json({
      authenticated: true,
      csrfToken: session.csrf,
      expiresAt: new Date(session.exp).toISOString(),
    })
  })

  app.post('/api/session', (request, response) => {
    noStore(response)
    if (!security.configured) {
      jsonFailure(response, 503, 'WebChess access is not configured.')
      return
    }
    if (!requestOriginAllowed(request, security.allowedOrigins)) {
      jsonFailure(response, 403, 'Request origin is not allowed.')
      return
    }

    const rate = loginLimiter.consume(clientAddress(request))
    if (!rate.allowed) {
      response.set('Retry-After', String(rate.retryAfter))
      jsonFailure(response, 429, 'Too many access attempts. Try again later.', {
        retryAfter: rate.retryAfter,
      })
      return
    }

    const candidate = request.body && typeof request.body === 'object'
      ? request.body.accessCode
      : ''
    if (
      typeof candidate !== 'string' ||
      !constantTimeStringEqual(candidate.trim(), security.accessCode)
    ) {
      jsonFailure(response, 401, 'The access code is invalid.')
      return
    }

    const { token, session } = sessionManager.issue()
    response.set('Set-Cookie', sessionCookie(token, {
      maxAgeSeconds: sessionTtlMs / 1_000,
      secure: secureCookies,
    }))
    response.json({
      authenticated: true,
      csrfToken: session.csrf,
      expiresAt: new Date(session.exp).toISOString(),
    })
  })

  app.delete('/api/session', (request, response) => {
    noStore(response)
    if (!security.configured) {
      jsonFailure(response, 503, 'WebChess access is not configured.')
      return
    }
    if (!requestOriginAllowed(request, security.allowedOrigins)) {
      jsonFailure(response, 403, 'Request origin is not allowed.')
      return
    }
    const session = sessionManager.fromRequest(request)
    if (!session) {
      jsonFailure(response, 401, 'A valid WebChess session is required.')
      return
    }
    if (!constantTimeStringEqual(request.get(CSRF_HEADER_NAME) ?? '', session.csrf)) {
      jsonFailure(response, 403, 'The request security token is invalid.')
      return
    }
    sessionManager.revoke(session)
    response.set('Set-Cookie', clearedSessionCookie({ secure: secureCookies }))
    response.json({ authenticated: false })
  })

  function protectPaidRoute(request, response, next) {
    noStore(response)
    if (!ready) {
      jsonFailure(response, 503, 'The WebChess answer service is not configured.')
      return
    }
    if (!requestOriginAllowed(request, security.allowedOrigins)) {
      jsonFailure(response, 403, 'Request origin is not allowed.')
      return
    }
    const session = sessionManager.fromRequest(request)
    if (!session) {
      jsonFailure(response, 401, 'A valid WebChess session is required.')
      return
    }
    if (!constantTimeStringEqual(request.get(CSRF_HEADER_NAME) ?? '', session.csrf)) {
      jsonFailure(response, 403, 'The request security token is invalid.')
      return
    }

    try {
      if (request.originalUrl.split('?', 1)[0] === '/api/divide') {
        parseDivisionPayload(request.body)
      } else {
        parseGamePayload(request.body)
      }
    } catch {
      // Let the service return its field-specific 400 without spending rate,
      // quota, or concurrency capacity on a request that cannot reach OpenAI.
      next()
      return
    }

    const rate = apiLimiter.consume(session.sid)
    if (!rate.allowed) {
      response.set('Retry-After', String(rate.retryAfter))
      jsonFailure(response, 429, 'This session has reached its request limit.', {
        retryAfter: rate.retryAfter,
      })
      return
    }
    const release = concurrency.tryAcquire()
    if (!release) {
      jsonFailure(response, 503, 'The WebChess answer service is busy. Try again shortly.')
      return
    }
    const quota = globalQuota.consume('all-model-requests')
    if (!quota.allowed) {
      release()
      response.set('Retry-After', String(quota.retryAfter))
      jsonFailure(response, 429, 'The WebChess model budget is exhausted for now.', {
        retryAfter: quota.retryAfter,
      })
      return
    }

    const controller = new AbortController()
    const context = {
      controller,
      release,
      timedOut: false,
      clean: null,
    }
    const abortForDisconnect = () => {
      if (!response.writableEnded) {
        controller.abort(new Error('The client disconnected.'))
      }
    }
    const timer = setTimeout(() => {
      context.timedOut = true
      controller.abort(new Error('The upstream request timed out.'))
      if (!response.headersSent && !response.writableEnded) {
        jsonFailure(response, 504, 'The model took too long to respond. Please try again.')
      }
    }, timeoutMs)
    request.once('aborted', abortForDisconnect)
    response.once('close', abortForDisconnect)
    let cleaned = false
    context.clean = () => {
      if (cleaned) {
        return
      }
      cleaned = true
      clearTimeout(timer)
      request.off('aborted', abortForDisconnect)
      response.off('close', abortForDisconnect)
      release()
    }
    request.webChessSecurity = { context, session }
    next()
  }

  app.use(['/api/answer', '/api/divide'], protectPaidRoute)

  app.post('/api/answer', async (request, response) => {
    const context = request.webChessSecurity?.context
    try {
      const scopedClient = context
        ? createScopedClient(baseClient, context.controller.signal, timeoutMs)
        : baseClient
      const result = await answerCompletedGame(request.body, {
        ...options,
        client: scopedClient,
        signal: context?.controller.signal,
        timeoutMs,
      })
      if (!response.headersSent && !response.writableEnded) {
        response.status(result.status).json(result.body)
      }
    } finally {
      context?.clean()
    }
  })

  app.post('/api/divide', async (request, response) => {
    const context = request.webChessSecurity?.context
    try {
      const scopedClient = context
        ? createScopedClient(baseClient, context.controller.signal, timeoutMs)
        : baseClient
      const result = await divideProblemSemantically(request.body, {
        ...options,
        client: scopedClient,
      })
      if (!response.headersSent && !response.writableEnded) {
        response.status(result.status).json(result.body)
      }
    } finally {
      context?.clean()
    }
  })

  app.use((error, _request, response, next) => {
    if (error?.type === 'entity.too.large' || error?.status === 413) {
      response.status(413).json({
        error: 'Request body is too large. The maximum size is 256 KB.',
      })
      return
    }
    if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json({ error: 'Request body must be valid JSON.' })
      return
    }
    if (response.headersSent) {
      next(error)
      return
    }
    options.logger?.error?.(error)
    response.status(500).json({ error: 'The server could not complete this request.' })
  })

  return app
}
