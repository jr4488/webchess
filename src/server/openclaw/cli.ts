import { createHash } from 'node:crypto'
import {
  request as requestHttp,
  type ClientRequest,
  type IncomingMessage,
} from 'node:http'

import { z } from 'zod'

import {
  MODEL_REQUEST_ENVELOPE_TIMEOUT_MS,
  MODEL_REQUEST_RESPONSE_GRACE_MS,
} from '@/server/model-operation-timeouts'

import {
  MAX_OPENCLAW_SEARCH_TIMEOUT_MS,
  type OpenClawConfig,
} from './config'

const MAX_MODEL_TURN_ID_CHARS = 255
const MODEL_TURN_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u
const OPENCLAW_BRIDGE_PATHS = new Set([
  '/v1/model/run',
  '/v1/status',
  '/v1/web/search',
] as const)
const OPENCLAW_BRIDGE_UNAVAILABLE_MESSAGE =
  'The authenticated OpenClaw plugin bridge was unavailable.'

type OpenClawBridgePath =
  | '/v1/model/run'
  | '/v1/status'
  | '/v1/web/search'

export type OpenClawCliFailureKind =
  | 'aborted'
  | 'failed'
  | 'invalid-output'
  | 'not-found'
  | 'timeout'

export class OpenClawCliError extends Error {
  readonly kind: OpenClawCliFailureKind

  constructor(kind: OpenClawCliFailureKind, message: string) {
    super(message)
    this.name = 'OpenClawCliError'
    this.kind = kind
  }
}

export interface OpenClawCommandOptions {
  /** Stable logical turn identity for transports that support replay safety. */
  idempotencyKey?: string
  /** Total loopback connect/header/body deadline; provider work remains body-bounded. */
  requestTimeoutMs?: number
  signal?: AbortSignal
}

export type OpenClawBridgeRequester = (
  path: OpenClawBridgePath,
  body: Record<string, unknown> | null,
  config: OpenClawConfig,
  options?: OpenClawCommandOptions,
) => Promise<string>

function requireModelTurnId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (
    value.length < 1 ||
    value.length > MAX_MODEL_TURN_ID_CHARS ||
    !MODEL_TURN_ID_PATTERN.test(value)
  ) {
    throw new RangeError(
      `idempotencyKey must contain 1 through ${MAX_MODEL_TURN_ID_CHARS} bounded identifier characters.`,
    )
  }
  return value
}

function bridgeConfig(config: OpenClawConfig): {
  port: number
  token: string
} {
  if (!config.bridgeToken || !config.bridgeUrl) {
    throw new OpenClawCliError(
      'not-found',
      'The authenticated OpenClaw plugin bridge is not configured.',
    )
  }
  if (
    typeof config.bridgeToken !== 'string' ||
    typeof config.bridgeUrl !== 'string'
  ) {
    throw new OpenClawCliError('failed', OPENCLAW_BRIDGE_UNAVAILABLE_MESSAGE)
  }
  const token = config.bridgeToken
  const rawUrl = config.bridgeUrl
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new OpenClawCliError('failed', OPENCLAW_BRIDGE_UNAVAILABLE_MESSAGE)
  }
  const port = Number(url.port)
  if (
    Buffer.byteLength(token, 'utf8') < 32 ||
    Buffer.byteLength(token, 'utf8') > 512 ||
    /[\p{C}\s]/gu.test(token) ||
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.origin !== rawUrl ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new OpenClawCliError('failed', OPENCLAW_BRIDGE_UNAVAILABLE_MESSAGE)
  }
  return { port, token }
}

function requireRequestTimeoutMs(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_OPENCLAW_SEARCH_TIMEOUT_MS + MODEL_REQUEST_RESPONSE_GRACE_MS
  ) {
    throw new RangeError(
      `requestTimeoutMs must be an integer from 1 through ${MAX_OPENCLAW_SEARCH_TIMEOUT_MS + MODEL_REQUEST_RESPONSE_GRACE_MS}.`,
    )
  }
  return value
}

function bridgeFailureKind(status: number, code: unknown): OpenClawCliFailureKind {
  if (status === 408 || code === 'OPENCLAW_ABORTED') return 'aborted'
  if (status === 504 || code === 'OPENCLAW_TIMEOUT') return 'timeout'
  if (status === 404) return 'not-found'
  if (code === 'INVALID_MODEL_RESULT' || code === 'RESPONSE_TOO_LARGE') {
    return 'invalid-output'
  }
  return 'failed'
}

