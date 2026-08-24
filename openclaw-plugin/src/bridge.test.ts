// @vitest-environment node

import { createHash } from 'node:crypto'
import { accessSync, constants as fsConstants } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { MAX_PERSISTED_MODEL_PROMPT_CHARS } from '../../src/types.js'
import {
  resolveOpenAiCodexAccessTokenIdentity,
  type CodexPackageAttestation,
  type PreparedAuthAccountInspector,
} from './codex-attestation.js'
import {
  CODEX_SEARCH_READINESS_QUERY,
  MAX_BRIDGE_REQUEST_BYTES,
  OPENAI_MODEL_READINESS_PROMPT,
  startWebChessBridge,
  type CodexPackageAttestor,
  type OpenClawAgentAuthRuntime,
  type OpenClawBridgeApi,
  type OpenClawPluginRegistryRuntime,
  type SimpleCompletionRuntime,
  type WebChessBridge,
} from './bridge.js'

const roots: string[] = []
const TOKEN = 't'.repeat(43)
const AGENT_ID = 'researcher'
const AGENT_DIR = '/openclaw/agents/researcher/agent'
const AGENT_WORKSPACE_DIR = '/openclaw/workspaces/researcher'
const OPENAI_ACCOUNT_MODEL_BASE_URL =
  'https://chatgpt.com/backend-api/codex'
const OPENAI_CODEX_AUTH_CLAIM = 'https://api.openai.com/auth'
const TEST_ENVIRONMENT: NodeJS.ProcessEnv = { NODE_ENV: 'test' }
const ADDITIONAL_CODEX_PROXY_CA_ENVIRONMENT_NAMES = [
  'ALL_PROXY',
  'all_proxy',
  'BUNDLE_HTTP_PROXY',
  'BUNDLE_HTTPS_PROXY',
  'BUNDLE_NO_PROXY',
  'BUNDLE_SSL_CA_CERT',
  'BUN_OPTIONS',
  'CODEX_CA_CERTIFICATE',
  'CODEX_EXEC_SERVER_NOISE_CHATGPT_ACCOUNT_ID',
  'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
  'CODEX_NETWORK_ALLOW_LOCAL_BINDING',
  'CODEX_NETWORK_PROXY_ACTIVE',
  'CODEX_NETWORK_PROXY_ATTRIBUTION',
  'CODEX_NETWORK_PROXY_BROKERED_CREDENTIALS',
  'CODEX_NETWORK_PROXY_CREDENTIAL_BROKER_ACTIVE',
  'CODEX_ROLLOUT_TRACE_ROOT',
  'CODEX_SANDBOX',
  'CURL_CA_BUNDLE',
  'DOCKER_HTTP_PROXY',
  'DOCKER_HTTPS_PROXY',
  'DYLD_INSERT_LIBRARIES',
  'ELECTRON_GET_USE_PROXY',
  'FTP_PROXY',
  'ftp_proxy',
  'GIT_SSL_CAINFO',
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'LD_PRELOAD',
  'NODE_DEBUG',
  'NODE_DEBUG_NATIVE',
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_USE_BUNDLED_CA',
  'NODE_USE_ENV_PROXY',
  'NODE_USE_OPENSSL_CA',
  'NODE_USE_SYSTEM_CA',
  'NO_PROXY',
  'no_proxy',
  'NPM_CONFIG_CAFILE',
  'NPM_CONFIG_HTTP_PROXY',
  'NPM_CONFIG_HTTPS_PROXY',
  'NPM_CONFIG_NOPROXY',
  'NPM_CONFIG_PROXY',
  'npm_config_cafile',
  'npm_config_http_proxy',
  'npm_config_https_proxy',
  'npm_config_noproxy',
  'npm_config_proxy',
  'OPENAI_API_BASE',
  'OPENAI_BASE_URL',
  'OPENAI_CUSTOM_HEADERS',
  'OPENAI_LOG',
  'OPENAI_ORGANIZATION',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT',
  'OPENAI_PROJECT_ID',
  'OPENCLAW_BUILD_PRIVATE_QA',
  'OPENCLAW_DEBUG_PROXY_BLOB_DIR',
  'OPENCLAW_DEBUG_PROXY_CERT_DIR',
  'OPENCLAW_DEBUG_PROXY_DB_PATH',
  'OPENCLAW_DEBUG_PROXY_ENABLED',
  'OPENCLAW_DEBUG_PROXY_REQUIRE',
  'OPENCLAW_DEBUG_PROXY_SESSION_ID',
  'OPENCLAW_DEBUG_PROXY_URL',
  'OPENCLAW_ENABLE_PRIVATE_QA_CLI',
  'OPENCLAW_NODE_EXTRA_CA_CERTS_READY',
  'OPENCLAW_QA_FORCE_RUNTIME',
  'OPENSSL_CONF',
  'PIP_PROXY',
  'REQUESTS_CA_BUNDLE',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SSLKEYLOGFILE',
  'WSS_PROXY',
  'wss_proxy',
  'YARN_HTTP_PROXY',
  'YARN_NO_PROXY',
  '__CODEX_SNAPSHOT_OVERRIDE',
  '__CODEX_SNAPSHOT_PROXY_OVERRIDE',
] as const

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function oauthAccessJwt(
  accountId = 'account-fixture',
  rotation = 'fixture',
  subject: string | null = 'user-fixture',
): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return [
    encode({ alg: 'RS256', typ: 'JWT' }),
    encode({
      [OPENAI_CODEX_AUTH_CLAIM]: {
        chatgpt_account_id: accountId,
        ...(subject === null ? {} : { chatgpt_account_user_id: subject }),
      },
      jti: rotation,
    }),
    // Synthetic signature bytes exercise local claim extraction only; OpenAI
    // validates signatures on real OAuth tokens.
    Buffer.from(`signature-${rotation}`, 'utf8').toString('base64url'),
  ].join('.')
}

function preparedAuthInspector(
  sentinels: Readonly<Record<string, string>> = {},
): PreparedAuthAccountInspector {
  return {
    resolveIdentity: vi.fn(async (value) => {
      if (typeof value !== 'string') return null
      return resolveOpenAiCodexAccessTokenIdentity(sentinels[value] ?? value)
    }),
  }
}

async function runtimeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'webchess-bridge-test-'))
  roots.push(root)
  return root
}

function fakeApi(
  webSearch: OpenClawBridgeApi['runtime']['webSearch']['search'] = vi.fn(),
): OpenClawBridgeApi {
  const provider = {
    createTool: vi.fn(() => ({
      execute: vi.fn(async ({ query }, executionContext) => {
        if (query === CODEX_SEARCH_READINESS_QUERY) {
          return {
            content: 'grounded readiness result',
            externalContent: {
              provider: 'codex',
              source: 'web_search',
              untrusted: true,
              wrapped: true,
            },
            model: 'gpt-5.6-sol',
            provider: 'codex',
            query,
            searches: [{ query }],
            tookMs: 1,
          }
        }
        const response = await webSearch({
          agentDir: AGENT_DIR,
          args: { count: 4, limit: 4, query },
          config: api.config,
          preferInputConfig: true,
          providerId: 'codex',
          signal: executionContext?.signal ?? new AbortController().signal,
        })
        return response.result
      }),
    })),
    envVars: [] as string[],
    id: 'codex',
    onboardingScopes: ['text-inference'],
    pluginId: 'codex',
    requiresCredential: false,
  }
  const api = {
    config: {
      auth: { order: { openai: ['openai:account'] } },
      agents: {
        defaults: { model: { primary: 'openai/gpt-5.6-sol' } },
        list: [{ id: 'researcher', default: true }],
      },
      plugins: { allow: ['codex', 'webchess'] },
      tools: {
        web: {
          search: {
            enabled: true,
            openaiCodex: { enabled: true },
            provider: 'codex',
          },
        },
      },
    },
    runtime: {
      config: {
        current: vi.fn(),
      },
      version: '2026.7.1-2',
      modelAuth: {
        resolveApiKeyForProvider: vi.fn(async () => ({
          mode: 'oauth' as const,
          profileId: 'openai:account',
          source: 'profile:openai:account',
        })),
      },
      webSearch: {
        listProviders: vi.fn(() => [provider]),
        search: webSearch,
      },
    },
  } satisfies OpenClawBridgeApi
  api.runtime.config.current.mockImplementation(() => api.config)
  return api
}

function simpleRuntime(
  complete: SimpleCompletionRuntime['completeWithPreparedSimpleCompletionModel'] =
    vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'stop' as const,
    })),
): SimpleCompletionRuntime {
  return {
    completeWithPreparedSimpleCompletionModel: vi.fn(async (params) => {
      if (params.context.messages[0]?.content === OPENAI_MODEL_READINESS_PROMPT) {
        return {
          content: [{ type: 'text', text: 'WEBCHESS_READY' }],
          stopReason: 'stop' as const,
        }
      }
      return complete(params)
    }),
    prepareSimpleCompletionModelForAgent: vi.fn(async () => ({
      auth: {
        apiKey: oauthAccessJwt(),
        mode: 'oauth' as const,
        profileId: 'openai:account',
        source: 'profile:openai:account',
      },
      model: {
        api: 'openai-chatgpt-responses',
        baseUrl: OPENAI_ACCOUNT_MODEL_BASE_URL,
        id: 'gpt-5.6-sol',
        maxTokens: 128_000,
        provider: 'openai',
      },
      selection: { provider: 'openai', modelId: 'gpt-5.6-sol' },
    })),
  }
}

function agentAuthRuntime(
  effectiveOrder: string[] = ['openai:account'],
): OpenClawAgentAuthRuntime {
  return {
    loadAuthProfileStoreForSecretsRuntime: vi.fn(() => ({
      order: { openai: effectiveOrder },
      profiles: {
        'openai:account': {
          access: oauthAccessJwt(),
          accountId: 'account-fixture',
          email: 'researcher@example.invalid',
          provider: 'openai',
          type: 'oauth',
        },
      },
      version: 1,
    })),
    resolveAuthProfileOrder: vi.fn(({ store }) =>
      store.order?.openai ?? []),
    resolveAgentDir: vi.fn(() => AGENT_DIR),
    resolveAgentWorkspaceDir: vi.fn(() => AGENT_WORKSPACE_DIR),
    resolveDefaultAgentId: vi.fn(() => AGENT_ID),
  }
}

function mutableAgentAuthRuntime(
  source: { credential: Record<string, unknown> },
): OpenClawAgentAuthRuntime {
  const runtime = agentAuthRuntime()
  runtime.loadAuthProfileStoreForSecretsRuntime = vi.fn(() => ({
    order: { openai: ['openai:account'] },
    profiles: { 'openai:account': source.credential },
    version: 1,
  }))
  return runtime
}

function pluginRegistryRuntime(
  api: OpenClawBridgeApi,
): OpenClawPluginRegistryRuntime {
  let listed: ReturnType<OpenClawBridgeApi['runtime']['webSearch']['listProviders']>
  try {
    listed = api.runtime.webSearch.listProviders()
  } catch {
    listed = []
  }
  const provider = listed[0] ?? {
    createTool: vi.fn(() => null),
    envVars: [],
    id: 'codex',
    onboardingScopes: ['text-inference'],
    pluginId: 'codex',
    requiresCredential: false,
  }
  vi.mocked(api.runtime.webSearch.listProviders).mockClear()
  const source = '/official/@openclaw/codex/dist/index.js'
  const rootDir = '/official/@openclaw/codex'
  const record = {
    enabled: true,
    id: 'codex',
    origin: 'global',
    packageName: '@openclaw/codex',
    rootDir,
    source,
    status: 'loaded',
    trustedOfficialInstall: true,
    version: '2026.7.1-1',
    webSearchProviderIds: ['codex'],
  }
  const registry = {
    plugins: [record],
    webSearchProviders: [{
      pluginId: 'codex',
      provider,
      rootDir,
      source,
    }],
  }
  return { getGlobalPluginRegistry: vi.fn(() => registry) }
}

