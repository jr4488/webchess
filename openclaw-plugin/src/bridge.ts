import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'

export const BRIDGE_PROTOCOL_VERSION = 1
export const MAX_BRIDGE_REQUEST_BYTES = 16 * 1024 * 1024
export const MAX_BRIDGE_RESPONSE_BYTES = 4 * 1024 * 1024
export const MAX_BRIDGE_PROMPT_CHARS = 12 * 1024 * 1024
export const MAX_BRIDGE_QUERY_CHARS = 500
const MAX_CONCURRENT_RUNS = 4
const LOOPBACK_HOST = '127.0.0.1'
const CODEX_SEARCH_ABORT_DRAIN_MS = 1_250
const OPENCLAW_LOCAL_MODEL_RUN_SYSTEM_PROMPT =
  'You are a personal assistant running inside OpenClaw.'

type ThinkingLevel = 'low' | 'medium'

interface PreparedSimpleCompletionModel {
  auth: unknown
  model: {
    api?: string
    id: string
    maxTokens?: number
    provider: string
  }
  selection: {
    modelId: string
    provider: string
  }
}

export interface SimpleCompletionRuntime {
  completeWithPreparedSimpleCompletionModel(params: {
    auth: unknown
    cfg: OpenClawRuntimeConfig
    context: {
      messages: Array<{
        content: string
        role: 'user'
        timestamp: number
      }>
      systemPrompt?: string
    }
    model: PreparedSimpleCompletionModel['model']
    options: {
      maxTokens?: number
      reasoning: ThinkingLevel
      signal: AbortSignal
    }
  }): Promise<{
    content: Array<{
      text?: string
      type: string
    }>
    errorMessage?: string
  }>
  prepareSimpleCompletionModelForAgent(params: {
    agentId: string
    allowMissingApiKeyModes: ['aws-sdk']
    cfg: OpenClawRuntimeConfig
    skipAgentDiscovery: true
  }): Promise<PreparedSimpleCompletionModel | { error: string }>
}

interface OpenClawRuntimeConfig {
  agents?: {
    defaults?: {
      model?: string | {
        primary?: string
      }
    }
    list?: Array<{
      default?: boolean
      id?: string
    }>
  }
}

export interface OpenClawBridgeApi {
  config: OpenClawRuntimeConfig
  runtime: {
    version: string
    webSearch: {
      search(params: {
        args: {
          count: number
          limit: number
          query: string
        }
        config: OpenClawRuntimeConfig
        providerId: 'codex'
        signal: AbortSignal
      }): Promise<{
        provider: string
        result: Record<string, unknown>
      }>
    }
  }
}

export interface WebChessBridge {
  close(): Promise<void>
  token: string
  url: string
}

export interface WebChessBridgeOptions {
  host?: string
  maxConcurrentRuns?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
  simpleCompletionRuntime?: SimpleCompletionRuntime
  token?: string
}

interface ModelRunRequest {
  prompt: string
  thinking: ThinkingLevel
  timeoutMs: number
  version: 1
}

interface WebSearchRequest {
  limit: number
  query: string
  timeoutMs: number
  version: 1
}

class BridgeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BridgeRequestError'
  }
}

function normalizedAgentId(value: unknown): string {
  if (typeof value !== 'string') return 'main'
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'main'
}

export function resolveDefaultAgentId(
  config: OpenClawRuntimeConfig,
): string {
  const agents = Array.isArray(config.agents?.list)
    ? config.agents.list
    : []
  const selected = agents.find((agent) => agent?.default) ?? agents[0]
  return normalizedAgentId(selected?.id)
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const accepted = new Set(allowed)
  return Object.keys(value).every((key) => accepted.has(key))
}

function requireInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new BridgeRequestError(400, 'INVALID_REQUEST', `${label} is invalid.`)
  }
  return value
}

function parseModelRunRequest(value: unknown): ModelRunRequest {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['prompt', 'thinking', 'timeoutMs', 'version']) ||
    value.version !== BRIDGE_PROTOCOL_VERSION ||
    typeof value.prompt !== 'string' ||
    value.prompt.trim().length === 0 ||
    value.prompt.length > MAX_BRIDGE_PROMPT_CHARS ||
    (value.thinking !== 'low' && value.thinking !== 'medium')
  ) {
    throw new BridgeRequestError(
      400,
      'INVALID_REQUEST',
      'The model request does not match the bridge contract.',
    )
  }
  return {
    prompt: value.prompt,
    thinking: value.thinking,
    timeoutMs: requireInteger(value.timeoutMs, 1_000, 150_000, 'timeoutMs'),
    version: 1,
  }
}