async function readBoundedResponse(
  response: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of response) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.byteLength
    if (total > maxBytes) {
      throw new OpenClawCliError(
        'invalid-output',
        'The OpenClaw bridge response exceeded its byte limit.',
      )
    }
    chunks.push(bytes)
  }
  if (!response.complete) {
    throw new OpenClawCliError('failed', OPENCLAW_BRIDGE_UNAVAILABLE_MESSAGE)
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

function isOpenClawBridgePath(value: string): value is OpenClawBridgePath {
  return OPENCLAW_BRIDGE_PATHS.has(value as OpenClawBridgePath)
}

function sanitizedTransportError(): OpenClawCliError {
  return new OpenClawCliError('failed', OPENCLAW_BRIDGE_UNAVAILABLE_MESSAGE)
}

function requestLoopbackBridge(
  bridge: ReturnType<typeof bridgeConfig>,
  requestPath: OpenClawBridgePath,
  requestBody: Buffer | null,
  requestTimeoutMs: number,
  maxOutputBytes: number,
  externalSignal?: AbortSignal,
): Promise<{ output: string; status: number }> {
  return new Promise((resolve, reject) => {
    let request: ClientRequest | null = null
    let response: IncomingMessage | null = null
    let settled = false
    let transportDestroyed = false

    const destroyTransport = () => {
      if (transportDestroyed) return
      transportDestroyed = true
      if (response && !response.destroyed) response.destroy()
      if (request && !request.destroyed) request.destroy()
    }
    const cleanup = () => {
      clearTimeout(deadline)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
    const fail = (error: OpenClawCliError) => {
      if (settled) return
      settled = true
      cleanup()
      destroyTransport()
      reject(error)
    }
    const succeed = (value: { output: string; status: number }) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const onExternalAbort = () => {
      fail(new OpenClawCliError(
        'aborted',
        'The local OpenClaw request was cancelled.',
      ))
    }
    const deadline = setTimeout(() => {
      fail(new OpenClawCliError(
        'timeout',
        'OpenClaw did not finish within the local request timeout.',
      ))
    }, requestTimeoutMs)

    if (externalSignal?.aborted) {
      onExternalAbort()
      return
    }
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
    if (externalSignal?.aborted) {
      onExternalAbort()
      return
    }

    try {
      request = requestHttp({
        agent: false,
        family: 4,
        headers: {
          Authorization: `Bearer ${bridge.token}`,
          Connection: 'close',
          ...(requestBody === null
            ? {}
            : {
                'Content-Length': requestBody.byteLength,
                'Content-Type': 'application/json',
              }),
        },
        hostname: '127.0.0.1',
        method: requestBody === null ? 'GET' : 'POST',
        path: requestPath,
        port: bridge.port,
        protocol: 'http:',
        timeout: 0,
      }, (incoming) => {
        response = incoming
        void readBoundedResponse(incoming, maxOutputBytes)
          .then((output) => {
            const status = incoming.statusCode
            if (status === undefined) {
              fail(sanitizedTransportError())
              return
            }
            succeed({ output, status })
          })
          .catch((error: unknown) => {
            fail(error instanceof OpenClawCliError
              ? error
              : sanitizedTransportError())
          })
      })
      request.once('error', () => fail(sanitizedTransportError()))
      request.end(requestBody ?? undefined)
    } catch {
      fail(sanitizedTransportError())
    }
  })
}

export function createOpenClawBridgeRequester(): OpenClawBridgeRequester {
  return async (requestPath, body, config, options = {}) => {
    const bridge = bridgeConfig(config)
    if (!isOpenClawBridgePath(requestPath)) {
      throw sanitizedTransportError()
    }
    const modelTurnId = requireModelTurnId(options.idempotencyKey)
    if (modelTurnId !== undefined && requestPath !== '/v1/model/run') {
      throw new RangeError(
        'idempotencyKey is supported only for OpenClaw model turns.',
      )
    }
    let requestBody: Buffer | null
    try {
      requestBody = body === null
        ? null
        : Buffer.from(JSON.stringify({
            ...body,
            ...(modelTurnId === undefined ? {} : { turnId: modelTurnId }),
          }), 'utf8')
    } catch {
      throw sanitizedTransportError()
    }
    const requestTimeoutMs = requireRequestTimeoutMs(
      options.requestTimeoutMs ?? config.timeoutMs,
    )
    const { output, status } = await requestLoopbackBridge(
      bridge,
      requestPath,
      requestBody,
      requestTimeoutMs,
      config.maxOutputBytes,
      options.signal,
    )
    if (status < 200 || status >= 300) {
      let code: unknown
      try {
        const parsed = JSON.parse(output) as {
          error?: { code?: unknown }
        }
        code = parsed.error?.code
      } catch {
        // Only the status is needed to produce a sanitized failure.
      }
      throw new OpenClawCliError(
        bridgeFailureKind(status, code),
        'The OpenClaw plugin bridge rejected the request.',
      )
    }
    return output
  }
}

export const requestOpenClawBridge = createOpenClawBridgeRequester()

const ModelOutputSchema = z.object({
  text: z.string(),
})

const ModelRunEnvelopeSchema = z.object({
  ok: z.literal(true),
  capability: z.literal('model.run'),
  transport: z.literal('local'),
  provider: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  inputBytes: z.number().int().nonnegative(),
  inputSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  outputs: z.array(ModelOutputSchema).min(1).max(16),
})

interface ModelRunResult {
  model: string
  outputText: string
  provider: string
  transport: 'local'
}

const DEFAULT_OPENCLAW_WEB_SEARCH_LIMIT = 5
const MAX_OPENCLAW_WEB_SEARCH_LIMIT = 10
const MAX_OPENCLAW_WEB_SEARCH_QUERY_CHARS = 500
const DEFAULT_OPENCLAW_WEB_SEARCH_CONTENT_CHARS = 32 * 1024
const MAX_OPENCLAW_WEB_SEARCH_CONTENT_CHARS = 128 * 1024
const DEFAULT_OPENCLAW_WEB_SEARCH_ACTIVITIES = 24
const MAX_OPENCLAW_WEB_SEARCH_ACTIVITIES = 64
const DEFAULT_OPENCLAW_WEB_SEARCH_TOOK_MS = MAX_OPENCLAW_SEARCH_TIMEOUT_MS
const DEFAULT_OPENCLAW_WEB_SEARCH_OUTPUT_BYTES = 4 * 1024 * 1024
const OpenClawWebSearchActivitySchema = z.strictObject({
  query: z.string().min(1).max(MAX_OPENCLAW_WEB_SEARCH_QUERY_CHARS).optional(),
  queries: z.array(
    z.string().min(1).max(MAX_OPENCLAW_WEB_SEARCH_QUERY_CHARS),
  ).min(1).max(16).optional(),
  action: z.string().min(1).max(100).optional(),
  url: z.string().min(1).max(2_048).refine((value) => {
    try {
      const parsed = new URL(value)
      return (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        parsed.username === '' &&
        parsed.password === ''
      )
    } catch {
      return false
    }
  }).optional(),
  pattern: z.string().min(1).max(1_000).optional(),
}).refine(
  (activity) => Object.values(activity).some((value) => value !== undefined),
)

export type OpenClawWebSearchActivity = z.infer<
  typeof OpenClawWebSearchActivitySchema
>

export interface OpenClawWebSearchResult {
  content: string
  externalContent: {
    provider: 'codex'
    source: 'web_search'
    untrusted: true
    wrapped: true
  }
  model: string
  provider: 'codex'
  query: string
  searches: OpenClawWebSearchActivity[]
  tookMs: number
  transport: 'local'
}

export interface OpenClawWebSearchParseOptions {
  maxContentChars?: number
  maxOutputBytes?: number
  maxSearchActivities?: number
  maxTookMs?: number
}

export interface OpenClawWebSearchOptions {
  request?: OpenClawBridgeRequester
  limit?: number
  maxContentChars?: number
  maxSearchActivities?: number
  signal?: AbortSignal
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new OpenClawCliError(
      'invalid-output',
      'OpenClaw returned an invalid JSON envelope.',
    )
  }
}

function invalidWebSearchEnvelope(): OpenClawCliError {
  return new OpenClawCliError(
    'invalid-output',
    'OpenClaw returned an unexpected Codex web search envelope.',
  )
}

function positiveIntegerBound(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new RangeError(`${label} must be an integer from 1 through ${maximum}.`)
  }
  return resolved
}

