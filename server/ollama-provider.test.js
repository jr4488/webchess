import { describe, expect, it, vi } from 'vitest'

import {
  createOllamaClient,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_TIMEOUT_MS,
  OLLAMA_TRANSPORT_GRACE_MS,
  OLLAMA_PROVIDER,
  OLLAMA_PROVIDER_INFO,
  resolveOllamaBaseURL,
} from './ollama-provider.mjs'

function fakeClient(result = { status: 'completed' }) {
  const parse = vi.fn().mockResolvedValue(result)
  return {
    client: {
      responses: { parse },
    },
    parse,
  }
}

function fakeTransport() {
  const dispatcher = {
    close: vi.fn().mockResolvedValue(undefined),
  }
  return {
    createDispatcher: vi.fn(() => dispatcher),
    dispatcher,
    fetch: vi.fn(),
  }
}

describe('Ollama provider identity', () => {
  it('publishes local-only defaults without claiming API credentials or billing', () => {
    expect(OLLAMA_PROVIDER).toBe('ollama')
    expect(DEFAULT_OLLAMA_MODEL).toBe('qwen3.6:27b')
    expect(DEFAULT_OLLAMA_BASE_URL).toBe('http://127.0.0.1:11434/v1')
    expect(OLLAMA_PROVIDER_INFO).toEqual({
      id: 'ollama',
      label: 'Ollama',
      billing: 'local-compute',
      localOnly: true,
      requiresApiKey: false,
      requiresChatGptLogin: false,
    })
    expect(Object.isFrozen(OLLAMA_PROVIDER_INFO)).toBe(true)
  })
})

describe('Ollama base URL validation', () => {
  it.each([
    [undefined, DEFAULT_OLLAMA_BASE_URL],
    ['', DEFAULT_OLLAMA_BASE_URL],
    ['  ', DEFAULT_OLLAMA_BASE_URL],
    ['http://127.0.0.1:11434/v1', 'http://127.0.0.1:11434/v1'],
    ['http://127.42.0.9:8080/v1/', 'http://127.42.0.9:8080/v1'],
    ['http://LOCALHOST:11434/v1', 'http://localhost:11434/v1'],
    ['http://[::1]:11434/v1/', 'http://[::1]:11434/v1'],
  ])('accepts and canonicalizes %s', (input, expected) => {
    expect(resolveOllamaBaseURL(input)).toBe(expected)
  })

  it.each([
    ['https://127.0.0.1:11434/v1', /must use http/u],
    ['file:///v1', /must use http/u],
    ['http://user@127.0.0.1:11434/v1', /credentials/u],
    ['http://user:secret@localhost:11434/v1', /credentials/u],
    ['http://0.0.0.0:11434/v1', /loopback host/u],
    ['http://192.168.1.5:11434/v1', /loopback host/u],
    ['http://example.com:11434/v1', /loopback host/u],
    ['http://127.0.0.1.example.com:11434/v1', /loopback host/u],
    ['http://127.0.0.1:11434', /path must be \/v1/u],
    ['http://127.0.0.1:11434/api', /path must be \/v1/u],
    ['http://127.0.0.1:11434/v1/models', /path must be \/v1/u],
    ['http://127.0.0.1:11434/%76%31', /path must be \/v1/u],
    ['http://127.0.0.1:11434/v1?model=x', /query or fragment/u],
    ['http://127.0.0.1:11434/v1?', /query or fragment/u],
    ['http://127.0.0.1:11434/v1#details', /query or fragment/u],
    ['http://127.0.0.1:11434/v1#', /query or fragment/u],
  ])('rejects unsafe endpoint %s', (input, expected) => {
    expect(() => resolveOllamaBaseURL(input)).toThrow(expected)
  })

  it.each([
    [null],
    [new URL(DEFAULT_OLLAMA_BASE_URL)],
    [42],
    [{}],
    ['not a URL'],
  ])('rejects non-string or malformed endpoint %s', (input) => {
    expect(() => resolveOllamaBaseURL(input)).toThrow(TypeError)
  })
})