function parseWebSearchRequest(value: unknown): WebSearchRequest {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['limit', 'query', 'timeoutMs', 'version']) ||
    value.version !== BRIDGE_PROTOCOL_VERSION ||
    typeof value.query !== 'string' ||
    value.query.length === 0 ||
    value.query.length > MAX_BRIDGE_QUERY_CHARS ||
    value.query.trim() !== value.query ||
    /[\p{C}\r\n]/gu.test(value.query)
  ) {
    throw new BridgeRequestError(
      400,
      'INVALID_REQUEST',
      'The web search request does not match the bridge contract.',
    )
  }
  return {
    limit: requireInteger(value.limit, 1, 10, 'limit'),
    query: value.query,
    timeoutMs: requireInteger(value.timeoutMs, 1_000, 150_000, 'timeoutMs'),
    version: 1,
  }
}

function authorized(request: IncomingMessage, token: string): boolean {
  const supplied = request.headers.authorization
  if (typeof supplied !== 'string') return false
  const expected = Buffer.from(`Bearer ${token}`, 'utf8')
  const received = Buffer.from(supplied, 'utf8')
  return expected.length === received.length && timingSafeEqual(expected, received)
}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const contentType = request.headers['content-type']
  if (
    typeof contentType !== 'string' ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)
  ) {
    throw new BridgeRequestError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'The bridge accepts application/json only.',
    )
  }
  const declared = request.headers['content-length']
  if (declared !== undefined) {
    const parsed = Number(declared)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
      throw new BridgeRequestError(
        413,
        'REQUEST_TOO_LARGE',
        'The bridge request exceeds its byte limit.',
      )
    }
  }

  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > maxBytes) {
      throw new BridgeRequestError(
        413,
        'REQUEST_TOO_LARGE',
        'The bridge request exceeds its byte limit.',
      )
    }
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new BridgeRequestError(
      400,
      'INVALID_JSON',
      'The bridge request is not valid JSON.',
    )
  }
}

function responseHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Type': 'application/json; charset=utf-8',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  maxBytes: number,
): void {
  if (response.destroyed || response.writableEnded) return
  let body = JSON.stringify(value)
  if (Buffer.byteLength(body, 'utf8') > maxBytes) {
    status = 502
    body = JSON.stringify({
      error: {
        code: 'RESPONSE_TOO_LARGE',
        message: 'The OpenClaw result exceeded the bridge response limit.',
      },
    })
  }
  response.writeHead(status, {
    ...responseHeaders(),
    'Content-Length': String(Buffer.byteLength(body, 'utf8')),
  })
  response.end(body)
}

function bridgeFailure(error: unknown): {
  code: string
  message: string
  status: number
} {
  if (error instanceof BridgeRequestError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    }
  }
  return {
    code: 'OPENCLAW_RUNTIME_FAILED',
    message: 'The OpenClaw plugin runtime could not complete the request.',
    status: 502,
  }
}

async function loadSimpleCompletionRuntime(): Promise<SimpleCompletionRuntime> {
  // This focused package export is the same simple-completion runtime used by
  // `openclaw infer model run --local`. Keep its role/reasoning semantics in
  // lockstep with the pinned OpenClaw version; raw embedded-agent mode differs.
  return await import(
    'openclaw/plugin-sdk/simple-completion-runtime'
  ) as unknown as SimpleCompletionRuntime
}

function textFromCompletion(
  content: Array<{ text?: string; type: string }>,
): string {
  return content
    .map((block) =>
      block.type === 'text' && typeof block.text === 'string'
        ? block.text
        : '')
    .join('')
    .trim()
}

function listen(server: Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('The WebChess bridge did not receive a TCP port.'))
        return
      }
      resolve(address.port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, host)
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections?.()
  })
}