function requireWebSearchQuery(value: string): string {
  if (
    value.trim() !== value ||
    value.length === 0 ||
    value.length > MAX_OPENCLAW_WEB_SEARCH_QUERY_CHARS ||
    /[\p{C}\r\n]/gu.test(value)
  ) {
    throw new RangeError(
      `The web search query must contain 1–${MAX_OPENCLAW_WEB_SEARCH_QUERY_CHARS} visible characters on one line.`,
    )
  }
  return value
}

function hasValidExternalContentBoundary(content: string): boolean {
  const boundary = /^<<<EXTERNAL_UNTRUSTED_CONTENT id="([a-f0-9]{16})">>>\nSource: Web Search\n---\n([\s\S]+)\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id="([a-f0-9]{16})">>>$/u.exec(
    content,
  )
  return Boolean(
    boundary &&
    boundary[1] === boundary[3] &&
    boundary[2]?.trim(),
  )
}

function canonicalSearchContent(content: string): string {
  // OpenClaw wraps the model's text verbatim. A grounded answer may begin or
  // end with harmless ASCII framing whitespace before OpenClaw adds its
  // external-content marker, so normalize only that whitespace while keeping
  // every byte inside the untrusted boundary intact.
  return content.replace(/^[ \t\r\n]+|[ \t\r\n]+$/gu, '')
}