function codexPackageAttestor(api: OpenClawBridgeApi): CodexPackageAttestor {
  return vi.fn(async () => ({
    async executeSearch(
      params: Parameters<CodexPackageAttestation['executeSearch']>[0],
    ) {
      const provider = api.runtime.webSearch.listProviders()[0]
      const tool = provider?.createTool({
        agentDir: params.agentDir,
        config: params.config,
        searchConfig: params.searchConfig,
      })
      if (!tool) throw new Error('test provider unavailable')
      return await tool.execute(
        { query: params.query },
        { signal: params.signal },
      )
    },
    revalidate: vi.fn(async () => true),
  }))
}

async function start(
  api: OpenClawBridgeApi,
  options: Parameters<typeof startWebChessBridge>[2] = {},
): Promise<WebChessBridge> {
  return startWebChessBridge(api, await runtimeRoot(), {
    agentAuthRuntime: agentAuthRuntime(),
    codexPackageAttestor: codexPackageAttestor(api),
    environment: TEST_ENVIRONMENT,
    pluginRegistryRuntime: pluginRegistryRuntime(api),
    preparedAuthAccountInspector: preparedAuthInspector(),
    token: TOKEN,
    simpleCompletionRuntime: simpleRuntime(),
    ...options,
  })
}

async function captureStartFailure(
  api: OpenClawBridgeApi,
  options: Parameters<typeof startWebChessBridge>[2] = {},
): Promise<Error> {
  const failure = await start(api, options).then(
    async (bridge) => {
      await bridge.close()
      return null
    },
    (error: unknown) => error,
  )
  expect(failure).toBeInstanceOf(Error)
  return failure as Error
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
  it('uses one OpenClaw-resolved agent identity and exposes sanitized readiness', async () => {
    const api = fakeApi()
    const authRuntime = agentAuthRuntime()
    const bridge = await start(api, { agentAuthRuntime: authRuntime })
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
        search: {
          available: true,
          checked: 'live-readiness-probe',
          configurationReady: true,
          oauthReady: true,
          provider: 'codex',
          providerReady: true,
          queryExecuted: true,
          requiredForLaunch: true,
        },
        transport: 'local',
        version: '2026.7.1-2',
      })
      expect(api.runtime.modelAuth.resolveApiKeyForProvider)
        .toHaveBeenCalledWith({
          agentDir: AGENT_DIR,
          cfg: api.runtime.config.current(),
          lockedProfile: true,
          modelApi: 'openai-chatgpt-responses',
          profileId: 'openai:account',
          provider: 'openai',
        })
      expect(authRuntime.resolveDefaultAgentId).toHaveBeenCalledWith(api.config)
      expect(authRuntime.resolveAgentDir).toHaveBeenCalledWith(
        api.config,
        AGENT_ID,
        TEST_ENVIRONMENT,
      )
      expect(authRuntime.resolveAgentWorkspaceDir).toHaveBeenCalledWith(
        api.config,
        AGENT_ID,
        TEST_ENVIRONMENT,
      )
    } finally {
      await bridge.close()
    }
  })

  it('uses the live runtime config instead of a divergent registration snapshot', async () => {
    const api = fakeApi()
    const liveConfig = structuredClone(api.config)
    api.config.plugins = {
      allow: ['codex', 'webchess'],
      entries: {
        codex: {
          config: {
            appServer: { command: '/registration-only/fake-codex' },
          },
        },
      },
    }
    vi.mocked(api.runtime.config.current).mockReturnValue(liveConfig)

    const bridge = await start(api)
    await bridge.close()
    expect(api.runtime.config.current()).toBe(liveConfig)
  })

  it.each([
    ['custom command', { command: '/live/fake-codex' }],
    ['custom transport', { transport: 'websocket' }],
  ])('rejects a divergent live runtime %s despite a safe registration config', async (
    _label,
    appServer,
  ) => {
    const api = fakeApi()
    const liveConfig = structuredClone(api.config)
    liveConfig.plugins = {
      allow: ['codex', 'webchess'],
      entries: { codex: { config: { appServer } } },
    }
    vi.mocked(api.runtime.config.current).mockReturnValue(liveConfig)

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/managed app-server/u)
    expect(failure.message).not.toContain('/live/fake-codex')
  })

  it('fails launch readiness before listening when model/auth preparation fails', async () => {
    const runtime = simpleRuntime()
    runtime.prepareSimpleCompletionModelForAgent = vi.fn(async () => ({
      error: 'private authentication detail',
    }))
    await expect(start(fakeApi(), {
      simpleCompletionRuntime: runtime,
    })).rejects.toThrow(/OpenAI account OAuth profile/u)
  })

  it('sanitizes rejected model and authentication preparation', async () => {
    const runtime = simpleRuntime()
    runtime.prepareSimpleCompletionModelForAgent = vi.fn(async () => {
      throw new Error('private auth-store path and provider diagnostic')
    })

    const failure = await captureStartFailure(fakeApi(), {
      simpleCompletionRuntime: runtime,
    })

    expect(failure.message).toMatch(/OpenAI account OAuth profile/u)
    expect(failure.message).not.toContain('private auth-store')
    expect(failure.message).not.toContain('provider diagnostic')
  })

  it('fails launch readiness when the Codex Hosted Search provider is absent', async () => {
    const api = fakeApi()
    api.runtime.webSearch.listProviders = vi.fn(() => [])

    const failure = await captureStartFailure(api)

    expect(failure.message).toBe(
      'OpenClaw needs the codex plugin installed and enabled before WebChess can launch. Install or enable the codex plugin, then relaunch WebChess.',
    )
    expect(api.runtime.webSearch.listProviders).toHaveBeenCalledWith({
      config: expect.any(Object),
    })
  })

  it('rejects a codex-named Hosted Search provider owned by another plugin', async () => {
    const api = fakeApi()
    api.runtime.webSearch.listProviders = vi.fn(() => [{
      createTool: vi.fn(() => ({ execute: vi.fn() })),
      envVars: [],
      id: 'codex',
      onboardingScopes: ['text-inference'],
      pluginId: 'third-party-lookalike',
      requiresCredential: false,
    }])

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/exact official @openclaw\/codex/u)
  })

  it('rejects a same-id fake plugin record before package use', async () => {
    const api = fakeApi()
    const registryRuntime = pluginRegistryRuntime(api)
    const registry = registryRuntime.getGlobalPluginRegistry()
    expect(registry).not.toBeNull()
    registry!.plugins[0]!.origin = 'workspace'
    registry!.plugins[0]!.trustedOfficialInstall = false
    const attestor = codexPackageAttestor(api)

    const failure = await captureStartFailure(api, {
      codexPackageAttestor: attestor,
      pluginRegistryRuntime: registryRuntime,
    })

    expect(failure.message).toMatch(/exact official @openclaw\/codex/u)
    expect(attestor).not.toHaveBeenCalled()
  })

  it('rejects a provider when its executable attestation fails', async () => {
    const api = fakeApi()
    const attestor: CodexPackageAttestor = vi.fn(async () => null)

    const failure = await captureStartFailure(api, {
      codexPackageAttestor: attestor,
    })

    expect(failure.message).toMatch(/reviewed @openai\/codex 0\.144\.3/u)
  })

  it('sanitizes Hosted Search provider discovery failures', async () => {
    const api = fakeApi()
    api.runtime.webSearch.listProviders = vi.fn(() => {
      throw new Error('private discovery path and credential detail')
    })

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/exact official @openclaw\/codex/u)
    expect(failure.message).not.toContain('private discovery')
    expect(failure.message).not.toContain('credential detail')
  })

  it('rejects an official provider whose effective tool is unavailable', async () => {
    const api = fakeApi()
    const provider = api.runtime.webSearch.listProviders()[0]
    expect(provider).toBeDefined()
    provider!.createTool = vi.fn(() => null)
    api.runtime.webSearch.listProviders = vi.fn(() => [provider!])

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/readiness probe/u)
    expect(provider!.createTool).toHaveBeenCalledWith({
      agentDir: AGENT_DIR,
      config: expect.any(Object),
      searchConfig: api.config.tools?.web?.search,
    })
  })

  it('runs one fixed Hosted Search readiness probe per bridge launch', async () => {
    const api = fakeApi()
    const execute = vi.fn(async ({ query }) => ({
      content: 'grounded readiness result',
      externalContent: {
        provider: 'codex',
        source: 'web_search',
        untrusted: true,
        wrapped: true,
      },
      model: 'gpt-5.6-sol',
      provider: 'codex',
      query,
      searches: [{ query }],
      tookMs: 1,
    }))
    const provider = {
      createTool: vi.fn(() => ({ execute })),
      envVars: [] as string[],
      id: 'codex',
      onboardingScopes: ['text-inference'],
      pluginId: 'codex',
      requiresCredential: false,
    }
    api.runtime.webSearch.listProviders = vi.fn(() => [provider])

    const bridge = await start(api)
    try {
      const first = await fetch(`${bridge.url}/v1/status`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      const second = await fetch(`${bridge.url}/v1/status`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(execute).toHaveBeenCalledTimes(1)
      expect(execute).toHaveBeenCalledWith(
        { query: CODEX_SEARCH_READINESS_QUERY },
        { signal: expect.any(AbortSignal) },
      )
      expect(await first.json()).toMatchObject({
        search: {
          available: true,
          checked: 'live-readiness-probe',
          queryExecuted: true,
          requiredForLaunch: true,
        },
      })
    } finally {
      await bridge.close()
    }
  })

  it.each([
    ['execution failure', async () => {
      throw new Error('private provider failure')
    }],
    ['invalid provider output', async () => ({
      content: 'private malformed output',
      provider: 'lookalike',
    })],
  ])('fails launch on a sanitized Hosted Search probe %s', async (
    _label,
    execute,
  ) => {
    const api = fakeApi()
    const provider = api.runtime.webSearch.listProviders()[0]
    expect(provider).toBeDefined()
    provider!.createTool = vi.fn(() => ({ execute: vi.fn(execute) }))
    api.runtime.webSearch.listProviders = vi.fn(() => [provider!])

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/one-time authenticated Codex Hosted Search readiness probe/u)
    expect(failure.message).not.toContain('private')
  })

  it('bounds the Hosted Search readiness probe timeout', async () => {
    const api = fakeApi()
    const provider = api.runtime.webSearch.listProviders()[0]
    expect(provider).toBeDefined()
    let cleanupSettled = false
    provider!.createTool = vi.fn(() => ({
      execute: vi.fn(async (_args, context) => await new Promise((resolve) => {
        context?.signal?.addEventListener('abort', () => {
          resolve(null)
          setTimeout(() => {
            cleanupSettled = true
          }, 20)
        }, { once: true })
      })),
    }))
    api.runtime.webSearch.listProviders = vi.fn(() => [provider!])

    const failure = await captureStartFailure(api, {
      readinessProbeTimeoutMs: 5,
    })

    expect(failure.message).toMatch(/one-time authenticated Codex Hosted Search readiness probe/u)
    expect(cleanupSettled).toBe(true)
  })

  it('runs one fixed model readiness completion per bridge launch', async () => {
    const runtime = simpleRuntime()
    const bridge = await start(fakeApi(), { simpleCompletionRuntime: runtime })
    try {
      await fetch(`${bridge.url}/v1/status`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      await fetch(`${bridge.url}/v1/status`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })

      const completion = vi.mocked(
        runtime.completeWithPreparedSimpleCompletionModel,
      )
      const readinessCalls = completion.mock.calls.filter(([params]) =>
        params.context.messages[0]?.content === OPENAI_MODEL_READINESS_PROMPT)
      expect(readinessCalls).toHaveLength(1)
      expect(readinessCalls[0]?.[0]).toMatchObject({
        context: {
          messages: [{ content: OPENAI_MODEL_READINESS_PROMPT }],
        },
        options: { maxTokens: 16, reasoning: 'low' },
      })
    } finally {
      await bridge.close()
    }
  })

  it.each([
    ['execution failure', async () => {
      throw new Error('private model failure')
    }],
    ['wrong exact output', async () => ({
      content: [{ type: 'text', text: 'private-wrong-output' }],
      stopReason: 'stop' as const,
    })],
    ['non-success terminal', async () => ({
      content: [{ type: 'text', text: 'WEBCHESS_READY' }],
      stopReason: 'length' as const,
    })],
  ])('fails launch on a sanitized model readiness probe %s', async (
    _label,
    complete,
  ) => {
    const runtime = simpleRuntime()
    runtime.completeWithPreparedSimpleCompletionModel = vi.fn(complete)

    const failure = await captureStartFailure(fakeApi(), {
      simpleCompletionRuntime: runtime,
    })

    expect(failure.message).toMatch(/one-time authenticated OpenAI model readiness probe/u)
    expect(failure.message).not.toContain('private')
  })

  it('bounds the model readiness probe timeout', async () => {
    const runtime = simpleRuntime()
    runtime.completeWithPreparedSimpleCompletionModel = vi.fn(
      async () => await new Promise<never>(() => {}),
    )

    const failure = await captureStartFailure(fakeApi(), {
      readinessProbeTimeoutMs: 5,
      simpleCompletionRuntime: runtime,
    })

    expect(failure.message).toMatch(/one-time authenticated OpenAI model readiness probe/u)
  })

  it.each([
    ['managed search disabled', { enabled: false, provider: 'codex' }],
    [
      'Codex Hosted Search disabled',
      { enabled: true, openaiCodex: { enabled: false }, provider: 'codex' },
    ],
    [
      'another search provider selected',
      { enabled: true, openaiCodex: { enabled: true }, provider: 'brave' },
    ],
    [
      'no search provider selected',
      { enabled: true, openaiCodex: { enabled: true } },
    ],
  ])('rejects incompatible search config: %s', async (_label, search) => {
    const api = fakeApi()
    api.config.tools = { web: { search } }

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/provider set to codex/u)
    expect(api.runtime.webSearch.listProviders).not.toHaveBeenCalled()
  })

  it.each([
    ['top-level API key', { apiKey: 'private-search-key', provider: 'codex' }],
    ['result-count override', { maxResults: 7, provider: 'codex' }],
    [
      'Codex mode override',
      { openaiCodex: { enabled: true, mode: 'live' }, provider: 'codex' },
    ],
    [
      'Codex domain override',
      {
        openaiCodex: {
          allowedDomains: ['private.example.invalid'],
          enabled: true,
        },
        provider: 'codex',
      },
    ],
    [
      'Codex context override',
      {
        openaiCodex: { contextSize: 'high', enabled: true },
        provider: 'codex',
      },
    ],
    [
      'undisclosed location override',
      {
        openaiCodex: {
          enabled: true,
          userLocation: { city: 'private-city' },
        },
        provider: 'codex',
      },
    ],
    [
      'provider-specific nested credential config',
      { brave: { apiKey: 'private-nested-key' }, provider: 'codex' },
    ],
  ])('rejects a Hosted Search override surface: %s', async (
    _label,
    search,
  ) => {
    const api = fakeApi()
    api.config.tools = { web: { search: search as never } }

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/provider set to codex/u)
    expect(failure.message).not.toContain('private-')
    expect(api.runtime.webSearch.listProviders).not.toHaveBeenCalled()
  })

  it.each([
    [
      'user-home native authentication',
      { homeScope: 'user' },
      TEST_ENVIRONMENT,
    ],
    [
      'websocket transport and token',
      {
        authToken: 'private-websocket-token',
        transport: 'websocket',
        url: 'wss://private.example.invalid/codex',
      },
      TEST_ENVIRONMENT,
    ],
    [
      'custom command',
      { command: '/private/custom/codex' },
      TEST_ENVIRONMENT,
    ],
    [
      'custom arguments',
      { args: ['app-server', '--custom'] },
      TEST_ENVIRONMENT,
    ],
    [
      'custom headers',
      { headers: { Authorization: 'private-header-token' } },
      TEST_ENVIRONMENT,
    ],
    [
      'environment command',
      {},
      {
        NODE_ENV: 'test' as const,
        OPENCLAW_CODEX_APP_SERVER_BIN: '/private/environment/codex',
      },
    ],
    [
      'environment arguments',
      {},
      {
        NODE_ENV: 'test' as const,
        OPENCLAW_CODEX_APP_SERVER_ARGS: 'app-server --custom',
      },
    ],
  ])('rejects a non-managed Codex app-server at launch: %s', async (
    _label,
    appServer,
    environment,
  ) => {
    const api = fakeApi()
    api.config.plugins = {
      allow: ['codex', 'webchess'],
      entries: { codex: { config: { appServer } } },
    }

    const failure = await captureStartFailure(api, { environment })

    expect(failure.message).toMatch(/managed app-server/u)
    expect(failure.message).toMatch(/private stdio, agent-scoped/u)
    expect(failure.message).not.toContain('private-websocket-token')
    expect(failure.message).not.toContain('/private/')
    expect(api.runtime.webSearch.listProviders).not.toHaveBeenCalled()
  })

  it('accepts explicit safe defaults for the managed Codex app-server', async () => {
    const api = fakeApi()
    api.config.plugins = {
      allow: ['codex', 'webchess'],
      entries: {
        codex: {
          config: {
            appServer: {
              args: [],
              authToken: '',
              command: '',
              headers: {},
              homeScope: 'agent',
              transport: 'stdio',
              url: '',
            },
          },
        },
      },
    }

    const bridge = await start(api)
    await bridge.close()
  })

  it.each([
    ['missing allowlist', {}],
    ['extra allowed plugin', { allow: ['codex', 'webchess', 'private'] }],
    ['duplicate allowed plugin', { allow: ['codex', 'codex'] }],
    [
      'custom plugin load path',
      { allow: ['codex', 'webchess'], load: { paths: ['/private/plugin'] } },
    ],
    [
      'additional plugin entry',
      {
        allow: ['codex', 'webchess'],
        entries: { codex: {}, private: {} },
      },
    ],
  ])('rejects an unsafe dedicated-profile plugin config: %s', async (
    _label,
    plugins,
  ) => {
    const api = fakeApi()
    api.config.plugins = plugins as never

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/plugins\.allow/u)
    expect(failure.message).not.toContain('/private/')
    expect(api.runtime.webSearch.listProviders).not.toHaveBeenCalled()
  })

  it('accepts the exact plugin allowlist in either order', async () => {
    const api = fakeApi()
    api.config.plugins = { allow: ['webchess', 'codex'] }
    const bridge = await start(api)
    await bridge.close()
  })

  it.each([
    ['AMQP_URL', 'amqps://private.invalid'],
    ['ANTHROPIC_ADMIN_KEY', 'provider-secret'],
    ['AUTH_TOKEN', 'provider-secret'],
    ['AWS_ACCESS_KEY_ID', 'provider-secret'],
    ['AWS_BEARER_TOKEN_BEDROCK', 'provider-secret'],
    ['AWS_CONFIG_FILE', '/private/aws-config'],
    ['AWS_CONTAINER_AUTHORIZATION_TOKEN', 'provider-secret'],
    ['AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE', '/private/aws-token'],
    ['AWS_CONTAINER_CREDENTIALS_FULL_URI', 'http://private.invalid'],
    ['AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', '/private-credentials'],
    ['AWS_PROFILE', 'private-profile'],
    ['AWS_SECURITY_TOKEN', 'provider-secret'],
    ['AWS_SECRET_ACCESS_KEY', 'provider-secret'],
    ['AWS_SHARED_CREDENTIALS_FILE', '/private/aws-credentials'],
    ['AWS_SESSION_TOKEN', 'provider-secret'],
    ['AWS_WEB_IDENTITY_TOKEN_FILE', '/private/aws-token'],
    ['AZURE_CLIENT_SECRET', 'provider-secret'],
    ['AZURE_AUTH_LOCATION', '/private/azure-auth'],
    ['AZURE_SPEECH_KEY', 'provider-secret'],
    ['COPILOT_GITHUB_TOKEN', 'provider-secret'],
    ['CLAUDE_AI_SESSION_KEY', 'provider-secret'],
    ['CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR', '7'],
    ['CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', '8'],
    ['CLAUDE_WEB_COOKIE', 'provider-secret'],
    ['CLAUDE_WEB_SESSION_KEY', 'provider-secret'],
    ['DISCORD_BOT_TOKEN', 'provider-secret'],
    ['FAL_KEY', 'provider-secret'],
    ['GH_TOKEN', 'provider-secret'],
    ['GITHUB_TOKEN', 'provider-secret'],
    ['OPENAI_API_KEY', 'provider-secret'],
    ['OPENAI_API_KEY', '   '],
    ['OPENAI_API_KEYS', 'provider-secret'],
    ['OPENAI_API_KEY_', 'provider-secret'],
    ['OPENAI_API_KEY_PRIMARY', 'provider-secret'],
    ['OPENAI_ADMIN_KEY', 'provider-secret'],
    ['OPENAI_WEBHOOK_SECRET', 'provider-secret'],
    ['CODEX_API_KEY', 'provider-secret'],
    ['GOOGLE_APPLICATION_CREDENTIALS', 'provider-secret'],
    ['HF_TOKEN', 'provider-secret'],
    ['HUGGINGFACE_HUB_TOKEN', 'provider-secret'],
    ['MINIMAX_CODE_PLAN_KEY', 'provider-secret'],
    ['KUBECONFIG', '/private/kubeconfig'],
    ['MSTEAMS_CERTIFICATE_PATH', '/private/client-certificate'],
    ['MONGODB_URI', 'mongodb://private.invalid'],
    ['NOSTR_PRIVATE_KEY', 'provider-secret'],
    ['THIRD_PARTY_API_KEY', 'provider-secret'],
    ['THIRD_PARTY_API_TOKEN', 'provider-secret'],
    ['OPENAI_ACCESS_TOKEN', 'provider-secret'],
    ['OPENAI_TOKEN', 'provider-secret'],
    ['OPENAI_OAUTH_TOKEN', 'provider-secret'],
    ['OPENCLAW_APNS_PRIVATE_KEY', 'provider-secret'],
    ['OPENCLAW_APNS_PRIVATE_KEY_P8', 'provider-secret'],
    ['OPENCLAW_APNS_PRIVATE_KEY_PATH', '/private/apns-key'],
    ['OPENCLAW_AUTH_PROFILE_SECRET_KEY', 'provider-secret'],
    ['OPENCLAW_BROWSER_CDP_AUTH_TOKEN', 'provider-secret'],
    ['OPENCLAW_BROWSER_NOVNC_PASSWORD', 'provider-secret'],
    ['OPENCLAW_CLAWHUB_TOKEN', 'provider-secret'],
    ['OPENCLAW_GATEWAY_TOKEN', 'provider-secret'],
    ['OPENCLAW_LIVE_OPENAI_KEY', 'provider-secret'],
    ['OPENCLAW_LIVE_OPENAI_KEYS', 'provider-secret'],
    ['OPENCLAW_MCP_TOKEN', 'provider-secret'],
    ['OPENCLAW_SECRET_SENTINELS', 'off'],
    ['OPENCLAW_SECRET_SENTINELS', '0'],
    ['OPENCLAW_SECRET_SENTINELS', 'false'],
    ['OPENCLAW_SECRET_SENTINELS', '   '],
    ['oPeNcLaW_sEcReT_sEnTiNeLs', 'off'],
    ['OPENCLAW_VAPID_PRIVATE_KEY', 'provider-secret'],
    ['OPENCLAW_SHOW_SECRETS', '1'],
    ['LINE_CHANNEL_ACCESS_TOKEN', 'provider-secret'],
    ['NGROK_AUTHTOKEN', 'provider-secret'],
    ['RUNWAYML_API_SECRET', 'provider-secret'],
    ['REDIS_URL', 'rediss://private.invalid'],
    ['SPEECH_KEY', 'provider-secret'],
    ['THIRD_PARTY_ACCESS_TOKEN', 'provider-secret'],
    ['THIRD_PARTY_OAUTH_TOKEN', 'provider-secret'],
    ['CODEX_ACCESS_TOKEN', 'provider-secret'],
    ['CODEX_TOKEN', 'provider-secret'],
    ['CODEX_OAUTH_TOKEN', 'provider-secret'],
    ['TELEGRAM_BOT_TOKEN', 'provider-secret'],
    ['SYNOLOGY_CHAT_INCOMING_URL', 'https://private.invalid/hook'],
    ['VOLCENGINE_TTS_TOKEN', 'provider-secret'],
    ['WEBCHESS_DELETION_HMAC_SECRET', 'local-only-hmac'],
    ['WEBCHESS_HMAC_SECRET', 'local-only-hmac'],
  ])('rejects a nonempty provider credential environment variable: %s', async (
    name,
    value,
  ) => {
    const api = fakeApi()

    const failure = await captureStartFailure(api, {
      environment: { NODE_ENV: 'test', [name]: value },
    })

    expect(failure.message).toMatch(/refuses provider credential/u)
    expect(failure.message).not.toContain(value)
    expect(api.runtime.webSearch.listProviders).not.toHaveBeenCalled()
  })

  it.each([
    ['OPENAI_BASE_URL', 'https://private.example.invalid'],
    ['OPENAI_API_BASE', 'https://private.example.invalid/v1'],
    ['OPENAI_CUSTOM_HEADERS', '{"Authorization":"private-header"}'],
    ['OPENAI_ORG_ID', 'private-org'],
    ['OPENAI_PROJECT_ID', 'private-project'],
    ['OPENAI_LOG', 'private-log-level'],
    ['CODEX_CA_CERTIFICATE', '/private/codex-ca.pem'],
    ['NODE_EXTRA_CA_CERTS', '/private/ca.pem'],
    ['NODE_TLS_REJECT_UNAUTHORIZED', '0'],
    ['SSL_CERT_FILE', '/private/ca.pem'],
    ['SSL_CERT_DIR', '/private/ca'],
    ['OPENCLAW_DEBUG_PROXY_ENABLED', '1'],
    ['OPENCLAW_DEBUG_PROXY_REQUIRE', '1'],
    ['OPENCLAW_DEBUG_PROXY_URL', 'http://private-proxy.invalid'],
    ['OPENCLAW_DEBUG_PROXY_DB_PATH', '/private/proxy.db'],
    ['OPENCLAW_DEBUG_PROXY_BLOB_DIR', '/private/blobs'],
    ['OPENCLAW_DEBUG_PROXY_CERT_DIR', '/private/certificates'],
    ['OPENCLAW_DEBUG_PROXY_SESSION_ID', 'private-session'],
    ['OPENCLAW_ENABLE_PRIVATE_QA_CLI', '1'],
    ['OPENCLAW_BUILD_PRIVATE_QA', '1'],
    ['OPENCLAW_QA_FORCE_RUNTIME', 'codex'],
    ['OPENCLAW_DEBUG_MODEL_PAYLOAD', '1'],
    ['OPENCLAW_DEBUG_MODEL_PAYLOAD', '   '],
    ['oPeNcLaW_dEbUg_MoDeL_pAyLoAd', '1'],
    ['OPENCLAW_DEBUG_SSE', '1'],
    ['OPENCLAW_DEBUG_SSE', '   '],
    ['oPeNcLaW_dEbUg_SsE', '1'],
    ...ADDITIONAL_CODEX_PROXY_CA_ENVIRONMENT_NAMES.map((name) => [
      name,
      'private-transport-override',
    ] as const),
    ['CODEX_NETWORK_PROXY_FUTURE_OVERRIDE', '1'],
    ['CODEX_EXEC_SERVER_NOISE_CHATGPT_ACCOUNT_ID', '   '],
    ['cOdEx_ExEc_SeRvEr_NoIsE_cHaTgPt_AcCoUnT_iD', 'alternate-account'],
    ['CODEX_INTERNAL_ORIGINATOR_OVERRIDE', '   '],
    ['cOdEx_InTeRnAl_OrIgInAtOr_OvErRiDe', 'private-originator'],
    ['CODEX_ROLLOUT_TRACE_ROOT', '   '],
    ['cOdEx_RoLlOuT_tRaCe_RoOt', '/private/rollout-trace'],
    ['CODEX_SANDBOX', '   '],
    ['cOdEx_SaNdBoX', 'seatbelt'],
    ['HTTPS_PROXY', '   '],
    ['NoDe_UsE_EnV_PrOxY', '1'],
    ['OPENAI_ORGANIZATION', '   '],
    ['oPeNaI_OrGaNiZaTiOn', 'private-org'],
    ['OPENAI_PROJECT', '   '],
    ['oPeNaI_pRoJeCt', 'private-project'],
    ['SSL_CERT_FILE', '   '],
  ] as ReadonlyArray<readonly [string, string]>)(
    'rejects an ambient provider transport override: %s',
    async (name, value) => {
      const api = fakeApi()

      const failure = await captureStartFailure(api, {
        environment: { NODE_ENV: 'test', [name]: value },
      })

      if (name === 'CODEX_NETWORK_PROXY_BROKERED_CREDENTIALS') {
        expect(failure.message).toMatch(/refuses provider credential/u)
      } else {
        expect(failure.message).toMatch(/canonical OpenAI account endpoint/u)
      }
      expect(failure.message).not.toContain(value)
      expect(api.runtime.webSearch.listProviders).not.toHaveBeenCalled()
    },
  )

  it('accepts only exactly empty provider variables and enabled TLS verification', async () => {
    const bridge = await start(fakeApi(), {
      environment: {
        NODE_ENV: 'test',
        NODE_TLS_REJECT_UNAUTHORIZED: '1',
        HTTP_PROXY: '',
        NODE_EXTRA_CA_CERTS: '',
        OPENAI_API_KEY: '',
        OPENAI_BASE_URL: '',
        OPENAI_LOG: '',
        OPENCLAW_NODE_EXTRA_CA_CERTS_READY: '',
        SSL_CERT_FILE: '',
      },
    })

    await bridge.close()
  })

  it('accepts only OpenClaw\'s exact marked first-readable Linux system CA', async () => {
    const systemCa = [
      '/etc/ssl/certs/ca-certificates.crt',
      '/etc/pki/tls/certs/ca-bundle.crt',
      '/etc/ssl/ca-bundle.pem',
    ].find((candidate) => {
      try {
        accessSync(candidate, fsConstants.R_OK)
        return true
      } catch {
        return false
      }
    })
    if (!systemCa || process.platform !== 'linux') return

    const bridge = await start(fakeApi(), {
      environment: {
        NODE_ENV: 'test',
        NODE_EXTRA_CA_CERTS: systemCa,
        OPENCLAW_NODE_EXTRA_CA_CERTS_READY: '1',
      },
    })
    await bridge.close()

    for (const environment of [{
      NODE_EXTRA_CA_CERTS: '/private/custom-ca.pem',
      OPENCLAW_NODE_EXTRA_CA_CERTS_READY: '1',
    }, {
      NODE_EXTRA_CA_CERTS: ` ${systemCa}`,
      OPENCLAW_NODE_EXTRA_CA_CERTS_READY: '1',
    }, {
      NODE_EXTRA_CA_CERTS: systemCa,
      OPENCLAW_NODE_EXTRA_CA_CERTS_READY: ' 1',
    }, {
      NODE_EXTRA_CA_CERTS: '   ',
      OPENCLAW_NODE_EXTRA_CA_CERTS_READY: '1',
    }, {
      NODE_EXTRA_CA_CERTS: systemCa,
      OPENCLAW_NODE_EXTRA_CA_CERTS_READY: '0',
    }, {
      NODE_EXTRA_CA_CERTS: systemCa,
      OPENCLAW_NODE_EXTRA_CA_CERTS_READY: '   ',
    }, {
      OPENCLAW_NODE_EXTRA_CA_CERTS_READY: '1',
    }]) {
      const failure = await captureStartFailure(fakeApi(), {
        environment: { NODE_ENV: 'test', ...environment },
      })
      expect(failure.message).toMatch(/canonical OpenAI account endpoint/u)
    }
  })

  it('freezes live config and clears local secrets from the Codex child', async () => {
    const api = fakeApi()
    const provider = api.runtime.webSearch.listProviders()[0]
    expect(provider).toBeDefined()
    const originalCurrent = api.runtime.config.current
    const bridge = await start(api, {
      environment: {
        CODEX_NETWORK_PROXY_FUTURE_OVERRIDE: '',
        DATABASE_URL: 'postgresql://local-only',
        NODE_ENV: 'test',
        SSH_AUTH_SOCK: '/run/user/test/ssh-agent',
      },
    })
    try {
      const guarded = api.runtime.config.current()
      const clearEnv = guarded.plugins?.entries?.codex?.config?.appServer
        ?.clearEnv
      expect(Object.isFrozen(guarded)).toBe(true)
      expect(Object.isFrozen(clearEnv)).toBe(true)
      expect(clearEnv).toEqual(expect.arrayContaining([
        ...ADDITIONAL_CODEX_PROXY_CA_ENVIRONMENT_NAMES,
        'AMQP_URL',
        'AZURE_AUTH_LOCATION',
        'CLAUDE_AI_SESSION_KEY',
        'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
        'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
        'CLAUDE_WEB_COOKIE',
        'CLAUDE_WEB_SESSION_KEY',
        'CODEX_API_KEY',
        'CODEX_CA_CERTIFICATE',
        'CODEX_NETWORK_PROXY_FUTURE_OVERRIDE',
        'DATABASE_URL',
        'DISCORD_BOT_TOKEN',
        'LINE_CHANNEL_ACCESS_TOKEN',
        'KUBECONFIG',
        'MSTEAMS_CERTIFICATE_PATH',
        'MONGODB_URI',
        'NGROK_AUTHTOKEN',
        'NOSTR_PRIVATE_KEY',
        'OPENAI_API_KEY',
        'OPENCLAW_APNS_PRIVATE_KEY',
        'OPENCLAW_APNS_PRIVATE_KEY_P8',
        'OPENCLAW_APNS_PRIVATE_KEY_PATH',
        'OPENCLAW_AUTH_PROFILE_SECRET_KEY',
        'OPENCLAW_BROWSER_CDP_AUTH_TOKEN',
        'OPENCLAW_BROWSER_NOVNC_PASSWORD',
        'OPENCLAW_CLAWHUB_TOKEN',
        'OPENCLAW_DEBUG_MODEL_PAYLOAD',
        'OPENCLAW_DEBUG_SSE',
        'OPENCLAW_GATEWAY_TOKEN',
        'OPENCLAW_MCP_TOKEN',
        'OPENCLAW_CONFIG_PATH',
        'OPENCLAW_OAUTH_DIR',
        'OPENCLAW_PROFILE',
        'OPENCLAW_SECRET_SENTINELS',
        'OPENCLAW_STATE_DIR',
        'OPENCLAW_VAPID_PRIVATE_KEY',
        'REDIS_URL',
        'SSH_AUTH_SOCK',
        'TELEGRAM_BOT_TOKEN',
        'SYNOLOGY_CHAT_INCOMING_URL',
        'WEBCHESS_DELETION_HMAC_SECRET',
        'WEBCHESS_HMAC_SECRET',
      ]))
      expect(provider!.createTool).toHaveBeenCalledWith(expect.objectContaining({
        config: guarded,
      }))
    } finally {
      await bridge.close()
    }
    expect(api.runtime.config.current).toBe(originalCurrent)
    expect(api.runtime.config.current()).toBe(api.config)
  })

  it('requires the exact pinned OpenClaw runtime version at launch', async () => {
    const api = fakeApi()
    api.runtime.version = '2026.7.2-secret-marker'

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/pinned OpenClaw 2026\.7\.1-2 runtime/u)
    expect(failure.message).not.toContain('secret-marker')
    expect(api.runtime.webSearch.listProviders).not.toHaveBeenCalled()
  })

  it('does not return cached readiness after the runtime version drifts', async () => {
    const api = fakeApi()
    const bridge = await start(api)
    try {
      api.runtime.version = '2026.7.2-secret-marker'
      const response = await fetch(`${bridge.url}/v1/status`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      const body = JSON.stringify(await response.json())

      expect(response.status).toBe(503)
      expect(body).toContain('OPENCLAW_NOT_READY')
      expect(body).toContain('2026.7.1-2')
      expect(body).not.toContain('available')
      expect(body).not.toContain('secret-marker')
    } finally {
      await bridge.close()
    }
  })

  it.each([
    ['alternate provider', { anthropic: {} }],
    ['custom OpenAI base URL', {
      openai: { baseUrl: 'https://private.example.invalid' },
    }],
    ['custom OpenAI headers', {
      openai: { headers: { Authorization: 'private-header' } },
    }],
    ['custom OpenAI auth header', { openai: { authHeader: true } }],
    ['custom OpenAI request', { openai: { request: { proxy: 'private' } } }],
    ['custom OpenAI local service', { openai: { localService: {} } }],
    ['custom OpenAI model catalog', { openai: { models: [] } }],
    ['custom OpenAI API key', { openai: { apiKey: 'private-key' } }],
  ])('rejects a configured model-provider override: %s', async (
    _label,
    providers,
  ) => {
    const api = fakeApi()
    api.config.models = { providers: providers as never }

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/canonical OpenAI account endpoint/u)
    expect(failure.message).not.toContain('private')
    expect(api.runtime.webSearch.listProviders).not.toHaveBeenCalled()
  })

  it('accepts only an empty explicit OpenAI provider declaration', async () => {
    const api = fakeApi()
    api.config.models = { providers: { openai: {} } }
    const bridge = await start(api)
    await bridge.close()
  })

  it.each([
    ['default fallback', {
      defaults: {
        model: {
          fallbacks: ['anthropic/private-model'],
          primary: 'openai/gpt-5.6-sol',
        },
      },
      list: [{ default: true, id: AGENT_ID }],
    }],
    ['default params', {
      defaults: {
        model: { primary: 'openai/gpt-5.6-sol' },
        params: { baseURL: 'https://private.example.invalid' },
      },
      list: [{ default: true, id: AGENT_ID }],
    }],
    ['default agent runtime', {
      defaults: {
        agentRuntime: { id: 'private-runtime' },
        model: { primary: 'openai/gpt-5.6-sol' },
      },
      list: [{ default: true, id: AGENT_ID }],
    }],
    ['alternate default model declaration', {
      defaults: {
        model: { primary: 'openai/gpt-5.6-sol' },
        models: { 'anthropic/private-model': {} },
      },
      list: [{ default: true, id: AGENT_ID }],
    }],
    ['selected-agent fallback', {
      defaults: { model: { primary: 'openai/gpt-5.6-sol' } },
      list: [{
        default: true,
        id: AGENT_ID,
        model: {
          fallbacks: ['anthropic/private-model'],
          primary: 'openai/gpt-5.6-sol',
        },
      }],
    }],
    ['selected-agent provider', {
      defaults: { model: { primary: 'openai/gpt-5.6-sol' } },
      list: [{ default: true, id: AGENT_ID, model: 'other/private-model' }],
    }],
    ['selected-agent params', {
      defaults: { model: { primary: 'openai/gpt-5.6-sol' } },
      list: [{
        default: true,
        id: AGENT_ID,
        params: { headers: { Authorization: 'private-header' } },
      }],
    }],
    ['selected-agent runtime', {
      defaults: { model: { primary: 'openai/gpt-5.6-sol' } },
      list: [{ default: true, id: AGENT_ID, runtime: { id: 'private' } }],
    }],
  ])('rejects a dormant model or agent runtime override: %s', async (
    _label,
    agents,
  ) => {
    const api = fakeApi()
    api.config.agents = agents as never

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/canonical OpenAI account endpoint/u)
    expect(failure.message).not.toContain('private')
  })

  it('accepts an explicit OpenAI model string with no fallbacks', async () => {
    const api = fakeApi()
    api.config.agents = {
      defaults: { model: 'openai/gpt-5.6-sol' },
      list: [{ default: true, id: AGENT_ID }],
    }
    const bridge = await start(api)
    await bridge.close()
  })

  it('requires one exact ordered OpenAI OAuth profile for both paths', async () => {
    const api = fakeApi()
    api.config.auth = {
      order: { openai: ['openai:account', 'openai:key-backup'] },
    }

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/OpenAI account OAuth profile/u)
    expect(failure.message).toMatch(/API keys are not accepted/u)
    expect(api.runtime.modelAuth.resolveApiKeyForProvider).not.toHaveBeenCalled()
  })

  it('accepts an optional exact OpenAI OAuth config profile declaration', async () => {
    const api = fakeApi()
    api.config.auth = {
      order: { openai: ['openai:account'] },
      profiles: {
        'openai:account': { mode: 'oauth', provider: 'openai' },
      },
    }
    const bridge = await start(api)
    await bridge.close()
  })

  it('rejects a dormant key profile in OpenClaw config', async () => {
    const api = fakeApi()
    api.config.auth = {
      order: { openai: ['openai:account'] },
      profiles: {
        'openai:account': { mode: 'oauth', provider: 'openai' },
        'openai:private-backup': { mode: 'api_key', provider: 'openai' },
      },
    }

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/OpenAI account OAuth profile/u)
    expect(failure.message).not.toContain('private-backup')
  })

  it('rejects a dormant key profile in the per-agent secret store', async () => {
    const api = fakeApi()
    const authRuntime = agentAuthRuntime()
    authRuntime.loadAuthProfileStoreForSecretsRuntime = vi.fn(() => ({
      order: { openai: ['openai:account'] },
      profiles: {
        'openai:account': { provider: 'openai', type: 'oauth' },
        'openai:private-backup': { provider: 'openai', type: 'api_key' },
      },
      version: 1,
    }))

    const failure = await captureStartFailure(api, { agentAuthRuntime: authRuntime })

    expect(failure.message).toMatch(/OpenAI account OAuth profile/u)
    expect(failure.message).not.toContain('private-backup')
    expect(api.runtime.modelAuth.resolveApiKeyForProvider).not.toHaveBeenCalled()
  })

  it('rejects a per-agent auth-store order that overrides safe config order', async () => {
    const api = fakeApi()
    const authRuntime = agentAuthRuntime([
      'openai:key-backup',
      'openai:account',
    ])

    const failure = await captureStartFailure(api, {
      agentAuthRuntime: authRuntime,
    })

    expect(failure.message).toMatch(/OpenAI account OAuth profile/u)
    expect(failure.message).not.toContain('openai:key-backup')
    expect(authRuntime.loadAuthProfileStoreForSecretsRuntime)
      .toHaveBeenCalledWith(AGENT_DIR, {
        config: expect.any(Object),
        externalCliProviderIds: ['openai', 'codex-cli'],
      })
    expect(authRuntime.resolveAuthProfileOrder).toHaveBeenCalledWith({
      cfg: expect.any(Object),
      provider: 'openai',
      store: expect.any(Object),
    })
    expect(api.runtime.modelAuth.resolveApiKeyForProvider).not.toHaveBeenCalled()
  })

  it('sanitizes effective auth-store resolution failures', async () => {
    const api = fakeApi()
    const authRuntime = agentAuthRuntime()
    authRuntime.loadAuthProfileStoreForSecretsRuntime = vi.fn(() => {
      throw new Error('private agent path and auth profile detail')
    })

    const failure = await captureStartFailure(api, {
      agentAuthRuntime: authRuntime,
    })

    expect(failure.message).toMatch(/OpenAI account OAuth profile/u)
    expect(failure.message).not.toContain('private agent path')
    expect(failure.message).not.toContain('auth profile detail')
    expect(api.runtime.modelAuth.resolveApiKeyForProvider).not.toHaveBeenCalled()
  })

  it('rejects and sanitizes missing Hosted Search account authentication', async () => {
    const api = fakeApi()
    api.runtime.modelAuth.resolveApiKeyForProvider = vi.fn(async () => {
      throw new Error('private auth store path and secret resolver detail')
    })

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/OpenAI account OAuth profile/u)
    expect(failure.message).toMatch(/API keys are not accepted/u)
    expect(failure.message).not.toContain('private auth store')
  })

  it.each([
    ['non-OAuth mode', {
      mode: 'api-key' as const,
      profileId: 'openai:account',
      source: 'profile:openai:account',
    }],
    ['different profile', {
      mode: 'oauth' as const,
      profileId: 'openai:different',
      source: 'profile:openai:different',
    }],
    ['different source', {
      mode: 'oauth' as const,
      profileId: 'openai:account',
      source: 'profile:openai:different',
    }],
  ])('rejects Hosted Search auth resolved from a %s', async (
    _label,
    resolved,
  ) => {
    const api = fakeApi()
    api.runtime.modelAuth.resolveApiKeyForProvider = vi.fn(async () => resolved)

    const failure = await captureStartFailure(api)

    expect(failure.message).toMatch(/OpenAI account OAuth profile/u)
    expect(failure.message).toMatch(/API keys are not accepted/u)
  })

  it.each([
    [
      'an API-key-only inference profile',
      {
        auth: {
          mode: 'api-key' as const,
          profileId: 'openai:key-backup',
          source: 'profile:openai:key-backup',
        },
        model: {
          api: 'openai-chatgpt-responses',
          baseUrl: OPENAI_ACCOUNT_MODEL_BASE_URL,
          id: 'gpt-5.6-sol',
          provider: 'openai',
        },
        selection: { modelId: 'gpt-5.6-sol', provider: 'openai' },
      },
    ],
    [
      'a non-OpenAI inference provider',
      {
        auth: {
          mode: 'oauth' as const,
          profileId: 'other:account',
          source: 'profile:other:account',
        },
        model: {
          api: 'openai-chatgpt-responses',
          baseUrl: OPENAI_ACCOUNT_MODEL_BASE_URL,
          id: 'other-model',
          provider: 'other',
        },
        selection: { modelId: 'other-model', provider: 'other' },
      },
    ],
    [
      'an AWS credential fallback mode',
      {
        auth: {
          mode: 'aws-sdk' as const,
          profileId: 'aws:default',
          source: 'aws-sdk',
        },
        model: {
          api: 'openai-chatgpt-responses',
          baseUrl: OPENAI_ACCOUNT_MODEL_BASE_URL,
          id: 'gpt-5.6-sol',
          provider: 'openai',
        },
        selection: { modelId: 'gpt-5.6-sol', provider: 'openai' },
      },
    ],
  ])('rejects %s', async (_label, prepared) => {
    const runtime = simpleRuntime()
    runtime.prepareSimpleCompletionModelForAgent = vi.fn(async () => prepared)

    const failure = await captureStartFailure(fakeApi(), {
      simpleCompletionRuntime: runtime,
    })

    expect(failure.message).toMatch(/OpenAI account OAuth profile/u)
    expect(failure.message).toMatch(/API keys are not accepted/u)
  })

  it('rejects a generic OpenAI API transport even with an OAuth profile', async () => {
    const runtime = simpleRuntime()
    runtime.prepareSimpleCompletionModelForAgent = vi.fn(async () => ({
      auth: {
        mode: 'oauth' as const,
        profileId: 'openai:account',
        source: 'profile:openai:account',
      },
      model: {
        api: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        id: 'gpt-5.6-sol',
        provider: 'openai',
      },
      selection: { modelId: 'gpt-5.6-sol', provider: 'openai' },
    }))

    const failure = await captureStartFailure(fakeApi(), {
      simpleCompletionRuntime: runtime,
    })

    expect(failure.message).toMatch(/OpenAI account OAuth profile/u)
  })

  it.each([
    ['custom base URL', { baseUrl: 'https://private.example.invalid/codex' }],
    ['custom header', { headers: { Authorization: 'private-header' } }],
    ['forced auth header', { authHeader: true }],
    ['custom params', { params: { baseURL: 'https://private.example.invalid' } }],
    ['request transport', {
      [Symbol.for('openclaw.modelProviderRequestTransport')]: vi.fn(),
    }],
    ['local service', {
      [Symbol.for('openclaw.modelProviderLocalService')]: { private: true },
    }],
  ])('rejects a prepared inference transport override: %s', async (
    _label,
    override,
  ) => {
    const complete = vi.fn()
    const runtime = simpleRuntime(complete)
    const model = {
      api: 'openai-chatgpt-responses',
      baseUrl: OPENAI_ACCOUNT_MODEL_BASE_URL,
      id: 'gpt-5.6-sol',
      provider: 'openai',
      ...override,
    }
    runtime.prepareSimpleCompletionModelForAgent = vi.fn(async () => ({
      auth: {
        mode: 'oauth' as const,
        profileId: 'openai:account',
        source: 'profile:openai:account',
      },
      model,
      selection: { modelId: 'gpt-5.6-sol', provider: 'openai' },
    } as never))

    const failure = await captureStartFailure(fakeApi(), {
      simpleCompletionRuntime: runtime,
    })

    expect(failure.message).toMatch(/canonical OpenAI account endpoint/u)
    expect(failure.message).not.toContain('private')
    expect(complete).not.toHaveBeenCalled()
  })

  it('accepts the canonical account endpoint with one trailing slash', async () => {
    const runtime = simpleRuntime()
    runtime.prepareSimpleCompletionModelForAgent = vi.fn(async () => ({
      auth: {
        apiKey: oauthAccessJwt(),
        mode: 'oauth' as const,
        profileId: 'openai:account',
        source: 'profile:openai:account',
      },
      model: {
        api: 'openai-chatgpt-responses',
        baseUrl: `${OPENAI_ACCOUNT_MODEL_BASE_URL}/`,
        id: 'gpt-5.6-sol',
        provider: 'openai',
      },
      selection: { modelId: 'gpt-5.6-sol', provider: 'openai' },
    }))

    const bridge = await start(fakeApi(), { simpleCompletionRuntime: runtime })
    await bridge.close()
  })

  it('rejects endpoint drift before completion is invoked', async () => {
    const complete = vi.fn()
    const runtime = simpleRuntime(complete)
    const canonical = await runtime.prepareSimpleCompletionModelForAgent({
      agentId: AGENT_ID,
      agentDir: AGENT_DIR,
      cfg: fakeApi().config,
      skipAgentDiscovery: true,
    })
    runtime.prepareSimpleCompletionModelForAgent = vi.fn()
      .mockResolvedValueOnce(canonical)
      .mockResolvedValueOnce({
        ...(canonical as Record<string, unknown>),
        model: {
          ...((canonical as { model: Record<string, unknown> }).model),
          baseUrl: 'https://private.example.invalid/codex',
        },
      })
    const bridge = await start(fakeApi(), { simpleCompletionRuntime: runtime })
    try {
      const response = await modelRequest(bridge, 'must fail before completion')
      const body = JSON.stringify(await response.json())

      expect(response.status).toBe(503)
      expect(body).toContain('OPENCLAW_MODEL_NOT_READY')
      expect(body).not.toContain('private.example.invalid')
      expect(complete).not.toHaveBeenCalled()
    } finally {
      await bridge.close()
    }
  })

  it('withholds a completion if its prepared transport drifts in flight', async () => {
    const preparedModel = {
      api: 'openai-chatgpt-responses',
      baseUrl: OPENAI_ACCOUNT_MODEL_BASE_URL,
      headers: undefined as Record<string, string> | undefined,
      id: 'gpt-5.6-sol',
      provider: 'openai',
    }
    const complete = vi.fn(async () => {
      preparedModel.headers = { Authorization: 'private-header' }
      return {
        content: [{ type: 'text', text: 'private-output' }],
        stopReason: 'stop' as const,
      }
    })
    const runtime = simpleRuntime(complete)
    runtime.prepareSimpleCompletionModelForAgent = vi.fn(async () => ({
      auth: {
        apiKey: oauthAccessJwt(),
        mode: 'oauth' as const,
        profileId: 'openai:account',
        source: 'profile:openai:account',
      },
      model: preparedModel,
      selection: { modelId: 'gpt-5.6-sol', provider: 'openai' },
    }))
    const bridge = await start(fakeApi(), { simpleCompletionRuntime: runtime })
    try {
      const response = await modelRequest(bridge, 'withhold after drift')
      const body = JSON.stringify(await response.json())

      expect(response.status).toBe(503)
      expect(body).toContain('OPENCLAW_MODEL_NOT_READY')
      expect(body).not.toContain('private-header')
      expect(body).not.toContain('private-output')
      expect(complete).toHaveBeenCalledTimes(1)
    } finally {
      await bridge.close()
    }
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
        stopReason: 'stop' as const,
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
          agentDir: AGENT_DIR,
          agentId: 'researcher',
          cfg: expect.any(Object),
          skipAgentDiscovery: true,
        })
    } finally {
      await bridge.close()
    }
  })

  it.each(['error', 'aborted'] as const)(
    'rejects partial model content from an OpenClaw %s terminal without leaking provider detail',
    async (stopReason) => {
      const complete = vi.fn(async () => ({
        content: [{ type: 'text', text: 'partial-must-not-escape' }],
        errorMessage: 'private-provider-error-must-not-escape',
        stopReason,
      }))
      const bridge = await start(fakeApi(), {
        simpleCompletionRuntime: simpleRuntime(complete),
      })
      try {
        const response = await modelRequest(bridge, 'terminal failure test')
        const body = JSON.stringify(await response.json())

        expect(response.status).toBe(502)
        expect(JSON.parse(body)).toEqual({
          error: {
            code: 'OPENCLAW_MODEL_FAILED',
            message: 'The OpenClaw model did not complete successfully.',
          },
        })
        expect(body).not.toContain('partial-must-not-escape')
        expect(body).not.toContain('private-provider-error-must-not-escape')
      } finally {
        await bridge.close()
      }
    },
  )

  it('rejects a length-truncated completion even when it contains text', async () => {
    const bridge = await start(fakeApi(), {
      simpleCompletionRuntime: simpleRuntime(vi.fn(async () => ({
        content: [{ type: 'text', text: 'truncated-must-not-escape' }],
        stopReason: 'length' as const,
      }))),
    })
    try {
      const response = await modelRequest(bridge, 'truncation test')
      const body = JSON.stringify(await response.json())

      expect(response.status).toBe(502)
      expect(body).toContain('OPENCLAW_MODEL_FAILED')
      expect(body).not.toContain('truncated-must-not-escape')
    } finally {
      await bridge.close()
    }
  })

  it('rejects a stop completion carrying a provider error marker', async () => {
    const bridge = await start(fakeApi(), {
      simpleCompletionRuntime: simpleRuntime(vi.fn(async () => ({
        content: [{ type: 'text', text: 'text-must-not-escape' }],
        errorMessage: 'private-error-must-not-escape',
        stopReason: 'stop' as const,
      }))),
    })
    try {
      const response = await modelRequest(bridge, 'error marker test')
      const body = JSON.stringify(await response.json())

      expect(response.status).toBe(502)
      expect(body).toContain('OPENCLAW_MODEL_FAILED')
      expect(body).not.toContain('text-must-not-escape')
      expect(body).not.toContain('private-error-must-not-escape')
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
        stopReason: 'stop' as const,
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
      return { content: [], stopReason: 'aborted' as const }
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

  it('fails closed if inference authentication changes after launch', async () => {
    const complete = vi.fn(async () => ({
      content: [{ type: 'text', text: 'must not run' }],
      stopReason: 'stop' as const,
    }))
    const runtime = simpleRuntime(complete)
    runtime.prepareSimpleCompletionModelForAgent = vi.fn()
      .mockResolvedValueOnce({
        auth: {
          apiKey: oauthAccessJwt(),
          mode: 'oauth',
          profileId: 'openai:account',
          source: 'profile:openai:account',
        },
        model: {
          api: 'openai-chatgpt-responses',
          baseUrl: OPENAI_ACCOUNT_MODEL_BASE_URL,
          id: 'gpt-5.6-sol',
          provider: 'openai',
        },
        selection: { modelId: 'gpt-5.6-sol', provider: 'openai' },
      })
      .mockResolvedValueOnce({
        auth: {
          mode: 'api-key',
          profileId: 'openai:key-backup',
          source: 'profile:openai:key-backup',
        },
        model: {
          api: 'openai-chatgpt-responses',
          baseUrl: OPENAI_ACCOUNT_MODEL_BASE_URL,
          id: 'gpt-5.6-sol',
          provider: 'openai',
        },
        selection: { modelId: 'gpt-5.6-sol', provider: 'openai' },
      })
    const bridge = await start(fakeApi(), {
      simpleCompletionRuntime: runtime,
    })
    try {
      const response = await modelRequest(bridge, 'must fail closed')

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        error: {
          code: 'OPENCLAW_MODEL_NOT_READY',
          message: expect.stringMatching(/API keys are not accepted/u),
        },
      })
      expect(complete).not.toHaveBeenCalled()
    } finally {
      await bridge.close()
    }
  })

  it('fails closed if Hosted Search authentication changes after launch', async () => {
    const search = vi.fn(async () => ({ provider: 'codex', result: {} }))
    const api = fakeApi(search)
    api.runtime.modelAuth.resolveApiKeyForProvider = vi.fn()
      .mockResolvedValueOnce({
        mode: 'oauth',
        profileId: 'openai:account',
        source: 'profile:openai:account',
      })
      .mockResolvedValueOnce({
        mode: 'oauth',
        profileId: 'openai:account',
        source: 'profile:openai:account',
      })
      .mockResolvedValueOnce({
        mode: 'oauth',
        profileId: 'openai:account',
        source: 'profile:openai:account',
      })
      .mockResolvedValueOnce({
        mode: 'api-key',
        profileId: 'openai:key-backup',
        source: 'profile:openai:key-backup',
      })
    const bridge = await start(api)
    try {
      const response = await fetch(`${bridge.url}/v1/web/search`, {
        body: JSON.stringify({
          limit: 4,
          query: 'must fail closed',
          timeoutMs: 45_000,
          version: 1,
        }),
        headers: headers(),
        method: 'POST',
      })

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        error: {
          code: 'OPENCLAW_SEARCH_NOT_READY',
          message: expect.stringMatching(/API keys are not accepted/u),
        },
      })
      expect(search).not.toHaveBeenCalled()
    } finally {
      await bridge.close()
    }
  })

  it('rejects email-only OAuth metadata without a routable access JWT', async () => {
    const source = {
      credential: {
        email: 'researcher@example.invalid',
        provider: 'openai',
        type: 'oauth',
      } as Record<string, unknown>,
    }

    const failure = await captureStartFailure(fakeApi(), {
      agentAuthRuntime: mutableAgentAuthRuntime(source),
    })

    expect(failure.message).toMatch(/OpenAI account OAuth profile/u)
  })

  it('rejects an access JWT when stored account metadata is absent', async () => {
    const source = {
      credential: {
        access: oauthAccessJwt('account-fixture', 'derived-at-launch'),
        email: 'researcher@example.invalid',
        provider: 'openai',
        type: 'oauth',
      } as Record<string, unknown>,
    }
    const failure = await captureStartFailure(fakeApi(), {
      agentAuthRuntime: mutableAgentAuthRuntime(source),
    })

    expect(failure.message).toMatch(/OpenAI account OAuth profile/u)
  })

  it('rejects a prepared model token routed to a different account', async () => {
    const sentinel = `oc-sent-v1-${'c'.repeat(24)}`
    const runtime = simpleRuntime()
    const prepare = runtime.prepareSimpleCompletionModelForAgent
    runtime.prepareSimpleCompletionModelForAgent = vi.fn(async (params) => {
      const prepared = await prepare(params)
      if ('error' in prepared) return prepared
      return {
        ...prepared,
        auth: {
          ...prepared.auth,
          apiKey: sentinel,
        },
      }
    })

    const failure = await captureStartFailure(fakeApi(), {
      preparedAuthAccountInspector: preparedAuthInspector({
        [sentinel]: oauthAccessJwt(
          'different-account',
          'prepared-mismatch',
        ),
      }),
      simpleCompletionRuntime: runtime,
    })

    expect(failure.message).toMatch(/OpenAI account OAuth profile/u)
    expect(runtime.completeWithPreparedSimpleCompletionModel)
      .not.toHaveBeenCalled()
  })

  it('allows prepared sentinel rotation within the bound account', async () => {
    const initialSentinel = `oc-sent-v1-${'d'.repeat(24)}`
    const refreshedSentinel = `oc-sent-v1-${'e'.repeat(24)}`
    let currentSentinel = initialSentinel
    const runtime = simpleRuntime()
    const prepare = runtime.prepareSimpleCompletionModelForAgent
    runtime.prepareSimpleCompletionModelForAgent = vi.fn(async (params) => {
      const prepared = await prepare(params)
      if ('error' in prepared) return prepared
      return {
        ...prepared,
        auth: { ...prepared.auth, apiKey: currentSentinel },
      }
    })
    const inspector = preparedAuthInspector({
      [initialSentinel]: oauthAccessJwt('account-fixture', 'sentinel-initial'),
      [refreshedSentinel]: oauthAccessJwt(
        'account-fixture',
        'sentinel-refreshed',
      ),
    })
    const bridge = await start(fakeApi(), {
      preparedAuthAccountInspector: inspector,
      simpleCompletionRuntime: runtime,
    })
    try {
      currentSentinel = refreshedSentinel
      const response = await fetch(`${bridge.url}/v1/status`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      expect(response.status).toBe(200)
      expect(inspector.resolveIdentity).toHaveBeenCalledWith(
        refreshedSentinel,
      )
    } finally {
      await bridge.close()
    }
  })

  it('allows OAuth token refresh while preserving the bound account identity', async () => {
    const source = {
      credential: {
        access: oauthAccessJwt('account-fixture', 'initial'),
        accountId: 'account-fixture',
        email: 'researcher@example.invalid',
        expires: 1,
        provider: 'openai',
        refresh: 'oauth-refresh-initial',
        type: 'oauth',
      } as Record<string, unknown>,
    }
    const complete = vi.fn(async () => {
      source.credential = {
        ...source.credential,
        access: oauthAccessJwt('account-fixture', 'after-model'),
        expires: 3,
        refresh: 'oauth-refresh-after-model',
      }
      return {
        content: [{ type: 'text' as const, text: 'account-bound result' }],
        stopReason: 'stop' as const,
      }
    })
    const executeSearch = vi.fn(async (
      params: Parameters<CodexPackageAttestation['executeSearch']>[0],
    ) => {
      if (params.query !== CODEX_SEARCH_READINESS_QUERY) {
        source.credential = {
          ...source.credential,
          access: oauthAccessJwt('account-fixture', 'after-search'),
          expires: 4,
          refresh: 'oauth-refresh-after-search',
        }
      }
      return {
        content: 'grounded account-bound result',
        externalContent: {
          provider: 'codex',
          source: 'web_search',
          untrusted: true,
          wrapped: true,
        },
        model: 'gpt-5.6-sol',
        provider: 'codex',
        query: params.query,
        searches: [{ query: params.query }],
        tookMs: 1,
      }
    })
    const attestor: CodexPackageAttestor = vi.fn(async () => ({
      executeSearch,
      revalidate: vi.fn(async () => true),
    }))
    const runtime = simpleRuntime(complete)
    const prepare = runtime.prepareSimpleCompletionModelForAgent
    runtime.prepareSimpleCompletionModelForAgent = vi.fn(async (params) => {
      const prepared = await prepare(params)
      if ('error' in prepared) return prepared
      return {
        ...prepared,
        auth: {
          ...prepared.auth,
          apiKey: source.credential.access as string,
        },
      }
    })
    const bridge = await start(fakeApi(), {
      agentAuthRuntime: mutableAgentAuthRuntime(source),
      codexPackageAttestor: attestor,
      simpleCompletionRuntime: runtime,
    })
    try {
      source.credential = {
        ...source.credential,
        access: oauthAccessJwt('account-fixture', 'after-launch'),
        expires: 2,
        refresh: 'oauth-refresh-after-launch',
      }

      const status = await fetch(`${bridge.url}/v1/status`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      expect(status.status).toBe(200)

      const model = await modelRequest(bridge, 'allow OAuth refresh rotation')
      expect(model.status).toBe(200)

      const search = await fetch(`${bridge.url}/v1/web/search`, {
        body: JSON.stringify({
          limit: 4,
          query: 'allow OAuth refresh rotation',
          timeoutMs: 45_000,
          version: 1,
        }),
        headers: headers(),
        method: 'POST',
      })
      expect(search.status).toBe(200)
      expect(complete).toHaveBeenCalledTimes(1)
      expect(executeSearch).toHaveBeenCalledTimes(2)
    } finally {
      await bridge.close()
    }
  })

  it('rejects access-token account drift at the status boundary', async () => {
    const source = {
      credential: {
        access: oauthAccessJwt('account-fixture', 'status-initial'),
        accountId: 'account-fixture',
        email: 'researcher@example.invalid',
        provider: 'openai',
        type: 'oauth',
      } as Record<string, unknown>,
    }
    const bridge = await start(fakeApi(), {
      agentAuthRuntime: mutableAgentAuthRuntime(source),
    })
    try {
      source.credential = {
        ...source.credential,
        access: oauthAccessJwt('different-account', 'status-rebind'),
      }
      const response = await fetch(`${bridge.url}/v1/status`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        error: {
          code: 'OPENCLAW_NOT_READY',
          message: expect.stringMatching(/OAuth profile/u),
        },
      })
    } finally {
      await bridge.close()
    }
  })

  it('withholds a result if the prepared access token changes in flight', async () => {
    const complete = vi.fn(async (params) => {
      (params.auth as { apiKey?: string }).apiKey = oauthAccessJwt(
        'different-account',
        'prepared-in-flight',
      )
      return {
        content: [{ type: 'text' as const, text: 'must be withheld' }],
        stopReason: 'stop' as const,
      }
    })
    const bridge = await start(fakeApi(), {
      simpleCompletionRuntime: simpleRuntime(complete),
    })
    try {
      const response = await modelRequest(
        bridge,
        'detect prepared access-token drift',
      )

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        error: {
          code: 'OPENCLAW_MODEL_NOT_READY',
          message: expect.stringMatching(/OAuth profile/u),
        },
      })
      expect(complete).toHaveBeenCalledTimes(1)
    } finally {
      await bridge.close()
    }
  })

  it('rejects a same-profile account rebind before model execution', async () => {
    const source = {
      credential: {
        access: oauthAccessJwt('account-fixture', 'before-model-rebind'),
        accountId: 'account-fixture',
        email: 'researcher@example.invalid',
        provider: 'openai',
        type: 'oauth',
      } as Record<string, unknown>,
    }
    const complete = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'must not run' }],
      stopReason: 'stop' as const,
    }))
    const bridge = await start(fakeApi(), {
      agentAuthRuntime: mutableAgentAuthRuntime(source),
      simpleCompletionRuntime: simpleRuntime(complete),
    })
    try {
      source.credential = {
        ...source.credential,
        access: oauthAccessJwt('different-account', 'before-model-request'),
      }
      const response = await modelRequest(bridge, 'must fail before inference')

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        error: {
          code: 'OPENCLAW_MODEL_NOT_READY',
          message: expect.stringMatching(/OAuth profile/u),
        },
      })
      expect(complete).not.toHaveBeenCalled()
    } finally {
      await bridge.close()
    }
  })

  it('withholds a model result if the same profile is rebound during execution', async () => {
    const source = {
      credential: {
        access: oauthAccessJwt('account-fixture', 'during-model-rebind'),
        accountId: 'account-fixture',
        email: 'researcher@example.invalid',
        provider: 'openai',
        type: 'oauth',
      } as Record<string, unknown>,
    }
    const complete = vi.fn(async () => {
      source.credential = {
        ...source.credential,
        access: oauthAccessJwt('different-account', 'during-model-request'),
      }
      return {
        content: [{ type: 'text' as const, text: 'must be withheld' }],
        stopReason: 'stop' as const,
      }
    })
    const bridge = await start(fakeApi(), {
      agentAuthRuntime: mutableAgentAuthRuntime(source),
      simpleCompletionRuntime: simpleRuntime(complete),
    })
    try {
      const response = await modelRequest(bridge, 'must fail after inference')

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        error: {
          code: 'OPENCLAW_MODEL_NOT_READY',
          message: expect.stringMatching(/OAuth profile/u),
        },
      })
      expect(complete).toHaveBeenCalledTimes(1)
    } finally {
      await bridge.close()
    }
  })

  it('rejects a same-profile account rebind before Hosted Search execution', async () => {
    const source = {
      credential: {
        access: oauthAccessJwt('account-fixture', 'before-search-rebind'),
        accountId: 'account-fixture',
        email: 'researcher@example.invalid',
        provider: 'openai',
        type: 'oauth',
      } as Record<string, unknown>,
    }
    const search = vi.fn(async () => ({ provider: 'codex', result: {} }))
    const bridge = await start(fakeApi(search), {
      agentAuthRuntime: mutableAgentAuthRuntime(source),
    })
    try {
      source.credential = {
        ...source.credential,
        access: oauthAccessJwt('different-account', 'before-search-request'),
      }
      const response = await fetch(`${bridge.url}/v1/web/search`, {
        body: JSON.stringify({
          limit: 4,
          query: 'must fail before search',
          timeoutMs: 45_000,
          version: 1,
        }),
        headers: headers(),
        method: 'POST',
      })

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        error: {
          code: 'OPENCLAW_SEARCH_NOT_READY',
          message: expect.stringMatching(/OAuth profile/u),
        },
      })
      expect(search).not.toHaveBeenCalled()
    } finally {
      await bridge.close()
    }
  })

  it('binds the official search call to a cloned singleton OAuth store', async () => {
    const api = fakeApi()
    let sourceCredential: Record<string, unknown> = {
      access: oauthAccessJwt('account-fixture', 'search-fixture'),
      accountId: 'account-fixture',
      email: 'researcher@example.invalid',
      provider: 'openai',
      type: 'oauth',
    }
    const authRuntime = agentAuthRuntime()
    authRuntime.loadAuthProfileStoreForSecretsRuntime = vi.fn(() => ({
      order: { openai: ['openai:account'] },
      profiles: { 'openai:account': sourceCredential },
      version: 1,
    }))
    const executeSearch = vi.fn(async (
      params: Parameters<CodexPackageAttestation['executeSearch']>[0],
    ) => {
      const profiles = params.authProfileStore.profiles as
        Record<string, Record<string, unknown>>
      expect(Object.keys(profiles)).toEqual(['openai:account'])
      expect(profiles['openai:account']).toMatchObject({
        provider: 'openai',
        type: 'oauth',
      })
      if (params.query !== CODEX_SEARCH_READINESS_QUERY) {
        sourceCredential = {
          ...sourceCredential,
          access: oauthAccessJwt('different-account', 'search-rebind'),
        }
      }
      return {
        content: 'grounded OAuth-only result',
        externalContent: {
          provider: 'codex',
          source: 'web_search',
          untrusted: true,
          wrapped: true,
        },
        model: 'gpt-5.6-sol',
        provider: 'codex',
        query: params.query,
        searches: [{ query: params.query }],
        tookMs: 1,
      }
    })
    const attestor: CodexPackageAttestor = vi.fn(async () => ({
      executeSearch,
      revalidate: vi.fn(async () => true),
    }))
    const bridge = await start(api, {
      agentAuthRuntime: authRuntime,
      codexPackageAttestor: attestor,
    })
    try {
      const response = await fetch(`${bridge.url}/v1/web/search`, {
        body: JSON.stringify({
          limit: 4,
          query: 'prove OAuth binding remains exact',
          timeoutMs: 45_000,
          version: 1,
        }),
        headers: headers(),
        method: 'POST',
      })

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        error: {
          code: 'OPENCLAW_SEARCH_NOT_READY',
          message: expect.stringMatching(/OAuth profile/u),
        },
      })
      expect(executeSearch).toHaveBeenCalledTimes(2)
    } finally {
      await bridge.close()
    }
  })

  it('keeps authoritative OAuth refresh material private across a scoped retry', async () => {
    const api = fakeApi()
    const sourceCredential: Record<string, unknown> = {
      access: oauthAccessJwt('account-fixture', 'scoped-refresh-fixture'),
      accountId: 'account-fixture',
      email: 'researcher@example.invalid',
      provider: 'openai',
      refresh: 'authoritative-refresh',
      refreshToken: 'authoritative-refresh-token',
      type: 'oauth',
    }
    const authoritativeSnapshot = structuredClone(sourceCredential)
    const authRuntime = agentAuthRuntime()
    authRuntime.loadAuthProfileStoreForSecretsRuntime = vi.fn(() => ({
      order: { openai: ['openai:account'] },
      profiles: { 'openai:account': sourceCredential },
      version: 1,
    }))
    let scopedAttempts = 0
    const executeSearch = vi.fn(async (
      params: Parameters<CodexPackageAttestation['executeSearch']>[0],
    ) => {
      const profiles = params.authProfileStore.profiles as
        Record<string, Record<string, unknown>>
      const scopedCredential = profiles['openai:account']
      expect(scopedCredential).toBeDefined()
      expect(scopedCredential).not.toHaveProperty('refresh')
      expect(scopedCredential).not.toHaveProperty('refreshToken')
      expect(sourceCredential).toEqual(authoritativeSnapshot)

      if (params.query !== CODEX_SEARCH_READINESS_QUERY) {
        const failedScopedRefresh = () => {
          scopedAttempts += 1
          scopedCredential!.refresh = 'failed-scoped-refresh'
          scopedCredential!.refreshToken = 'failed-scoped-refresh-token'
          throw new Error('simulated scoped refresh failure')
        }
        expect(failedScopedRefresh).toThrow(/scoped refresh failure/u)
        expect(sourceCredential).toEqual(authoritativeSnapshot)

        // The isolated caller may discard its failed mutation and retry, but
        // it never owns or mutates OpenClaw's authoritative refresh material.
        delete scopedCredential!.refresh
        delete scopedCredential!.refreshToken
        scopedAttempts += 1
      }

      return {
        content: 'grounded OAuth-only result',
        externalContent: {
          provider: 'codex',
          source: 'web_search',
          untrusted: true,
          wrapped: true,
        },
        model: 'gpt-5.6-sol',
        provider: 'codex',
        query: params.query,
        searches: [{ query: params.query }],
        tookMs: 1,
      }
    })
    const attestor: CodexPackageAttestor = vi.fn(async () => ({
      executeSearch,
      revalidate: vi.fn(async () => true),
    }))
    const bridge = await start(api, {
      agentAuthRuntime: authRuntime,
      codexPackageAttestor: attestor,
    })
    try {
      const response = await fetch(`${bridge.url}/v1/web/search`, {
        body: JSON.stringify({
          limit: 4,
          query: 'keep authoritative refresh material private',
          timeoutMs: 45_000,
          version: 1,
        }),
        headers: headers(),
        method: 'POST',
      })

      expect(response.status).toBe(200)
      expect(scopedAttempts).toBe(2)
      expect(sourceCredential).toEqual(authoritativeSnapshot)
      expect(executeSearch).toHaveBeenCalledTimes(2)
    } finally {
      await bridge.close()
    }
  })

  it('withholds search output if the cloned OAuth token changes account', async () => {
    const executeSearch = vi.fn(async (
      params: Parameters<CodexPackageAttestation['executeSearch']>[0],
    ) => {
      if (params.query !== CODEX_SEARCH_READINESS_QUERY) {
        const profiles = params.authProfileStore.profiles as
          Record<string, Record<string, unknown>>
        profiles['openai:account'] = {
          ...profiles['openai:account'],
          access: oauthAccessJwt('different-account', 'cloned-search-race'),
        }
      }
      return {
        content: 'must be withheld',
        externalContent: {
          provider: 'codex',
          source: 'web_search',
          untrusted: true,
          wrapped: true,
        },
        model: 'gpt-5.6-sol',
        provider: 'codex',
        query: params.query,
        searches: [{ query: params.query }],
        tookMs: 1,
      }
    })
    const attestor: CodexPackageAttestor = vi.fn(async () => ({
      executeSearch,
      revalidate: vi.fn(async () => true),
    }))
    const bridge = await start(fakeApi(), {
      codexPackageAttestor: attestor,
    })
    try {
      const response = await fetch(`${bridge.url}/v1/web/search`, {
        body: JSON.stringify({
          limit: 4,
          query: 'detect cloned search-token drift',
          timeoutMs: 45_000,
          version: 1,
        }),
        headers: headers(),
        method: 'POST',
      })

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        error: {
          code: 'OPENCLAW_SEARCH_NOT_READY',
          message: expect.stringMatching(/OAuth profile/u),
        },
      })
      expect(executeSearch).toHaveBeenCalledTimes(2)
    } finally {
      await bridge.close()
    }
  })

  it('fails closed if the managed Codex app-server configuration drifts after launch', async () => {
    const search = vi.fn(async () => ({ provider: 'codex', result: {} }))
    const api = fakeApi(search)
    const environment: NodeJS.ProcessEnv = { NODE_ENV: 'test' }
    const bridge = await start(api, { environment })
    try {
      api.config.plugins = {
        allow: ['codex', 'webchess'],
        entries: {
          codex: {
            config: { appServer: { homeScope: 'user' } },
          },
        },
      }
      const userHomeResponse = await fetch(`${bridge.url}/v1/web/search`, {
        body: JSON.stringify({
          limit: 4,
          query: 'must fail closed after user-home drift',
          timeoutMs: 45_000,
          version: 1,
        }),
        headers: headers(),
        method: 'POST',
      })

      expect(userHomeResponse.status).toBe(503)
      expect(await userHomeResponse.json()).toEqual({
        error: {
          code: 'OPENCLAW_SEARCH_NOT_READY',
          message: expect.stringMatching(/canonical OpenAI account endpoint/u),
        },
      })

      api.config.plugins = undefined
      environment.OPENCLAW_CODEX_APP_SERVER_BIN = '/private/drift/codex'
      const commandResponse = await fetch(`${bridge.url}/v1/web/search`, {
        body: JSON.stringify({
          limit: 4,
          query: 'must fail closed after command drift',
          timeoutMs: 45_000,
          version: 1,
        }),
        headers: headers(),
        method: 'POST',
      })

      expect(commandResponse.status).toBe(503)
      const commandBody = JSON.stringify(await commandResponse.json())
      expect(commandBody).toContain('OPENCLAW_SEARCH_NOT_READY')
      expect(commandBody).not.toContain('/private/drift/codex')
      expect(search).not.toHaveBeenCalled()
    } finally {
      await bridge.close()
    }
  })

  it('rechecks Codex app-server scope after asynchronous auth resolution', async () => {
    const search = vi.fn(async () => ({ provider: 'codex', result: {} }))
    const api = fakeApi(search)
    api.runtime.modelAuth.resolveApiKeyForProvider = vi.fn()
      .mockResolvedValueOnce({
        mode: 'oauth',
        profileId: 'openai:account',
        source: 'profile:openai:account',
      })
      .mockResolvedValueOnce({
        mode: 'oauth',
        profileId: 'openai:account',
        source: 'profile:openai:account',
      })
      .mockResolvedValueOnce({
        mode: 'oauth',
        profileId: 'openai:account',
        source: 'profile:openai:account',
      })
      .mockImplementationOnce(async () => {
        api.config.plugins = {
          allow: ['codex', 'webchess'],
          entries: {
            codex: {
              config: { appServer: { command: '/private/drift/codex' } },
            },
          },
        }
        return {
          mode: 'oauth',
          profileId: 'openai:account',
          source: 'profile:openai:account',
        }
      })
    const bridge = await start(api)
    try {
      const response = await fetch(`${bridge.url}/v1/web/search`, {
        body: JSON.stringify({
          limit: 4,
          query: 'must fail closed before search execution',
          timeoutMs: 45_000,
          version: 1,
        }),
        headers: headers(),
        method: 'POST',
      })

      expect(response.status).toBe(503)
      const body = JSON.stringify(await response.json())
      expect(body).toContain('OPENCLAW_SEARCH_NOT_READY')
      expect(body).toContain('canonical OpenAI account endpoint')
      expect(body).not.toContain('/private/drift/codex')
      expect(search).not.toHaveBeenCalled()
    } finally {
      await bridge.close()
    }
  })

  it('rechecks a per-agent auth-store order before every model and search request', async () => {
    const effectiveOrder = ['openai:account']
    const authRuntime = agentAuthRuntime(effectiveOrder)
    const complete = vi.fn(async () => ({
      content: [{ type: 'text', text: 'must not run' }],
      stopReason: 'stop' as const,
    }))
    const search = vi.fn(async () => ({ provider: 'codex', result: {} }))
    const api = fakeApi(search)
    const bridge = await start(api, {
      agentAuthRuntime: authRuntime,
      simpleCompletionRuntime: simpleRuntime(complete),
    })
    effectiveOrder.splice(0, effectiveOrder.length, 'openai:key-backup')
    try {
      const modelResponse = await modelRequest(bridge, 'must fail closed')
      const searchResponse = await fetch(`${bridge.url}/v1/web/search`, {
        body: JSON.stringify({
          limit: 4,
          query: 'must also fail closed',
          timeoutMs: 45_000,
          version: 1,
        }),
        headers: headers(),
        method: 'POST',
      })

      expect(modelResponse.status).toBe(503)
      expect(await modelResponse.json()).toMatchObject({
        error: { code: 'OPENCLAW_MODEL_NOT_READY' },
      })
      expect(searchResponse.status).toBe(503)
      expect(await searchResponse.json()).toMatchObject({
        error: { code: 'OPENCLAW_SEARCH_NOT_READY' },
      })
      expect(complete).not.toHaveBeenCalled()
      expect(search).not.toHaveBeenCalled()
      expect(vi.mocked(
        authRuntime.loadAuthProfileStoreForSecretsRuntime,
      ).mock.calls.length)
        .toBeGreaterThanOrEqual(6)
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