export async function startWebChessBridge(
  api: OpenClawBridgeApi,
  _runtimeRoot: string,
  options: WebChessBridgeOptions = {},
): Promise<WebChessBridge> {
  const host = options.host ?? LOOPBACK_HOST
  if (host !== LOOPBACK_HOST) {
    throw new Error('The WebChess bridge must bind to 127.0.0.1.')
  }
  const maxRequestBytes = options.maxRequestBytes ?? MAX_BRIDGE_REQUEST_BYTES
  const maxResponseBytes = options.maxResponseBytes ?? MAX_BRIDGE_RESPONSE_BYTES
  const maxConcurrentRuns = options.maxConcurrentRuns ?? MAX_CONCURRENT_RUNS
  const token = options.token ?? randomBytes(32).toString('base64url')
  if (Buffer.byteLength(token, 'utf8') < 32) {
    throw new Error('The WebChess bridge bearer must contain at least 32 bytes.')
  }

  const simpleCompletion = options.simpleCompletionRuntime ??
    await loadSimpleCompletionRuntime()
  const preflightAgentId = resolveDefaultAgentId(api.config)
  const preflight = await simpleCompletion.prepareSimpleCompletionModelForAgent({
    agentId: preflightAgentId,
    allowMissingApiKeyModes: ['aws-sdk'],
    cfg: api.config,
    skipAgentDiscovery: true,
  })
  if ('error' in preflight || preflight.selection.provider === 'codex') {
    throw new Error(
      'OpenClaw needs a usable simple-completion default model and authentication before WebChess can launch.',
    )
  }
  const readyModel =
    `${preflight.selection.provider}/${preflight.selection.modelId}`
  const activeControllers = new Set<AbortController>()
  const activeRuns = new Set<Promise<void>>()
  let expectedHost = ''
  let closing = false

  const server = createServer((request, response) => {
    const run = (async () => {
      if (
        closing ||
        request.socket.remoteAddress !== LOOPBACK_HOST ||
        request.headers.host !== expectedHost ||
        !authorized(request, token)
      ) {
        throw new BridgeRequestError(401, 'UNAUTHORIZED', 'Bridge authorization failed.')
      }
      if (activeControllers.size >= maxConcurrentRuns) {
        throw new BridgeRequestError(503, 'BRIDGE_BUSY', 'The bridge is at its concurrency limit.')
      }
      if (request.method === 'GET' && request.url === '/v1/status') {
        sendJson(response, 200, {
          available: true,
          model: readyModel,
          transport: 'local',
          version: api.runtime.version,
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
        }, maxResponseBytes)
        return
      }
      if (request.method !== 'POST') {
        throw new BridgeRequestError(404, 'NOT_FOUND', 'Unknown bridge endpoint.')
      }

      const body = await readJsonBody(request, maxRequestBytes)
      const controller = new AbortController()
      activeControllers.add(controller)
      let timedOut = false
      let clientDisconnected = false
      const timeoutMs = isRecord(body) && typeof body.timeoutMs === 'number'
        ? body.timeoutMs
        : 0
      const timeout = setTimeout(() => {
        timedOut = true
        controller.abort(new Error('WebChess bridge timeout'))
      }, Math.max(1, timeoutMs))
      const onAborted = () => {
        clientDisconnected = true
        controller.abort(new Error('WebChess bridge client disconnected'))
      }
      const onClosed = () => {
        if (!response.writableEnded) onAborted()
      }
      request.once('aborted', onAborted)
      response.once('close', onClosed)

      try {
        if (request.url === '/v1/model/run') {
          const input = parseModelRunRequest(body)
          const agentId = resolveDefaultAgentId(api.config)
          const prepared = await simpleCompletion
            .prepareSimpleCompletionModelForAgent({
              agentId,
              allowMissingApiKeyModes: ['aws-sdk'],
              cfg: api.config,
              skipAgentDiscovery: true,
            })
          if (timedOut) {
            throw new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'OpenClaw model preparation timed out.')
          }
          if (clientDisconnected || controller.signal.aborted) {
            throw new BridgeRequestError(408, 'OPENCLAW_ABORTED', 'The OpenClaw model run was cancelled.')
          }
          if ('error' in prepared) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              'The configured OpenClaw model or authentication is not ready.',
            )
          }
          if (prepared.selection.provider === 'codex') {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              'Select an openai model for the OpenClaw account-auth path.',
            )
          }
          const systemPrompt = prepared.model.api === 'openai-chatgpt-responses'
            ? OPENCLAW_LOCAL_MODEL_RUN_SYSTEM_PROMPT
            : undefined
          let result: Awaited<ReturnType<
            SimpleCompletionRuntime['completeWithPreparedSimpleCompletionModel']
          >>
          try {
            result = await simpleCompletion
              .completeWithPreparedSimpleCompletionModel({
                auth: prepared.auth,
                cfg: api.config,
                context: {
                  messages: [{
                    content: input.prompt,
                    role: 'user',
                    timestamp: Date.now(),
                  }],
                  ...(systemPrompt ? { systemPrompt } : {}),
                },
                model: prepared.model,
                options: {
                  ...(typeof prepared.model.maxTokens === 'number' &&
                    Number.isFinite(prepared.model.maxTokens)
                    ? { maxTokens: prepared.model.maxTokens }
                    : {}),
                  reasoning: input.thinking,
                  signal: controller.signal,
                },
              })
          } catch (error) {
            if (timedOut) {
              throw new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'The OpenClaw model run timed out.')
            }
            if (clientDisconnected || controller.signal.aborted) {
              throw new BridgeRequestError(408, 'OPENCLAW_ABORTED', 'The OpenClaw model run was cancelled.')
            }
            throw error
          }
          if (timedOut) {
            throw new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'The OpenClaw model run timed out.')
          }
          if (clientDisconnected || controller.signal.aborted) {
            throw new BridgeRequestError(408, 'OPENCLAW_ABORTED', 'The OpenClaw model run was cancelled.')
          }
          const outputText = textFromCompletion(result.content)
          const provider = prepared.selection.provider.trim()
          const model = prepared.selection.modelId.trim()
          if (!outputText || !provider || !model) {
            throw new BridgeRequestError(502, 'INVALID_MODEL_RESULT', 'The OpenClaw model result was incomplete.')
          }
          sendJson(response, 200, {
            ok: true,
            capability: 'model.run',
            transport: 'local',
            provider,
            model,
            attempts: [],
            inputBytes: Buffer.byteLength(input.prompt, 'utf8'),
            inputSha256: sha256(input.prompt),
            systemPrompt: {
              chars: systemPrompt?.length ?? 0,
              sha256: systemPrompt ? sha256(systemPrompt) : null,
            },
            outputs: [{ text: outputText, mediaUrl: null }],
          }, maxResponseBytes)
          return
        }

        if (request.url === '/v1/web/search') {
          const input = parseWebSearchRequest(body)
          let result: Awaited<ReturnType<
            OpenClawBridgeApi['runtime']['webSearch']['search']
          >>
          try {
            result = await api.runtime.webSearch.search({
              args: {
                count: input.limit,
                limit: input.limit,
                query: input.query,
              },
              config: api.config,
              providerId: 'codex',
              signal: controller.signal,
            })
          } catch (error) {
            if (controller.signal.aborted) {
              // The pinned Codex worker schedules a process-group SIGKILL one
              // second after close. Keep this plugin-owned request alive long
              // enough for that cleanup; this is not a provider-side billing
              // cancellation acknowledgement.
              await new Promise((resolve) =>
                setTimeout(resolve, CODEX_SEARCH_ABORT_DRAIN_MS))
            }
            if (timedOut) {
              throw new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'Codex Hosted Search timed out.')
            }
            if (clientDisconnected || controller.signal.aborted) {
              throw new BridgeRequestError(408, 'OPENCLAW_ABORTED', 'Codex Hosted Search was cancelled.')
            }
            throw error
          }
          if (timedOut) {
            throw new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'Codex Hosted Search timed out.')
          }
          if (clientDisconnected || controller.signal.aborted) {
            throw new BridgeRequestError(408, 'OPENCLAW_ABORTED', 'Codex Hosted Search was cancelled.')
          }
          sendJson(response, 200, {
            ok: true,
            capability: 'web.search',
            transport: 'local',
            provider: result.provider,
            attempts: [],
            inputBytes: Buffer.byteLength(input.query, 'utf8'),
            inputSha256: sha256(input.query),
            outputs: [{ result: result.result }],
          }, maxResponseBytes)
          return
        }
        throw new BridgeRequestError(404, 'NOT_FOUND', 'Unknown bridge endpoint.')
      } finally {
        clearTimeout(timeout)
        request.off('aborted', onAborted)
        response.off('close', onClosed)
        activeControllers.delete(controller)
      }
    })()

    const tracked = run.then(
      () => undefined,
      (error: unknown) => {
        const failure = bridgeFailure(error)
        sendJson(response, failure.status, {
          error: {
            code: failure.code,
            message: failure.message,
          },
        }, maxResponseBytes)
      },
    ).finally(() => activeRuns.delete(tracked))
    activeRuns.add(tracked)
  })
  server.on('clientError', (_error, socket) => socket.destroy())

  const port = await listen(server, host)
  expectedHost = `${host}:${port}`
  return {
    token,
    url: `http://${expectedHost}`,
    async close() {
      if (closing) return
      closing = true
      for (const controller of activeControllers) {
        controller.abort(new Error('WebChess bridge is closing'))
      }
      await Promise.allSettled([...activeRuns])
      await closeServer(server)
    },
  }
}