export function parseOpenClawWebSearchEnvelope(
  stdout: string,
  expectedQueryValue: string,
  options: OpenClawWebSearchParseOptions = {},
): OpenClawWebSearchResult {
  const expectedQuery = requireWebSearchQuery(expectedQueryValue)
  const maxContentChars = positiveIntegerBound(
    options.maxContentChars,
    DEFAULT_OPENCLAW_WEB_SEARCH_CONTENT_CHARS,
    MAX_OPENCLAW_WEB_SEARCH_CONTENT_CHARS,
    'maxContentChars',
  )
  const maxOutputBytes = positiveIntegerBound(
    options.maxOutputBytes,
    DEFAULT_OPENCLAW_WEB_SEARCH_OUTPUT_BYTES,
    DEFAULT_OPENCLAW_WEB_SEARCH_OUTPUT_BYTES,
    'maxOutputBytes',
  )
  const maxSearchActivities = positiveIntegerBound(
    options.maxSearchActivities,
    DEFAULT_OPENCLAW_WEB_SEARCH_ACTIVITIES,
    MAX_OPENCLAW_WEB_SEARCH_ACTIVITIES,
    'maxSearchActivities',
  )
  const maxTookMs = positiveIntegerBound(
    options.maxTookMs,
    DEFAULT_OPENCLAW_WEB_SEARCH_TOOK_MS,
    DEFAULT_OPENCLAW_WEB_SEARCH_TOOK_MS,
    'maxTookMs',
  )

  if (Buffer.byteLength(stdout, 'utf8') > maxOutputBytes) {
    throw invalidWebSearchEnvelope()
  }

  const schema = z.strictObject({
    ok: z.literal(true),
    capability: z.literal('web.search'),
    transport: z.literal('local'),
    provider: z.literal('codex'),
    inputBytes: z.number().int().nonnegative(),
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    attempts: z.array(z.unknown()).length(0),
    outputs: z.array(z.strictObject({
      result: z.strictObject({
        query: z.string().min(1).max(MAX_OPENCLAW_WEB_SEARCH_QUERY_CHARS),
        provider: z.literal('codex'),
        model: z.string().min(1).max(200),
        tookMs: z.number().int().nonnegative().max(maxTookMs),
        externalContent: z.strictObject({
          untrusted: z.literal(true),
          source: z.literal('web_search'),
          provider: z.literal('codex'),
          wrapped: z.literal(true),
        }),
        content: z.string().min(1).max(maxContentChars),
        searches: z.array(OpenClawWebSearchActivitySchema)
          .min(1)
          .max(maxSearchActivities),
      }),
    })).length(1),
  })
  const parsed = schema.safeParse(parseJson(stdout))
  if (!parsed.success) throw invalidWebSearchEnvelope()
  const result = parsed.data.outputs[0]?.result
  const content = result ? canonicalSearchContent(result.content) : ''
  if (
    !result ||
    result.query !== expectedQuery ||
    parsed.data.inputBytes !== Buffer.byteLength(expectedQuery, 'utf8') ||
    parsed.data.inputSha256 !== createHash('sha256')
      .update(expectedQuery, 'utf8')
      .digest('hex') ||
    !hasValidExternalContentBoundary(content)
  ) {
    throw invalidWebSearchEnvelope()
  }

  return {
    content,
    externalContent: result.externalContent,
    model: result.model,
    provider: result.provider,
    query: result.query,
    searches: result.searches,
    tookMs: result.tookMs,
    transport: parsed.data.transport,
  }
}

