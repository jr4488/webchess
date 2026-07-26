import OpenAI from 'openai'
import { isIP } from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'

export const OLLAMA_PROVIDER = 'ollama'
export const DEFAULT_OLLAMA_MODEL = 'qwen3.6:27b'
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1'
export const DEFAULT_OLLAMA_TIMEOUT_MS = 120_000
export const OLLAMA_TRANSPORT_GRACE_MS = 30_000

export const OLLAMA_PROVIDER_INFO = Object.freeze({
  id: OLLAMA_PROVIDER,
  label: 'Ollama',
  billing: 'local-compute',
  localOnly: true,
  requiresApiKey: false,
  requiresChatGptLogin: false,
})

const OLLAMA_COMPATIBILITY_API_KEY = 'ollama'

function isLoopbackHost(value) {
  let host = value.toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1)
  }
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') {
    return true
  }
  if (host.startsWith('::ffff:')) {
    host = host.slice('::ffff:'.length)
  }
  return isIP(host) === 4 && host.split('.')[0] === '127'
}

function positiveInteger(value, fallback, label) {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${label} must be a positive integer.`)
  }
  return resolved
}

function nonNegativeInteger(value, fallback, label) {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`)
  }
  return resolved
}

/**
 * Resolve an Ollama OpenAI-compatible endpoint without permitting remote hosts,
 * credentials, or alternate paths.
 */
export function resolveOllamaBaseURL(value) {
  const supplied = typeof value === 'string' ? value.trim() : value
  const source = supplied === undefined || supplied === ''
    ? DEFAULT_OLLAMA_BASE_URL
    : supplied

  if (typeof source !== 'string') {
    throw new TypeError(
      'WEBCHESS_OLLAMA_BASE_URL must be an HTTP URL string.',
    )
  }

  let url
  try {
    url = new URL(source)
  } catch {
    throw new TypeError('WEBCHESS_OLLAMA_BASE_URL must be a valid HTTP URL.')
  }

  if (url.protocol !== 'http:') {
    throw new TypeError('WEBCHESS_OLLAMA_BASE_URL must use http.')
  }
  if (url.username || url.password) {
    throw new TypeError(
      'WEBCHESS_OLLAMA_BASE_URL must not contain credentials.',
    )
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new TypeError('WEBCHESS_OLLAMA_BASE_URL must use a loopback host.')
  }
  if (source.includes('?') || source.includes('#')) {
    throw new TypeError(
      'WEBCHESS_OLLAMA_BASE_URL must not contain a query or fragment.',
    )
  }
  if (url.pathname !== '/v1' && url.pathname !== '/v1/') {
    throw new TypeError('WEBCHESS_OLLAMA_BASE_URL path must be /v1.')
  }

  url.pathname = '/v1'
  return url.href
}

function responsesClient(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.responses?.parse !== 'function'
  ) {
    throw new TypeError(
      'The Ollama OpenAI client must expose responses.parse().',
    )
  }
  return value
}

function attachDispatcherCleanup(client, dispatcher) {
  const originalClose = typeof client.close === 'function'
    ? client.close.bind(client)
    : undefined
  let closePromise
  Object.defineProperty(client, 'close', {
    configurable: true,
    value() {
      if (!closePromise) {
        const tasks = [
          ...(originalClose
            ? [Promise.resolve().then(() => originalClose())]
            : []),
          Promise.resolve().then(() => dispatcher.close()),
        ]
        closePromise = Promise.allSettled(tasks).then((results) => {
          const failures = results.flatMap((result) =>
            result.status === 'rejected' ? [result.reason] : [],
          )
          if (failures.length === 1) throw failures[0]
          if (failures.length > 1) {
            throw new AggregateError(failures, 'Ollama transport cleanup failed.')
          }
        })
      }
      return closePromise
    },
  })
  return client
}

/**
 * Construct the OpenAI-compatible Ollama client used by existing WebChess
 * Responses API call sites. Native responses.parse is intentionally preserved.
 */
export function createOllamaClient(options = {}) {
  const environment = options.environment ?? process.env
  const baseURL = resolveOllamaBaseURL(
    options.baseURL ?? environment.WEBCHESS_OLLAMA_BASE_URL,
  )
  const timeout = positiveInteger(
    options.timeout ?? options.timeoutMs,
    DEFAULT_OLLAMA_TIMEOUT_MS,
    'Ollama request timeout',
  )
  const maxRetries = nonNegativeInteger(
    options.maxRetries,
    0,
    'Ollama retry count',
  )

  if (options.client !== undefined) {
    return responsesClient(options.client)
  }

  const createOpenAIClient = options.createOpenAIClient
    ?? ((clientOptions) => new OpenAI(clientOptions))
  if (typeof createOpenAIClient !== 'function') {
    throw new TypeError('createOpenAIClient must be a function.')
  }

  const createDispatcher = options.createDispatcher
    ?? ((dispatcherOptions) => new Agent(dispatcherOptions))
  if (typeof createDispatcher !== 'function') {
    throw new TypeError('createDispatcher must be a function.')
  }
  const transportTimeout = positiveInteger(
    timeout + OLLAMA_TRANSPORT_GRACE_MS,
    timeout,
    'Ollama transport timeout',
  )
  const dispatcher = createDispatcher({
    headersTimeout: transportTimeout,
    bodyTimeout: transportTimeout,
  })
  if (!dispatcher || typeof dispatcher.close !== 'function') {
    throw new TypeError('createDispatcher must return a closable dispatcher.')
  }

  try {
    const client = responsesClient(createOpenAIClient({
      apiKey: OLLAMA_COMPATIBILITY_API_KEY,
      baseURL,
      maxRetries,
      timeout,
      fetch: options.fetch ?? undiciFetch,
      fetchOptions: { dispatcher },
    }))
    return attachDispatcherCleanup(client, dispatcher)
  } catch (error) {
    Promise.resolve(dispatcher.close()).catch(() => {})
    throw error
  }
}
