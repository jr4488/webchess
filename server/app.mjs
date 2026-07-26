import express from 'express'
import OpenAI from 'openai'

import {
  CODEX_CHATGPT_PROVIDER,
  createCodexChatGptClient,
  isLoopbackHost,
  modelProviderInfo,
  OPENAI_API_PROVIDER,
  probeCodexChatGpt,
  resolveCodexWebSearchMode,
  resolveModelProviderName,
} from './codex-provider.mjs'
import {
  divideProblemSemantically,
  DivisionPayloadError,
  parseDivisionPayload,
} from './division.mjs'
import { describeModelFailure, logModelFailure } from './model-failure.mjs'
import {
  createOllamaClient,
  OLLAMA_PROVIDER,
} from './ollama-provider.mjs'
import { runParsedModelResponse } from './model-response.mjs'
import {
  AnswerResultError,
  buildWebChessInput,
  buildWebChessInstructions,
  buildWebChessPrompt,
  GamePayloadError,
  parseGamePayload,
  parseWebChessResponse,
  webChessAnswerTextFormat,
} from './prompt.mjs'
import { streamPublicRationale } from './public-rationale.mjs'
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
export const MAX_UPSTREAM_TIMEOUT_MS = 60 * 60 * 1_000
export const MODEL_ACTIVITY_CONTENT_TYPE = 'application/x-ndjson'
export const MODEL_ACTIVITY_HEARTBEAT_MS = 5_000

const ANSWER_CONTRACT_MESSAGE =
  'The model wrote an answer that did not meet WebChess\u2019s five-section contract ' +
  '(including its 450\u2013750 word range). This is a model-quality result, not a ' +
  'configuration problem. Retrying usually succeeds.'

const ANSWER_UNAVAILABLE_MESSAGE =
  'The model provider could not be reached to write this answer. Check that the ' +
  'provider is running and reachable, then try again.'

// Reasoning arrives as many tiny deltas. Coalescing them into readable chunks
// keeps the NDJSON channel from becoming one frame per token.
const REASONING_FLUSH_MS = 220
const REASONING_FLUSH_CHARS = 320

export function resolveUpstreamTimeoutMs(value) {
  const candidate = value ?? DEFAULT_UPSTREAM_TIMEOUT_MS
  const normalized = typeof candidate === 'string' ? candidate.trim() : candidate
  if (
    (typeof normalized === 'string' && !/^\d+$/u.test(normalized)) ||
    !Number.isInteger(Number(normalized)) ||
    Number(normalized) <= 0 ||
    Number(normalized) > MAX_UPSTREAM_TIMEOUT_MS
  ) {
    throw new TypeError(
      `WEBCHESS_UPSTREAM_TIMEOUT_MS must be an integer from 1 to ${MAX_UPSTREAM_TIMEOUT_MS}.`,
    )
  }
  return Number(normalized)
}

function publicProviderInfo(provider, model, webSearch) {
  return Object.freeze({
    id: provider.id,
    label: provider.label,
    billing: provider.billing,
    localOnly: provider.localOnly,
    dataControlsUrl: provider.dataControlsUrl,
    model,
    webSearch,
  })
}

function sanitizeProviderReason(reason) {
  const normalized = typeof reason === 'string' ? reason.toLowerCase() : ''
  if (/login|logged|sign.?in|auth/u.test(normalized)) {
    return 'The selected model provider needs a local sign-in.'
  }
  if (/timeout|timed out/u.test(normalized)) {
    return 'The selected model provider readiness check timed out.'
  }
  if (/version|unsupported/u.test(normalized)) {
    return 'A supported local model provider is unavailable.'
  }
  if (/executable|binary|command|enoent|not found/u.test(normalized)) {
    return 'The local model provider executable is unavailable.'
  }
  return 'The selected model provider is not ready.'
}

function loopbackOrigin(origin) {
  try {
    return isLoopbackHost(new URL(origin).hostname)
  } catch {
    return false
  }
}

