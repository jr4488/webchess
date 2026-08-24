// @vitest-environment node

import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { MAX_PERSISTED_MODEL_PROMPT_CHARS } from '../../src/types.js'
import {
  MAX_BRIDGE_REQUEST_BYTES,
  resolveDefaultAgentId,
  startWebChessBridge,
  type OpenClawBridgeApi,
  type SimpleCompletionRuntime,
  type WebChessBridge,
} from './bridge.js'

const roots: string[] = []
const TOKEN = 't'.repeat(43)

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function runtimeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'webchess-bridge-test-'))
  roots.push(root)
  return root
}

function fakeApi(
  webSearch: OpenClawBridgeApi['runtime']['webSearch']['search'] = vi.fn(),
): OpenClawBridgeApi {
  return {
    config: {
      agents: {
        defaults: { model: { primary: 'openai/gpt-5.6-sol' } },
        list: [{ id: 'researcher', default: true }],
      },
    },
    runtime: {
      version: '2026.7.1-2',
      webSearch: { search: webSearch },
    },
  }
}

function simpleRuntime(
  complete: SimpleCompletionRuntime['completeWithPreparedSimpleCompletionModel'] =
    vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
): SimpleCompletionRuntime {
  return {
    completeWithPreparedSimpleCompletionModel: complete,
    prepareSimpleCompletionModelForAgent: vi.fn(async () => ({
      auth: { mode: 'test-only' },
      model: {
        api: 'openai-chatgpt-responses',
        id: 'gpt-5.6-sol',
        maxTokens: 128_000,
        provider: 'openai',
      },
      selection: { provider: 'openai', modelId: 'gpt-5.6-sol' },
    })),
  }
}

async function start(
  api: OpenClawBridgeApi,
  options: Parameters<typeof startWebChessBridge>[2] = {},
): Promise<WebChessBridge> {
  return startWebChessBridge(api, await runtimeRoot(), {
    token: TOKEN,
    simpleCompletionRuntime: simpleRuntime(),
    ...options,
  })
}

function headers(token = TOKEN): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