describe('Ollama native Responses client', () => {
  it('constructs the OpenAI client with local, bounded defaults', async () => {
    const { client } = fakeClient()
    const createOpenAIClient = vi.fn(() => client)
    const transport = fakeTransport()

    expect(createOllamaClient({
      environment: {},
      createOpenAIClient,
      createDispatcher: transport.createDispatcher,
      fetch: transport.fetch,
    })).toBe(client)
    expect(createOpenAIClient).toHaveBeenCalledOnce()
    expect(createOpenAIClient).toHaveBeenCalledWith({
      apiKey: 'ollama',
      baseURL: DEFAULT_OLLAMA_BASE_URL,
      maxRetries: 0,
      timeout: DEFAULT_OLLAMA_TIMEOUT_MS,
      fetch: transport.fetch,
      fetchOptions: { dispatcher: transport.dispatcher },
    })
    expect(transport.createDispatcher).toHaveBeenCalledWith({
      headersTimeout: DEFAULT_OLLAMA_TIMEOUT_MS + OLLAMA_TRANSPORT_GRACE_MS,
      bodyTimeout: DEFAULT_OLLAMA_TIMEOUT_MS + OLLAMA_TRANSPORT_GRACE_MS,
    })
    await client.close()
    await client.close()
    expect(transport.dispatcher.close).toHaveBeenCalledOnce()
  })

  it('uses the configured endpoint and transport limits', async () => {
    const { client } = fakeClient()
    const createOpenAIClient = vi.fn(() => client)
    const transport = fakeTransport()

    createOllamaClient({
      environment: {
        WEBCHESS_OLLAMA_BASE_URL: 'http://localhost:22434/v1/',
        OPENAI_API_KEY: 'must-not-leak',
      },
      timeoutMs: 480_000,
      maxRetries: 2,
      createOpenAIClient,
      createDispatcher: transport.createDispatcher,
      fetch: transport.fetch,
    })

    expect(createOpenAIClient).toHaveBeenCalledWith({
      apiKey: 'ollama',
      baseURL: 'http://localhost:22434/v1',
      maxRetries: 2,
      timeout: 480_000,
      fetch: transport.fetch,
      fetchOptions: { dispatcher: transport.dispatcher },
    })
    expect(transport.createDispatcher).toHaveBeenCalledWith({
      headersTimeout: 480_000 + OLLAMA_TRANSPORT_GRACE_MS,
      bodyTimeout: 480_000 + OLLAMA_TRANSPORT_GRACE_MS,
    })
    await client.close()
  })

  it('still closes the dispatcher when native client cleanup throws synchronously', async () => {
    const nativeError = new Error('native close failed')
    const { client } = fakeClient()
    const nativeClose = vi.fn(() => {
      throw nativeError
    })
    client.close = nativeClose
    const createOpenAIClient = vi.fn(() => client)
    const transport = fakeTransport()
    const wrapped = createOllamaClient({
      createOpenAIClient,
      createDispatcher: transport.createDispatcher,
      fetch: transport.fetch,
    })

    await expect(wrapped.close()).rejects.toBe(nativeError)
    expect(nativeClose).toHaveBeenCalledOnce()
    expect(transport.dispatcher.close).toHaveBeenCalledOnce()
  })

  it('lets explicit constructor options override the environment', () => {
    const { client } = fakeClient()
    const createOpenAIClient = vi.fn(() => client)

    createOllamaClient({
      environment: {
        WEBCHESS_OLLAMA_BASE_URL: 'http://localhost:11434/v1',
      },
      baseURL: 'http://127.0.0.2:31434/v1',
      timeout: 90_000,
      timeoutMs: 180_000,
      createOpenAIClient,
    })

    expect(createOpenAIClient).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'http://127.0.0.2:31434/v1',
      timeout: 90_000,
    }))
  })

  it('preserves native payloads, results, and request options exactly', async () => {
    const result = {
      status: 'completed',
      incomplete_details: null,
      output: [],
      output_parsed: { answer: 'local result' },
      model: 'qwen3.6:27b',
    }
    const { client: nativeClient, parse } = fakeClient(result)
    const client = createOllamaClient({ client: nativeClient })
    const controller = new AbortController()
    const input = {
      model: 'qwen3.6:27b',
      reasoning: { mode: 'pro', effort: 'medium' },
      instructions: 'Return the requested structure.',
      input: '{"game_evidence":{}}',
      text: {
        format: {
          type: 'json_schema',
          name: 'webchess_answer',
          strict: true,
          schema: {
            type: 'object',
            properties: { answer: { type: 'string' } },
            required: ['answer'],
            additionalProperties: false,
          },
        },
      },
      max_output_tokens: 12_000,
      store: false,
    }
    const requestOptions = {
      signal: controller.signal,
      timeout: 360_000,
      maxRetries: 0,
    }

    await expect(client.responses.parse(input, requestOptions))
      .resolves.toBe(result)
    expect(client).toBe(nativeClient)
    expect(parse).toHaveBeenCalledOnce()
    expect(parse).toHaveBeenCalledWith(input, requestOptions)
    expect(input.reasoning).toEqual({ mode: 'pro', effort: 'medium' })
  })

  it('uses an injected native client without constructing another one', () => {
    const { client } = fakeClient()
    const createOpenAIClient = vi.fn(() => {
      throw new Error('must not construct')
    })

    expect(createOllamaClient({ client, createOpenAIClient })).toBe(client)
    expect(createOpenAIClient).not.toHaveBeenCalled()
  })

  it('rejects invalid endpoints before constructing a client', () => {
    const createOpenAIClient = vi.fn()

    expect(() => createOllamaClient({
      baseURL: 'http://example.com:11434/v1',
      createOpenAIClient,
    })).toThrow(/loopback host/u)
    expect(createOpenAIClient).not.toHaveBeenCalled()
  })

  it.each([
    [{ timeout: 0 }, /positive integer/u],
    [{ timeoutMs: 1.5 }, /positive integer/u],
    [{ maxRetries: -1 }, /non-negative integer/u],
    [{ maxRetries: 0.5 }, /non-negative integer/u],
  ])('rejects invalid transport options %#', (options, expected) => {
    const { client } = fakeClient()
    expect(() => createOllamaClient({
      client,
      ...options,
    })).toThrow(expected)
  })

  it.each([
    [null],
    [{}],
    [{ responses: {} }],
    [{ responses: { parse: 'not a function' } }],
  ])('rejects an invalid injected client %#', (client) => {
    expect(() => createOllamaClient({ client })).toThrow(
      /must expose responses\.parse/u,
    )
  })

  it('rejects an invalid factory or factory result', () => {
    expect(() => createOllamaClient({
      createOpenAIClient: 'not a function',
    })).toThrow(/must be a function/u)
    expect(() => createOllamaClient({
      createOpenAIClient: () => ({}),
    })).toThrow(/must expose responses\.parse/u)
  })
})