function localProviderRequestAllowed(request, providerName) {
  if (!modelProviderInfo(providerName).localOnly) {
    return true
  }
  return (
    loopbackOrigin(request.get('origin')) &&
    isLoopbackHost(request.hostname)
  )
}

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
  const environment = options.environment ?? process.env
  const providerName = resolveModelProviderName(
    options.provider ?? environment.WEBCHESS_MODEL_PROVIDER,
  )
  const model = options.model ?? environment.OPENAI_MODEL ?? DEFAULT_MODEL
  const apiKey = providerName === OPENAI_API_PROVIDER
    ? options.apiKey ?? environment.OPENAI_API_KEY
    : ''
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
        error: 'The selected model provider is not configured.',
        code: 'provider_unconfigured',
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
      reasoning: options.reasoning ?? { mode: 'pro', effort: 'medium' },
      instructions,
      input: userInput,
      text: {
        format: webChessAnswerTextFormat(),
      },
      max_output_tokens: 12_000,
      store: false,
    }
    const scopedRequestOptions = requestOptions(options)
    if (options.onRationale) {
      try {
        await streamPublicRationale({
          client,
          model,
          operation: 'answer',
          subject: userInput,
          requestOptions: scopedRequestOptions,
          onRationale: options.onRationale,
          onProgress: options.onProgress,
        })
      } catch {
        // Public display notes are optional and must never prevent the
        // authoritative completed-game answer from running.
      }
    }
    const result = await runParsedModelResponse({
      client,
      input,
      requestOptions: scopedRequestOptions,
      onProgress: options.onProgress,
      onReasoning: options.onReasoning,
      reasoningMode: options.reasoningMode,
    })
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
    const failure = describeModelFailure(error, {
      contractError: AnswerResultError,
      contractMessage: ANSWER_CONTRACT_MESSAGE,
      unavailableMessage: ANSWER_UNAVAILABLE_MESSAGE,
    })
    logModelFailure(options.logger, 'answer', failure, error)
    return {
      status: failure.status,
      body: { error: failure.error, code: failure.code, prompt },
    }
  }
}

function createScopedClient(client, signal, timeoutMs) {
  if (!client) {
    return undefined
  }
  const scopedOptions = (options = {}) => ({
    ...options,
    signal,
    timeout: Math.min(
      Number.isInteger(options.timeout) ? options.timeout : timeoutMs,
      timeoutMs,
    ),
    maxRetries: 0,
  })
  const responses = {
    parse(input, options = {}) {
      return client.responses.parse(input, scopedOptions(options))
    },
  }
  if (typeof client.responses?.stream === 'function') {
    responses.stream = (input, options = {}) =>
      client.responses.stream(input, scopedOptions(options))
  }
  if (typeof client.responses?.create === 'function') {
    responses.create = (input, options = {}) =>
      client.responses.create(input, scopedOptions(options))
  }
  return {
    responses,
  }
}

function jsonFailure(response, status, error, extra = {}) {
  response.status(status).json({ error, ...extra })
}

function wantsModelActivityStream(request) {
  return (request.get('accept') ?? '')
    .split(',')
    .some((entry) => entry.trim().toLowerCase().startsWith(MODEL_ACTIVITY_CONTENT_TYPE))
}

function modelActivityPhase(phase) {
  if (phase === 'public-rationale') return 'writing-rationale'
  if (phase === 'connecting') return 'awaiting-model'
  if (phase === 'thinking') return 'thinking'
  if (phase === 'drafting') return 'drafting'
  if (phase === 'validating') return 'validating-output'
  return undefined
}