async function modelRequest(
  bridge: WebChessBridge,
  prompt: string,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${bridge.url}/v1/model/run`, {
    body: JSON.stringify({
      prompt,
      thinking: 'medium',
      timeoutMs: 10_000,
      version: 1,
    }),
    headers: headers(),
    method: 'POST',
    signal,
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })))
})

describe('OpenClaw plugin runtime bridge', () => {
  it('matches OpenClaw default-agent selection and exposes sanitized readiness', async () => {
    expect(resolveDefaultAgentId({})).toBe('main')
    expect(resolveDefaultAgentId({
      agents: { list: [{ id: ' First Agent ' }, { id: 'chosen', default: true }] },
    })).toBe('chosen')

    const bridge = await start(fakeApi())
    try {
      const unauthorized = await fetch(`${bridge.url}/v1/status`)
      expect(unauthorized.status).toBe(401)

      const response = await fetch(`${bridge.url}/v1/status`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        available: true,
        model: 'openai/gpt-5.6-sol',
        protocolVersion: 1,
        transport: 'local',
        version: '2026.7.1-2',
      })
    } finally {
      await bridge.close()
    }
  })

  it('fails launch readiness before listening when model/auth preparation fails', async () => {
    const runtime = simpleRuntime()
    runtime.prepareSimpleCompletionModelForAgent = vi.fn(async () => ({
      error: 'private authentication detail',
    }))
    await expect(start(fakeApi(), {
      simpleCompletionRuntime: runtime,
    })).rejects.toThrow(/usable simple-completion default model/u)
  })

  it('preserves a maximum durable lifecycle prompt exactly without argv transport', async () => {
    const tail = '\nEND-OF-MAXIMUM-CHARLOTTE-EVIDENCE-\u2603'
    const prompt = `${'x'.repeat(
      MAX_PERSISTED_MODEL_PROMPT_CHARS - tail.length,
    )}${tail}`
    let capturedPrompt = ''
    const complete = vi.fn(async (params) => {
      capturedPrompt = params.context.messages[0]?.content ?? ''
      expect(params).toMatchObject({
        context: {
          systemPrompt: 'You are a personal assistant running inside OpenClaw.',
          messages: [{ role: 'user', content: prompt }],
        },
        options: { reasoning: 'medium', maxTokens: 128_000 },
      })
      expect(params.options.signal).toBeInstanceOf(AbortSignal)
      return {
        content: [
          { type: 'text', text: '  {"qualified":' },
          { type: 'image', text: 'must-not-be-joined' },
          { type: 'text', text: 'true}  ' },
        ],
      }
    })
    const runtime = simpleRuntime(complete)
    const bridge = await start(fakeApi(), { simpleCompletionRuntime: runtime })
    try {
      const response = await modelRequest(bridge, prompt)
      expect(response.status).toBe(200)
      const body = await response.json() as Record<string, unknown>
      expect(capturedPrompt).toBe(prompt)
      expect(capturedPrompt.length).toBe(MAX_PERSISTED_MODEL_PROMPT_CHARS)
      expect(Buffer.byteLength(capturedPrompt, 'utf8')).toBe(
        Buffer.byteLength(prompt, 'utf8'),
      )
      expect(body).toMatchObject({
        capability: 'model.run',
        inputBytes: Buffer.byteLength(prompt, 'utf8'),
        inputSha256: digest(prompt),
        model: 'gpt-5.6-sol',
        ok: true,
        provider: 'openai',
        transport: 'local',
        outputs: [{ text: '{"qualified":true}', mediaUrl: null }],
      })
      expect(complete).toHaveBeenCalledTimes(1)
      expect(runtime.prepareSimpleCompletionModelForAgent)
        .toHaveBeenCalledWith({
          agentId: 'researcher',
          allowMissingApiKeyModes: ['aws-sdk'],
          cfg: expect.any(Object),
          skipAgentDiscovery: true,
        })
    } finally {
      await bridge.close()
    }
  })

  it('accepts prompts on both sides of Linux single-argv E2BIG without changing bytes', async () => {
    const received: string[] = []
    const complete = vi.fn(async (params) => {
      received.push(params.context.messages[0]?.content ?? '')
      return {
        content: [{ type: 'text', text: 'ok' }],
      }
    })
    const bridge = await start(fakeApi(), {
      simpleCompletionRuntime: simpleRuntime(complete),
    })
    try {
      const prompts = [
        `${'a'.repeat(131_071)}\nargv-boundary-minus-one`,
        `${'b'.repeat(131_072)}\nargv-boundary-plus-zero`,
        `${'c'.repeat(317_172)}\nverified-high-survivor-size`,
      ]
      for (const prompt of prompts) {
        const response = await modelRequest(bridge, prompt)
        expect(response.status).toBe(200)
        const body = await response.json() as {
          inputBytes: number
          inputSha256: string
        }
        expect(body.inputBytes).toBe(Buffer.byteLength(prompt, 'utf8'))
        expect(body.inputSha256).toBe(digest(prompt))
      }
      expect(received).toEqual(prompts)
    } finally {
      await bridge.close()
    }
  })

  it('aborts and awaits the model runtime when the HTTP client disconnects', async () => {
    let settled = false
    const complete = vi.fn(async (params) => {
      await new Promise<void>((resolve) => {
        params.options.signal.addEventListener('abort', () => {
          setTimeout(() => {
            settled = true
            resolve()
          }, 10)
        }, { once: true })
      })
      return { content: [] }
    })
    const bridge = await start(fakeApi(), {
      simpleCompletionRuntime: simpleRuntime(complete),
    })
    const controller = new AbortController()
    try {
      const pending = modelRequest(bridge, 'disconnect test prompt', controller.signal)
      await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
      controller.abort()
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await vi.waitFor(() => expect(settled).toBe(true))
    } finally {
      await bridge.close()
    }
    expect(settled).toBe(true)
  })

  it('routes hosted-search queries through the runtime API instead of argv', async () => {
    const search = vi.fn(async (params) => ({
      provider: 'codex',
      result: {
        query: params.args.query,
        provider: 'codex',
        model: 'gpt-5.6',
        tookMs: 12,
        externalContent: {
          untrusted: true,
          source: 'web_search',
          provider: 'codex',
          wrapped: true,
        },
        content: 'wrapped fixture',
        searches: [{ query: params.args.query }],
      },
    }))
    const bridge = await start(fakeApi(search))
    const query = 'current primary evidence for a reversible next step'
    try {
      const response = await fetch(`${bridge.url}/v1/web/search`, {
        body: JSON.stringify({
          limit: 4,
          query,
          timeoutMs: 45_000,
          version: 1,
        }),
        headers: headers(),
        method: 'POST',
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        capability: 'web.search',
        inputBytes: Buffer.byteLength(query, 'utf8'),
        inputSha256: digest(query),
        provider: 'codex',
      })
      expect(search).toHaveBeenCalledWith(expect.objectContaining({
        args: { count: 4, limit: 4, query },
        providerId: 'codex',
      }))
    } finally {
      await bridge.close()
    }
  })

  it('rejects unauthenticated, oversized, and unknown requests before runtime work', async () => {
    const complete = vi.fn()
    const bridge = await start(fakeApi(), {
      maxRequestBytes: 1_024,
      simpleCompletionRuntime: simpleRuntime(complete),
    })
    try {
      const unauthenticated = await fetch(`${bridge.url}/v1/model/run`, {
        body: '{}',
        headers: headers('wrong-token-that-is-still-long-enough-000000'),
        method: 'POST',
      })
      expect(unauthenticated.status).toBe(401)

      const oversized = await fetch(`${bridge.url}/v1/model/run`, {
        body: JSON.stringify({ prompt: 'x'.repeat(2_000) }),
        headers: headers(),
        method: 'POST',
      })
      expect(oversized.status).toBe(413)

      const missing = await fetch(`${bridge.url}/unknown`, {
        body: '{}',
        headers: headers(),
        method: 'POST',
      })
      expect(missing.status).toBe(404)
      expect(complete).not.toHaveBeenCalled()
    } finally {
      await bridge.close()
    }
  })

  it('documents a request ceiling above the maximum durable UTF-8 prompt envelope', () => {
    expect(MAX_BRIDGE_REQUEST_BYTES).toBeGreaterThan(
      MAX_PERSISTED_MODEL_PROMPT_CHARS * 4,
    )
  })
})