function cleanDisplayValue(value: string): string | null {
  const cleaned = value.replace(/\s+/gu, ' ').trim()
  if (
    cleaned.length === 0 ||
    cleaned.length > 200 ||
    /[\p{C}]/gu.test(cleaned)
  ) {
    return null
  }
  return cleaned
}

export function modelAttribution(
  providerValue: string,
  modelValue: string,
): string {
  const provider = cleanDisplayValue(providerValue)
  const model = cleanDisplayValue(modelValue)
  if (!model) return 'selected OpenAI account model'
  if (!provider || model.toLowerCase().startsWith(`${provider.toLowerCase()}/`)) {
    return model
  }
  return `${provider}/${model}`
}

export function parseModelRunEnvelope(
  stdout: string,
  expectedInput?: string,
): ModelRunResult {
  const parsed = ModelRunEnvelopeSchema.safeParse(parseJson(stdout))
  if (!parsed.success) {
    throw new OpenClawCliError(
      'invalid-output',
      'OpenClaw returned an unexpected model response envelope.',
    )
  }
  if (
    expectedInput !== undefined &&
    (
      parsed.data.inputBytes !== Buffer.byteLength(expectedInput, 'utf8') ||
      parsed.data.inputSha256 !== createHash('sha256')
        .update(expectedInput, 'utf8')
        .digest('hex')
    )
  ) {
    throw new OpenClawCliError(
      'invalid-output',
      'OpenClaw did not confirm exact prompt transport.',
    )
  }

  const outputText = parsed.data.outputs
    .map((output) => output.text.trim())
    .filter(Boolean)
    .join('\n')
  if (!outputText) {
    throw new OpenClawCliError(
      'invalid-output',
      'OpenClaw returned no model output.',
    )
  }

  return {
    model: parsed.data.model,
    outputText,
    provider: parsed.data.provider,
    transport: parsed.data.transport,
  }
}

export async function runOpenClawModel(
  prompt: string,
  config: OpenClawConfig,
  options: {
    request?: OpenClawBridgeRequester
    idempotencyKey?: string
    /** Runs only after all local request checks and immediately before dispatch. */
    onRequestStart?: () => Promise<void>
    signal?: AbortSignal
    thinking?: 'low' | 'medium'
  } = {},
): Promise<ModelRunResult> {
  const idempotencyKey = requireModelTurnId(options.idempotencyKey)
  const request = options.request ?? requestOpenClawBridge
  const requestTimeoutMs = requireRequestTimeoutMs(
    MODEL_REQUEST_ENVELOPE_TIMEOUT_MS + MODEL_REQUEST_RESPONSE_GRACE_MS,
  )
  // The production requester needs a complete authenticated loopback bridge.
  // Test-only injected requesters remain responsible for their own transport.
  if (options.request === undefined) bridgeConfig(config)
  await options.onRequestStart?.()
  const stdout = await request(
    '/v1/model/run',
    {
      prompt,
      thinking: options.thinking ?? 'medium',
      timeoutMs: config.timeoutMs,
      version: 1,
    },
    config,
    {
      idempotencyKey,
      requestTimeoutMs,
      signal: options.signal,
    },
  )
  return parseModelRunEnvelope(stdout, prompt)
}