function createModelActivityStream(response, options = {}) {
  const heartbeatMs = options.heartbeatMs ?? MODEL_ACTIVITY_HEARTBEAT_MS
  const reasoningFlushMs = options.reasoningFlushMs ?? REASONING_FLUSH_MS
  let open = true
  let currentPhase
  let heartbeat
  let reasoningBuffer = ''
  let reasoningSource
  let reasoningFlushAt = 0

  response.status(200)
  response.set({
    'Cache-Control': 'no-store',
    'Content-Type': `${MODEL_ACTIVITY_CONTENT_TYPE}; charset=utf-8`,
    'X-Accel-Buffering': 'no',
  })
  response.flushHeaders?.()

  const write = (event) => {
    if (!open || response.destroyed || response.writableEnded) return false
    return response.write(`${JSON.stringify(event)}\n`)
  }
  const phase = (value) => {
    if (value === currentPhase) return
    currentPhase = value
    write({ type: 'phase', phase: value })
  }
  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = undefined
  }
  const flushReasoning = () => {
    if (!reasoningBuffer || !reasoningSource) return
    write({ type: 'reasoning', source: reasoningSource, text: reasoningBuffer })
    reasoningBuffer = ''
    reasoningFlushAt = Date.now()
  }
  const close = () => {
    if (!open) return
    flushReasoning()
    open = false
    stopHeartbeat()
    response.off('close', close)
  }
  response.once('close', close)

  if (heartbeatMs > 0) {
    heartbeat = setInterval(() => write({ type: 'heartbeat' }), heartbeatMs)
    heartbeat.unref?.()
  }

  return {
    begin() {
      phase('request-accepted')
      phase('preparing-input')
    },
    progress(progress) {
      const nextPhase = modelActivityPhase(progress?.phase)
      if (nextPhase) phase(nextPhase)
      if (progress?.phase === 'thinking' || progress?.phase === 'drafting') {
        write({ type: 'provider_activity' })
      }
    },
    rationale(text) {
      write({ type: 'rationale', text })
    },
    reasoning({ source, delta } = {}) {
      if (!delta) return
      if (source !== reasoningSource) {
        flushReasoning()
        reasoningSource = source
      }
      reasoningBuffer += delta
      const now = Date.now()
      if (
        reasoningBuffer.length >= REASONING_FLUSH_CHARS ||
        now - reasoningFlushAt >= reasoningFlushMs
      ) {
        flushReasoning()
      }
    },
    result(data) {
      flushReasoning()
      phase('complete')
      write({ type: 'result', data })
      close()
      if (!response.writableEnded) response.end()
    },
    error(message, details = {}) {
      flushReasoning()
      write({
        type: 'error',
        message,
        ...(Number.isInteger(details.status) ? { status: details.status } : {}),
        ...(typeof details.code === 'string' ? { code: details.code } : {}),
        ...(typeof details.prompt === 'string' ? { prompt: details.prompt } : {}),
      })
      close()
      if (!response.writableEnded) response.end()
    },
    close,
  }
}

function noStore(response) {
  response.set('Cache-Control', 'no-store')
}

/**
 * Build the reasoning request for one provider.
 *
 * `summary` and `mode` are OpenAI Platform features. Asking a local
 * OpenAI-compatible endpoint for them risks failing the whole request over an
 * unrecognized field, and local models expose their own thinking text anyway.
 * Codex reads only `effort` and pins its own summary setting.
 */
function reasoningRequest(providerName, { pro = false } = {}) {
  if (providerName !== OPENAI_API_PROVIDER) {
    return { effort: 'medium' }
  }
  return {
    ...(pro ? { mode: 'pro' } : {}),
    effort: 'medium',
    summary: 'detailed',
  }
}

/**
 * Decide what reasoning text this provider is allowed to show, and as what.
 *
 * Only the Platform produces summaries written for end users. Ollama runs on
 * the operator's own machine, so its literal thinking stays within the same
 * trust boundary as the request and is shown labelled as raw. Codex pins
 * `model_reasoning_summary="none"` and emits none at all.
 */
function reasoningModeFor(providerName) {
  if (providerName === OPENAI_API_PROVIDER) return 'summary'
  if (providerName === OLLAMA_PROVIDER) return 'raw'
  return 'off'
}

function providerNeutralResult(result) {
  const error = result?.body?.error
  if (typeof error !== 'string' || !/OPENAI_API_KEY|server key|GPT/iu.test(error)) {
    return result
  }

  let message = 'The model provider could not complete this request.'
  if (result.status === 429) {
    message = 'The model provider is busy right now. Wait a moment, then try again.'
  } else if (result.status === 503) {
    message = 'The selected model provider is not configured.'
  }
  return {
    ...result,
    body: {
      ...result.body,
      error: message,
    },
  }
}

export function createWebChessApp(options = {}) {
  const app = express()
  const environment = options.environment ?? process.env
  const providerName = resolveModelProviderName(
    options.provider ?? environment.WEBCHESS_MODEL_PROVIDER,
  )
  const model = options.model ?? environment.OPENAI_MODEL ?? DEFAULT_MODEL
  const webSearchMode = providerName === CODEX_CHATGPT_PROVIDER
    ? resolveCodexWebSearchMode(
      options.webSearchMode ?? environment.WEBCHESS_CODEX_WEB_SEARCH,
    )
    : 'disabled'
  const provider = publicProviderInfo(
    modelProviderInfo(providerName),
    model,
    webSearchMode,
  )
  const timeoutMs = resolveUpstreamTimeoutMs(
    options.timeoutMs ?? environment.WEBCHESS_UPSTREAM_TIMEOUT_MS,
  )
  const host = options.host ?? environment.HOST ?? '127.0.0.1'
  const security = resolveSecurityConfig({
    ...options,
    accessCode: options.accessCode ?? environment.WEBCHESS_ACCESS_CODE ?? '',
    sessionSecret: options.sessionSecret ?? environment.WEBCHESS_SESSION_SECRET ?? '',
    allowedOrigins: options.allowedOrigins ?? environment.WEBCHESS_ALLOWED_ORIGINS ?? [],
    trustProxy: options.trustProxy ?? environment.WEBCHESS_TRUST_PROXY ?? false,
  })
  const apiKey = providerName === OPENAI_API_PROVIDER
    ? options.apiKey ?? environment.OPENAI_API_KEY
    : ''
  let baseClient
  let providerReady = false
  let providerReason = 'The selected model provider is not ready.'

  if (providerName === OPENAI_API_PROVIDER) {
    const makeOpenAIClient =
      options.createOpenAIClient ?? ((clientOptions) => new OpenAI(clientOptions))
    baseClient = options.client ?? (
      apiKey
        ? makeOpenAIClient({ apiKey, maxRetries: 0, timeout: timeoutMs })
        : undefined
    )
    providerReady = typeof baseClient?.responses?.parse === 'function'
    if (!providerReady) {
      providerReason = 'OpenAI API model access is not configured.'
    }
  } else if (providerName === CODEX_CHATGPT_PROVIDER) {
    const nonLoopbackOrigin = security.allowedOrigins.find(
      (origin) => !loopbackOrigin(origin),
    )
    if (!isLoopbackHost(host)) {
      providerReason = 'ChatGPT Codex is available only on a loopback host.'
    } else if (security.trustProxy !== false) {
      providerReason = 'ChatGPT Codex does not allow trusted proxy configuration.'
    } else if (nonLoopbackOrigin) {
      providerReason = 'ChatGPT Codex does not allow non-loopback browser origins.'
    } else if (options.client) {
      baseClient = options.client
      providerReady = typeof baseClient?.responses?.parse === 'function'
      if (!providerReady) {
        providerReason = 'The selected model provider client is invalid.'
      }
    } else {
      try {
        const runProbe = options.probeCodexChatGpt ?? probeCodexChatGpt
        const probe = runProbe({
          environment,
          bwrapPath: options.bwrapPath ?? environment.WEBCHESS_BWRAP_PATH,
          caBundlePath:
            options.caBundlePath ?? environment.WEBCHESS_CA_BUNDLE_PATH,
          codexPath: options.codexPath ?? environment.WEBCHESS_CODEX_PATH,
          codexHome: options.codexHome ?? environment.WEBCHESS_CODEX_HOME,
          codexSha256:
            options.codexSha256 ?? environment.WEBCHESS_CODEX_SHA256,
          hostsPath: options.hostsPath,
          resolverPath: options.resolverPath,
          timeoutMs: options.providerProbeTimeoutMs,
          webSearchMode,
        })
        if (probe?.ok) {
          const makeClient =
            options.createCodexChatGptClient ?? createCodexChatGptClient
          baseClient = makeClient({
            environment,
            bwrapPath: probe.bwrapPath ??
              options.bwrapPath ?? environment.WEBCHESS_BWRAP_PATH,
            caBundlePath: probe.caBundlePath ??
              options.caBundlePath ?? environment.WEBCHESS_CA_BUNDLE_PATH,
            codexPath: probe.codexPath ?? probe.executable ??
              options.codexPath ?? environment.WEBCHESS_CODEX_PATH,
            codexHome: probe.codexHome ??
              options.codexHome ?? environment.WEBCHESS_CODEX_HOME,
            codexSha256: probe.codexSha256 ??
              options.codexSha256 ?? environment.WEBCHESS_CODEX_SHA256,
            hostsPath: probe.hostsPath ?? options.hostsPath,
            resolverPath: probe.resolverPath ?? options.resolverPath,
            timeoutMs,
            webSearchMode,
          })
          providerReady = typeof baseClient?.responses?.parse === 'function'
          if (!providerReady) {
            providerReason = 'The selected model provider client is invalid.'
          }
        } else {
          providerReason = sanitizeProviderReason(probe?.reason)
        }
      } catch (error) {
        providerReason = sanitizeProviderReason(error?.message)
      }
    }
  } else if (providerName === OLLAMA_PROVIDER) {
    const nonLoopbackOrigin = security.allowedOrigins.find(
      (origin) => !loopbackOrigin(origin),
    )
    if (!isLoopbackHost(host)) {
      providerReason = 'Ollama is available only on a loopback host.'
    } else if (security.trustProxy !== false) {
      providerReason = 'Ollama does not allow trusted proxy configuration.'
    } else if (nonLoopbackOrigin) {
      providerReason = 'Ollama does not allow non-loopback browser origins.'
    } else if (options.client) {
      baseClient = options.client
      providerReady = typeof baseClient?.responses?.parse === 'function'
      if (!providerReady) {
        providerReason = 'The selected model provider client is invalid.'
      }
    } else {
      try {
        const makeClient = options.createOllamaClient ?? createOllamaClient
        baseClient = makeClient({
          baseURL:
            options.ollamaBaseURL ?? environment.WEBCHESS_OLLAMA_BASE_URL,
          maxRetries: 0,
          timeout: timeoutMs,
        })
        providerReady = typeof baseClient?.responses?.parse === 'function'
        if (!providerReady) {
          providerReason = 'The selected model provider client is invalid.'
        }
      } catch {
        providerReason = 'The Ollama loopback endpoint is not configured safely.'
      }
    }
  }

  const ready = security.configured && providerReady
  const sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1_000
  const secureCookies = options.secureCookies ?? (
    environment.NODE_ENV === 'production' &&
    !provider.localOnly
  )
  const sessionManager = createSessionManager({
    secret: security.sessionSecret || 'unconfigured-webchess-session-secret',
    providerId: providerName,
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
  const concurrency = new ConcurrencyGate(
    provider.localOnly
      ? 1
      : options.maxConcurrentRequests ?? 4,
  )

  let providerClosed = false
  app.locals.webChessProvider = provider
  app.locals.closeWebChessProvider = () => {
    if (providerClosed) return
    providerClosed = true
    return baseClient?.close?.()
  }
  app.disable('x-powered-by')
  if (security.trustProxy) {
    app.set('trust proxy', security.trustProxy)
  }
  app.use((_request, response, next) => {
    response.set({
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    })
    next()
  })
  app.use(express.json({ limit: '256kb', strict: true }))

  app.get('/api/health', (_request, response) => {
    noStore(response)
    response.json({ ok: true })
  })

  app.get('/api/ready', (_request, response) => {
    noStore(response)
    const reason = !security.configured
      ? 'WebChess access control is not configured.'
      : providerReady
        ? undefined
        : providerReason
    response.status(ready ? 200 : 503).json({
      ok: ready,
      configured: ready,
      model,
      provider,
      ...(security.configured ? {} : { security: 'not-configured' }),
      ...(providerReady ? {} : { upstream: 'not-configured' }),
      ...(reason ? { reason } : {}),
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
      provider,
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
    if (!localProviderRequestAllowed(request, providerName)) {
      jsonFailure(response, 403, 'The local model provider accepts only loopback requests.')
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
      provider,
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
    if (!localProviderRequestAllowed(request, providerName)) {
      jsonFailure(response, 403, 'The local model provider accepts only loopback requests.')
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

  function protectPaidRoute(parsePayload) {
    return function paidRouteProtection(request, response, next) {
      noStore(response)
      if (!ready) {
        jsonFailure(response, 503, 'The selected model provider is not ready.')
        return
      }
      if (!requestOriginAllowed(request, security.allowedOrigins)) {
        jsonFailure(response, 403, 'Request origin is not allowed.')
        return
      }
      if (!localProviderRequestAllowed(request, providerName)) {
        jsonFailure(response, 403, 'The local model provider accepts only loopback requests.')
        return
      }
      const session = sessionManager.fromRequest(request)
      if (!session) {
        jsonFailure(response, 401, 'A valid WebChess session is required.')
        return
      }
      if (!constantTimeStringEqual(request.get(CSRF_HEADER_NAME) ?? '', session.csrf)) {
        jsonFailure(response, 403, 'The request security token is invalid.', {
          code: 'csrf',
        })
        return
      }

      try {
        parsePayload(request.body)
      } catch (error) {
        // Answer the field-specific 400 here instead of forwarding an ungated
        // request. Without a security context the route would fall back to the
        // unscoped client, reaching the provider with no rate limit, quota,
        // concurrency slot, or abort signal.
        jsonFailure(
          response,
          400,
          error instanceof DivisionPayloadError || error instanceof GamePayloadError
            ? error.message
            : 'Request body could not be read.',
        )
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
        jsonFailure(response, 503, 'The model service is busy. Try again shortly.')
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
  }

  app.post('/api/answer', protectPaidRoute(parseGamePayload), async (request, response) => {
    const context = request.webChessSecurity?.context
    const activity = context && wantsModelActivityStream(request)
      ? createModelActivityStream(response, {
          heartbeatMs: options.modelActivityHeartbeatMs,
        })
      : undefined
    try {
      activity?.begin()
      const scopedClient = context
        ? createScopedClient(baseClient, context.controller.signal, timeoutMs)
        : baseClient
      const result = providerNeutralResult(await answerCompletedGame(request.body, {
        ...options,
        environment,
        model,
        apiKey,
        client: scopedClient,
        signal: context?.controller.signal,
        timeoutMs,
        reasoning: reasoningRequest(providerName, { pro: true }),
        reasoningMode: reasoningModeFor(providerName),
        onProgress: activity?.progress,
        onReasoning: activity?.reasoning,
        onRationale: providerName === OLLAMA_PROVIDER
          ? activity?.rationale
          : undefined,
      }))
      if (activity) {
        if (result.status === 200) {
          activity.result(result.body)
        } else {
          activity.error(
            context?.timedOut
              ? 'The model took too long to respond. Please try again.'
              : result.body.error,
            {
              status: context?.timedOut ? 504 : result.status,
              code: context?.timedOut ? 'timeout' : undefined,
              prompt: result.body.prompt,
            },
          )
        }
      } else if (!response.headersSent && !response.writableEnded) {
        response.status(result.status).json(result.body)
      }
    } finally {
      activity?.close()
      context?.clean()
    }
  })

  app.post('/api/divide', protectPaidRoute(parseDivisionPayload), async (request, response) => {
    const context = request.webChessSecurity?.context
    const activity = context && wantsModelActivityStream(request)
      ? createModelActivityStream(response, {
          heartbeatMs: options.modelActivityHeartbeatMs,
        })
      : undefined
    try {
      activity?.begin()
      const scopedClient = context
        ? createScopedClient(baseClient, context.controller.signal, timeoutMs)
        : baseClient
      const result = providerNeutralResult(await divideProblemSemantically(request.body, {
        ...options,
        model,
        apiKey,
        client: scopedClient,
        reasoning: reasoningRequest(providerName),
        reasoningMode: reasoningModeFor(providerName),
        onProgress: activity?.progress,
        onReasoning: activity?.reasoning,
        onRationale: providerName === OLLAMA_PROVIDER
          ? activity?.rationale
          : undefined,
      }))
      if (activity) {
        if (result.status === 200) {
          activity.result(result.body)
        } else {
          activity.error(
            context?.timedOut
              ? 'The model took too long to respond. Please try again.'
              : result.body.error,
            {
              status: context?.timedOut ? 504 : result.status,
              code: context?.timedOut ? 'timeout' : undefined,
              prompt: result.body.prompt,
            },
          )
        }
      } else if (!response.headersSent && !response.writableEnded) {
        response.status(result.status).json(result.body)
      }
    } finally {
      activity?.close()
      context?.clean()
    }
  })

  app.use((error, request, response, next) => {
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
    if (
      error?.type === 'charset.unsupported' ||
      error?.type === 'encoding.unsupported' ||
      error?.status === 415
    ) {
      response.status(415).json({
        error: 'Request body encoding is not supported.',
      })
      return
    }
    if (
      request.get('content-encoding') &&
      request.get('content-encoding').toLowerCase() !== 'identity'
    ) {
      response.status(400).json({
        error: 'Compressed request body could not be read.',
      })
      return
    }
    if (
      Number.isInteger(error?.status) &&
      error.status >= 400 &&
      error.status < 500
    ) {
      response.status(error.status).json({
        error: 'Request body could not be read.',
      })
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