/** Run the selected local Codex Hosted Search capability through OpenClaw. */
export async function runOpenClawWebSearch(
  queryValue: string,
  config: OpenClawConfig,
  options: OpenClawWebSearchOptions = {},
): Promise<OpenClawWebSearchResult> {
  const query = requireWebSearchQuery(queryValue)
  const limit = positiveIntegerBound(
    options.limit,
    DEFAULT_OPENCLAW_WEB_SEARCH_LIMIT,
    MAX_OPENCLAW_WEB_SEARCH_LIMIT,
    'limit',
  )
  const maxContentChars = positiveIntegerBound(
    options.maxContentChars,
    DEFAULT_OPENCLAW_WEB_SEARCH_CONTENT_CHARS,
    MAX_OPENCLAW_WEB_SEARCH_CONTENT_CHARS,
    'maxContentChars',
  )
  const maxSearchActivities = positiveIntegerBound(
    options.maxSearchActivities,
    DEFAULT_OPENCLAW_WEB_SEARCH_ACTIVITIES,
    MAX_OPENCLAW_WEB_SEARCH_ACTIVITIES,
    'maxSearchActivities',
  )
  const stdout = await (options.request ?? requestOpenClawBridge)(
    '/v1/web/search',
    {
      limit,
      query,
      timeoutMs: config.searchTimeoutMs,
      version: 1,
    },
    config,
    {
      requestTimeoutMs:
        config.searchTimeoutMs + MODEL_REQUEST_RESPONSE_GRACE_MS,
      signal: options.signal,
    },
  )
  return parseOpenClawWebSearchEnvelope(stdout, query, {
    maxContentChars,
    maxOutputBytes: config.maxOutputBytes,
    maxSearchActivities,
    maxTookMs: config.searchTimeoutMs,
  })
}

export interface OpenClawStatus {
  available: boolean
  message?: string
  model?: string
  reason?: 'cli-not-found' | 'not-configured' | 'unavailable'
  search: {
    available: boolean
    checked: 'live-readiness-probe'
    configurationReady: boolean
    oauthReady: boolean
    provider: 'codex'
    providerReady: boolean
    queryExecuted: boolean
    requiredForLaunch: true
  }
  transport: 'local'
  version?: string
}

function unavailableSearchStatus(): OpenClawStatus['search'] {
  return {
    available: false,
    checked: 'live-readiness-probe',
    configurationReady: false,
    oauthReady: false,
    provider: 'codex',
    providerReady: false,
    queryExecuted: false,
    requiredForLaunch: true,
  }
}

export async function getOpenClawStatus(
  config: OpenClawConfig,
  options: {
    request?: OpenClawBridgeRequester
    signal?: AbortSignal
  } = {},
): Promise<OpenClawStatus> {
  try {
    const stdout = await (options.request ?? requestOpenClawBridge)(
      '/v1/status',
      null,
      config,
      {
        requestTimeoutMs:
          config.timeoutMs + MODEL_REQUEST_RESPONSE_GRACE_MS,
        signal: options.signal,
      },
    )
    const parsed = z.strictObject({
      available: z.boolean(),
      model: z.string().min(1).max(200).nullable(),
      protocolVersion: z.literal(1),
      search: z.strictObject({
        available: z.boolean(),
        checked: z.literal('live-readiness-probe'),
        configurationReady: z.boolean(),
        oauthReady: z.boolean(),
        provider: z.literal('codex'),
        providerReady: z.boolean(),
        queryExecuted: z.literal(true),
        requiredForLaunch: z.literal(true),
      }),
      transport: z.literal('local'),
      version: z.string().min(1).max(200),
    }).safeParse(parseJson(stdout))
    if (!parsed.success) {
      throw new OpenClawCliError(
        'invalid-output',
        'The OpenClaw bridge returned an invalid readiness envelope.',
      )
    }
    const model = parsed.data.model
      ? cleanDisplayValue(parsed.data.model)
      : null
    if (!parsed.data.available || !model || !parsed.data.search.available ||
      !parsed.data.search.configurationReady ||
      !parsed.data.search.oauthReady ||
      !parsed.data.search.providerReady) {
      return {
        available: false,
        message: 'Configure a usable default model and authentication in OpenClaw, then try again.',
        ...(model ? { model } : {}),
        reason: 'not-configured',
        search: parsed.data.search,
        transport: parsed.data.transport,
        version: parsed.data.version,
      }
    }

    return {
      available: true,
      model,
      search: parsed.data.search,
      transport: parsed.data.transport,
      version: parsed.data.version,
    }
  } catch (error) {
    if (error instanceof OpenClawCliError && error.kind === 'not-found') {
      return {
        available: false,
        message: 'Launch WebChess through the installed OpenClaw plugin.',
        reason: 'cli-not-found',
        search: unavailableSearchStatus(),
        transport: 'local',
      }
    }
    return {
      available: false,
      message: 'The authenticated OpenClaw plugin bridge is not ready.',
      reason: 'unavailable',
      search: unavailableSearchStatus(),
      transport: 'local',
    }
  }
}
