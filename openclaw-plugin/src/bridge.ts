import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { accessSync, constants as fsConstants } from 'node:fs'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { isDeepStrictEqual } from 'node:util'

import {
  attestOfficialCodexPackage,
  isOfficialCodexPluginRecord,
  snapshotOAuthCredentialIdentity,
  type CodexPackageAttestation,
  type CodexPluginRecordForAttestation,
} from './codex-attestation.js'

export const BRIDGE_PROTOCOL_VERSION = 1
export const MAX_BRIDGE_REQUEST_BYTES = 16 * 1024 * 1024
export const MAX_BRIDGE_RESPONSE_BYTES = 4 * 1024 * 1024
export const MAX_BRIDGE_PROMPT_CHARS = 12 * 1024 * 1024
export const MAX_BRIDGE_QUERY_CHARS = 500
export const CODEX_SEARCH_READINESS_QUERY = 'OpenAI official website'
export const OPENAI_MODEL_READINESS_PROMPT =
  'Reply with exactly this ASCII token and nothing else: WEBCHESS_READY'
const MAX_CONCURRENT_RUNS = 4
const LOOPBACK_HOST = '127.0.0.1'
const CODEX_SEARCH_ABORT_DRAIN_MS = 1_250
const CODEX_SEARCH_READINESS_TIMEOUT_MS = 45_000
const OPENAI_MODEL_READINESS_TIMEOUT_MS = 45_000
const OPENAI_MODEL_READINESS_RESPONSE = 'WEBCHESS_READY'
const PINNED_OPENCLAW_RUNTIME_VERSION = '2026.7.1-2'
const OPENCLAW_LOCAL_MODEL_RUN_SYSTEM_PROMPT =
  'You are a personal assistant running inside OpenClaw.'
const OPENAI_ACCOUNT_MODEL_BASE_URL =
  'https://chatgpt.com/backend-api/codex'
const MODEL_PROVIDER_REQUEST_TRANSPORT =
  Symbol.for('openclaw.modelProviderRequestTransport')
const MODEL_PROVIDER_LOCAL_SERVICE =
  Symbol.for('openclaw.modelProviderLocalService')
const OPENAI_ACCOUNT_AUTH_ERROR =
  'WebChess requires one OpenAI account OAuth profile for both inference and Codex Hosted Search. Sign in with openclaw models auth login --provider openai, make that OAuth profile the only ordered OpenAI profile, then relaunch WebChess. API keys are not accepted.'
const PROVIDER_SECRET_ENV_ERROR =
  'WebChess account-auth mode refuses provider credential environment variables. Remove provider API-key, API-token, access-token, auth-token, OAuth-token, cloud-credential, and profile-credential variables from the OpenClaw environment, then relaunch WebChess.'
const OPENAI_ACCOUNT_TRANSPORT_ERROR =
  'WebChess requires the canonical OpenAI account endpoint with no custom provider endpoint, model, header, request, proxy, TLS, local-service, or debug-transport override. Remove those OpenAI transport overrides, then relaunch WebChess.'
const OPENCLAW_RUNTIME_VERSION_ERROR =
  'WebChess requires the pinned OpenClaw 2026.7.1-2 runtime for its private account-auth and transport contracts. Install that exact OpenClaw version, then relaunch WebChess.'
const CODEX_SEARCH_CONFIG_ERROR =
  'WebChess requires OpenClaw web search to stay enabled, Codex Hosted Search to stay enabled, and tools.web.search.provider set to codex.'
const CODEX_SEARCH_PROVIDER_ERROR =
  'OpenClaw needs the codex plugin installed and enabled before WebChess can launch. Install or enable the codex plugin, then relaunch WebChess.'
const CODEX_SEARCH_ATTESTATION_ERROR =
  'WebChess requires the exact official @openclaw/codex 2026.7.1-1 package and its reviewed @openai/codex 0.144.3 managed executable. Reinstall that exact official plugin through OpenClaw, then relaunch WebChess.'
const CODEX_SEARCH_PROBE_ERROR =
  'WebChess could not complete its one-time authenticated Codex Hosted Search readiness probe. Verify the OpenAI account OAuth profile and official codex plugin, then relaunch WebChess.'
const OPENAI_MODEL_PROBE_ERROR =
  'WebChess could not complete its one-time authenticated OpenAI model readiness probe. Verify the selected OpenAI account model and OAuth profile, then relaunch WebChess.'
const CODEX_SEARCH_RUNTIME_ERROR =
  'WebChess requires the official Codex Hosted Search managed app-server in private stdio, agent-scoped mode. Remove custom Codex app-server command, argument, transport, URL, header, token, or user-home overrides, then relaunch WebChess.'
const OPENCLAW_PLUGIN_CONFIG_ERROR =
  'WebChess requires plugins.allow to contain only codex and webchess, with no custom plugin load paths or additional plugin entries. Restore the dedicated WebChess OpenClaw profile, then relaunch WebChess.'
const OPENCLAW_AUTO_CA_MARKER = 'OPENCLAW_NODE_EXTRA_CA_CERTS_READY'
const LINUX_SYSTEM_CA_PATHS = [
  '/etc/ssl/certs/ca-certificates.crt',
  '/etc/pki/tls/certs/ca-bundle.crt',
  '/etc/ssl/ca-bundle.pem',
] as const
const CODEX_APP_SERVER_ALWAYS_CLEAR_ENV = [
  'ALL_PROXY',
  'all_proxy',
  'AMQP_URL',
  'AZURE_AUTH_LOCATION',
  'BUNDLE_HTTP_PROXY',
  'BUNDLE_HTTPS_PROXY',
  'BUNDLE_NO_PROXY',
  'BUNDLE_SSL_CA_CERT',
  'BUN_OPTIONS',
  'CLAUDE_AI_SESSION_KEY',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_WEB_COOKIE',
  'CLAUDE_WEB_SESSION_KEY',
  'CLERK_SECRET_KEY',
  'CLERK_WEBHOOK_SIGNING_SECRET',
  'CODEX_API_KEY',
  'CODEX_CA_CERTIFICATE',
  'CODEX_EXEC_SERVER_NOISE_CHATGPT_ACCOUNT_ID',
  'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
  'CODEX_NETWORK_ALLOW_LOCAL_BINDING',
  'CODEX_NETWORK_PROXY_ACTIVE',
  'CODEX_NETWORK_PROXY_ATTRIBUTION',
  'CODEX_NETWORK_PROXY_BROKERED_CREDENTIALS',
  'CODEX_NETWORK_PROXY_CREDENTIAL_BROKER_ACTIVE',
  'CODEX_SANDBOX',
  'CURL_CA_BUNDLE',
  'DATABASE_URL',
  'DIRECT_URL',
  'DISCORD_BOT_TOKEN',
  'DOCKER_HTTP_PROXY',
  'DOCKER_HTTPS_PROXY',
  'DYLD_INSERT_LIBRARIES',
  'ELECTRON_GET_USE_PROXY',
  'FTP_PROXY',
  'ftp_proxy',
  'GIT_SSL_CAINFO',
  'GIT_SSH_COMMAND',
  'GIT_SSH_VARIANT',
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'KUBECONFIG',
  'LD_PRELOAD',
  'MIGRATION_DATABASE_URL',
  'MSTEAMS_CERTIFICATE_PATH',
  'MONGODB_URI',
  'NGROK_AUTHTOKEN',
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
  'NOSTR_PRIVATE_KEY',
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
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_CUSTOM_HEADERS',
  'OPENAI_LOG',
  'OPENAI_ORGANIZATION',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT',
  'OPENAI_PROJECT_ID',
  'OPENCLAW_APNS_PRIVATE_KEY',
  'OPENCLAW_APNS_PRIVATE_KEY_P8',
  'OPENCLAW_APNS_PRIVATE_KEY_PATH',
  'OPENCLAW_AUTH_PROFILE_SECRET_KEY',
  'OPENCLAW_BROWSER_CDP_AUTH_TOKEN',
  'OPENCLAW_BROWSER_NOVNC_PASSWORD',
  'OPENCLAW_CLAWHUB_TOKEN',
  'OPENCLAW_BUILD_PRIVATE_QA',
  'OPENCLAW_DEBUG_PROXY_BLOB_DIR',
  'OPENCLAW_DEBUG_PROXY_CERT_DIR',
  'OPENCLAW_DEBUG_PROXY_DB_PATH',
  'OPENCLAW_DEBUG_PROXY_ENABLED',
  'OPENCLAW_DEBUG_PROXY_REQUIRE',
  'OPENCLAW_DEBUG_PROXY_SESSION_ID',
  'OPENCLAW_DEBUG_PROXY_URL',
  'OPENCLAW_ENABLE_PRIVATE_QA_CLI',
  'OPENCLAW_GATEWAY_PASSWORD',
  'OPENCLAW_GATEWAY_TOKEN',
  'OPENCLAW_MCP_TOKEN',
  OPENCLAW_AUTO_CA_MARKER,
  'OPENCLAW_OAUTH_DIR',
  'OPENCLAW_PROFILE',
  'OPENCLAW_QA_FORCE_RUNTIME',
  'OPENCLAW_VAPID_PRIVATE_KEY',
  'OPENSSL_CONF',
  'PGDATABASE',
  'PGHOST',
  'PGPASSWORD',
  'PGPASSFILE',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGUSER',
  'POSTGRES_PASSWORD',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL',
  'PIP_PROXY',
  'REDIS_URL',
  'REQUESTS_CA_BUNDLE',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SSLKEYLOGFILE',
  'SSH_AGENT_PID',
  'SSH_AUTH_SOCK',
  'SSH_CLIENT',
  'SSH_CONNECTION',
  'SSH_TTY',
  'SYNOLOGY_CHAT_INCOMING_URL',
  'TELEGRAM_BOT_TOKEN',
  'WEBCHESS_DELETION_HMAC_SECRET',
  'WEBCHESS_HMAC_SECRET',
  'WEBCHESS_OPENCLAW_BRIDGE_TOKEN',
  'WEBCHESS_OPENCLAW_BRIDGE_URL',
  'WEBCHESS_OPENCLAW_DATABASE_URL',
  'WSS_PROXY',
  'wss_proxy',
  'YARN_HTTP_PROXY',
  'YARN_NO_PROXY',
  '__CODEX_SNAPSHOT_OVERRIDE',
  '__CODEX_SNAPSHOT_PROXY_OVERRIDE',
] as const

const PROVIDER_CREDENTIAL_ENVIRONMENT_ALLOWLIST = new Set([
  // These reviewed names carry public metadata or WebChess-local service/IPC
  // state, not provider credentials. The Codex child still clears every
  // matching name, including these exceptions.
  'CLERK_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'OPENCLAW_VAPID_PUBLIC_KEY',
  'POSTGRES_PASSWORD',
  'TELNYX_PUBLIC_KEY',
  'WEBCHESS_DELETION_HMAC_SECRET',
  'WEBCHESS_HMAC_SECRET',
  'WEBCHESS_OPENCLAW_BRIDGE_TOKEN',
])

const PROVIDER_CREDENTIAL_ENVIRONMENT_EXACT_NAMES = new Set([
  'AMQP_URL',
  'ANTHROPIC_ADMIN_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_CONFIG_FILE',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_PROFILE',
  'AWS_SECURITY_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_SESSION_TOKEN',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AZURE_AUTH_LOCATION',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'KUBECONFIG',
  'MONGODB_URI',
  'REDIS_URL',
  'SYNOLOGY_CHAT_INCOMING_URL',
])

type ThinkingLevel = 'low' | 'medium'
type OpenClawStopReason =
  | 'stop'
  | 'length'
  | 'toolUse'
  | 'error'
  | 'aborted'

interface OpenClawResolvedProviderAuth {
  mode: 'api-key' | 'oauth' | 'token' | 'aws-sdk'
  profileId?: string
  source: string
}

interface OpenClawAuthProfileStore {
  order?: Record<string, string[]>
  profiles: Record<string, unknown>
  version: number
}

export interface OpenClawAgentAuthRuntime {
  loadAuthProfileStoreForSecretsRuntime(
    agentDir?: string,
    options?: {
      config?: OpenClawRuntimeConfig
      externalCliProviderIds?: string[]
    },
  ): OpenClawAuthProfileStore
  resolveAuthProfileOrder(params: {
    cfg?: OpenClawRuntimeConfig
    provider: string
    store: OpenClawAuthProfileStore
  }): string[]
  resolveAgentDir(
    config: OpenClawRuntimeConfig,
    agentId: string,
    environment?: NodeJS.ProcessEnv,
  ): string
  resolveAgentWorkspaceDir(
    config: OpenClawRuntimeConfig,
    agentId: string,
    environment?: NodeJS.ProcessEnv,
  ): string
  resolveDefaultAgentId(config: OpenClawRuntimeConfig): string
}

interface PreparedSimpleCompletionModel {
  auth: OpenClawResolvedProviderAuth
  model: {
    api?: string
    authHeader?: boolean
    baseUrl: string
    headers?: Record<string, string>
    id: string
    maxTokens?: number
    params?: unknown
    provider: string
  }
  selection: {
    modelId: string
    provider: string
    runtimeProvider?: string
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
    stopReason: OpenClawStopReason
  }>
  prepareSimpleCompletionModelForAgent(params: {
    agentId: string
    agentDir?: string
    cfg: OpenClawRuntimeConfig
    skipAgentDiscovery: true
  }): Promise<PreparedSimpleCompletionModel | { error: string }>
}

interface OpenClawWebSearchConfig {
  apiKey?: unknown
  cacheTtlMinutes?: unknown
  enabled?: boolean
  maxResults?: unknown
  openaiCodex?: {
    allowedDomains?: unknown
    contextSize?: unknown
    enabled?: boolean
    mode?: unknown
    userLocation?: unknown
  }
  provider?: string
  timeoutSeconds?: unknown
}

interface OpenClawCodexAppServerConfig {
  args?: unknown
  authToken?: unknown
  clearEnv?: unknown
  command?: unknown
  env?: unknown
  headers?: unknown
  homeScope?: unknown
  networkProxy?: unknown
  transport?: unknown
  url?: unknown
}

export interface OpenClawWebSearchTool {
  execute(
    args: { query: string },
    executionContext?: { signal?: AbortSignal },
  ): Promise<unknown>
}

export interface OpenClawWebSearchProvider {
  createTool(context: {
    agentDir?: string
    config: OpenClawRuntimeConfig
    runtimeMetadata?: unknown
    searchConfig?: OpenClawWebSearchConfig
  }): OpenClawWebSearchTool | null
  envVars: readonly string[]
  id: string
  onboardingScopes?: readonly string[]
  pluginId: string
  requiresCredential?: boolean
}

interface OpenClawRuntimeConfig {
  auth?: {
    profiles?: Record<string, {
      mode?: unknown
      provider?: unknown
    }>
    order?: Record<string, string[]>
  }
  agents?: {
    defaults?: {
      agentRuntime?: unknown
      model?: string | {
        fallbacks?: unknown
        primary?: string
      }
      models?: Record<string, {
        agentRuntime?: unknown
        params?: unknown
      }>
      params?: unknown
    }
    list?: Array<{
      agentRuntime?: unknown
      default?: boolean
      id?: string
      model?: string | {
        fallbacks?: unknown
        primary?: string
      }
      models?: Record<string, {
        agentRuntime?: unknown
        params?: unknown
      }>
      params?: unknown
      runtime?: unknown
    }>
  }
  plugins?: {
    allow?: unknown
    entries?: {
      [pluginId: string]: unknown
      codex?: {
        enabled?: boolean
        config?: {
          appServer?: OpenClawCodexAppServerConfig
        }
      }
    }
    load?: {
      paths?: unknown
    }
  }
  models?: {
    providers?: Record<string, {
      agentRuntime?: unknown
      api?: unknown
      apiKey?: unknown
      auth?: unknown
      authHeader?: unknown
      baseUrl?: unknown
      headers?: unknown
      localService?: unknown
      models?: unknown
      params?: unknown
      request?: unknown
      transport?: unknown
    }>
  }
  tools?: {
    web?: {
      search?: OpenClawWebSearchConfig
    }
  }
}

export interface OpenClawBridgeApi {
  config: OpenClawRuntimeConfig
  runtime: {
    version: string
    config: {
      current(): OpenClawRuntimeConfig
    }
    modelAuth: {
      resolveApiKeyForProvider(params: {
        cfg?: OpenClawRuntimeConfig
        provider: string
        workspaceDir?: string
      }): Promise<OpenClawResolvedProviderAuth>
    }
    webSearch: {
      listProviders(params?: {
        config?: OpenClawRuntimeConfig
      }): readonly OpenClawWebSearchProvider[]
      search(params: {
        agentDir?: string
        args: {
          count: number
          limit: number
          query: string
        }
        config: OpenClawRuntimeConfig
        preferInputConfig: true
        providerId: 'codex'
        signal: AbortSignal
      }): Promise<{
        provider: string
        result: Record<string, unknown>
      }>
    }
  }
}

interface OpenClawCodexProviderRegistration {
  pluginId: string
  provider: OpenClawWebSearchProvider
  rootDir?: string
  source: string
}

interface OpenClawPluginRegistry {
  plugins: CodexPluginRecordForAttestation[]
  webSearchProviders: OpenClawCodexProviderRegistration[]
}

interface BoundCodexSearchProvider {
  attestation: CodexPackageAttestation
  pluginRecord: CodexPluginRecordForAttestation
  provider: OpenClawWebSearchProvider
  registration: OpenClawCodexProviderRegistration
  registry: OpenClawPluginRegistry
  registryRuntime: OpenClawPluginRegistryRuntime
}

export interface OpenClawPluginRegistryRuntime {
  getGlobalPluginRegistry(): OpenClawPluginRegistry | null
}

export type CodexPackageAttestor = (
  record: CodexPluginRecordForAttestation,
) => Promise<CodexPackageAttestation | null>

export interface WebChessBridge {
  close(): Promise<void>
  token: string
  url: string
}

export interface WebChessBridgeOptions {
  agentAuthRuntime?: OpenClawAgentAuthRuntime
  codexPackageAttestor?: CodexPackageAttestor
  environment?: NodeJS.ProcessEnv
  host?: string
  maxConcurrentRuns?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
  readinessProbeTimeoutMs?: number
  pluginRegistryRuntime?: OpenClawPluginRegistryRuntime
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

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isOpenAiAccountOAuth(
  auth: OpenClawResolvedProviderAuth,
): boolean {
  const profileId = auth.profileId?.trim()
  return auth.mode === 'oauth' &&
    Boolean(profileId) &&
    auth.source === `profile:${profileId}`
}

function hasExactOpenAiAuthOrder(
  config: OpenClawRuntimeConfig,
  profileId: string,
): boolean {
  const order = config.auth?.order?.openai
  return Array.isArray(order) &&
    order.length === 1 &&
    order[0]?.trim() === profileId
}

function hasExactOpenAiAccountAuthState(
  runtime: OpenClawAgentAuthRuntime,
  config: OpenClawRuntimeConfig,
  agentDir: string,
  profileId: string,
  expectedOAuthIdentity?: Readonly<Record<string, unknown>>,
): boolean {
  try {
    const configuredProfiles = config.auth?.profiles
    if (configuredProfiles !== undefined) {
      if (!isRecord(configuredProfiles) ||
        Object.keys(configuredProfiles).length !== 1 ||
        !Object.prototype.hasOwnProperty.call(configuredProfiles, profileId)) {
        return false
      }
      const configuredProfile = configuredProfiles[profileId]
      if (!isRecord(configuredProfile) ||
        configuredProfile.mode !== 'oauth' ||
        configuredProfile.provider !== 'openai') return false
    }

    const store = runtime.loadAuthProfileStoreForSecretsRuntime(agentDir, {
      config,
      externalCliProviderIds: ['openai', 'codex-cli'],
    })
    if (!isRecord(store.profiles) ||
      Object.keys(store.profiles).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(store.profiles, profileId)) {
      return false
    }
    const storedProfile = store.profiles[profileId]
    if (!isRecord(storedProfile) ||
      storedProfile.type !== 'oauth' ||
      storedProfile.provider !== 'openai') return false
    const order = runtime.resolveAuthProfileOrder({
      cfg: config,
      provider: 'openai',
      store,
    })
    if (!hasExactOpenAiAuthOrder(config, profileId) ||
      order.length !== 1 || order[0]?.trim() !== profileId) return false
    const currentOAuthIdentity = snapshotOAuthCredentialIdentity(
      store as unknown as Record<string, unknown>,
      profileId,
    )
    if (!currentOAuthIdentity ||
      (expectedOAuthIdentity !== undefined && !isDeepStrictEqual(
        currentOAuthIdentity,
        expectedOAuthIdentity,
      ))) return false

    return true
  } catch {
    // Inspect only profile ids and structural type/provider fields. Store
    // paths, credentials, and resolver details remain private behind the
    // fixed readiness failure below.
    return false
  }
}

function loadBoundOpenAiOAuthStore(
  runtime: OpenClawAgentAuthRuntime,
  config: OpenClawRuntimeConfig,
  agentDir: string,
  profileId: string,
  expectedOAuthIdentity?: Readonly<Record<string, unknown>>,
): Record<string, unknown> | null {
  try {
    const store = runtime.loadAuthProfileStoreForSecretsRuntime(agentDir, {
      config,
      externalCliProviderIds: ['openai', 'codex-cli'],
    })
    if (!isRecord(store.profiles) ||
      Object.keys(store.profiles).length !== 1) return null
    const credential = store.profiles[profileId]
    if (!isRecord(credential) || credential.type !== 'oauth' ||
      credential.provider !== 'openai') return null
    const currentOAuthIdentity = snapshotOAuthCredentialIdentity(
      store as unknown as Record<string, unknown>,
      profileId,
    )
    if (!currentOAuthIdentity ||
      (expectedOAuthIdentity !== undefined && !isDeepStrictEqual(
        currentOAuthIdentity,
        expectedOAuthIdentity,
      ))) return null
    const clonedCredential = structuredClone(credential) as unknown
    if (!isRecord(clonedCredential) || clonedCredential.type !== 'oauth' ||
      clonedCredential.provider !== 'openai') return null
    const clonedStore = {
      order: { openai: [profileId] },
      profiles: { [profileId]: clonedCredential },
      version: store.version,
    }
    return isDeepStrictEqual(
      snapshotOAuthCredentialIdentity(clonedStore, profileId),
      currentOAuthIdentity,
    ) ? clonedStore : null
  } catch {
    return null
  }
}

function hasStableOAuthAccountIdentifier(
  identity: Readonly<Record<string, unknown>>,
): boolean {
  return (typeof identity.accountId === 'string' &&
      Boolean(identity.accountId.trim())) ||
    (typeof identity.email === 'string' && Boolean(identity.email.trim()))
}

function isOpenAiAccountModel(
  prepared: PreparedSimpleCompletionModel,
  config: OpenClawRuntimeConfig,
  expectedProfileId?: string,
): boolean {
  const profileId = prepared.auth.profileId?.trim()
  return prepared.selection.provider.trim().toLowerCase() === 'openai' &&
    (prepared.selection.runtimeProvider === undefined ||
      prepared.selection.runtimeProvider.trim().toLowerCase() === 'openai') &&
    prepared.model.provider.trim().toLowerCase() === 'openai' &&
    prepared.model.api === 'openai-chatgpt-responses' &&
    isOpenAiAccountOAuth(prepared.auth) &&
    Boolean(profileId) &&
    (!expectedProfileId || profileId === expectedProfileId) &&
    hasExactOpenAiAuthOrder(config, profileId ?? '')
}

function hasCanonicalOpenAiAccountModelTransport(
  prepared: PreparedSimpleCompletionModel,
): boolean {
  const rawBaseUrl = prepared.model.baseUrl
  if (rawBaseUrl !== OPENAI_ACCOUNT_MODEL_BASE_URL &&
    rawBaseUrl !== `${OPENAI_ACCOUNT_MODEL_BASE_URL}/`) return false
  try {
    const parsed = new URL(rawBaseUrl)
    if (parsed.protocol !== 'https:' ||
      parsed.hostname !== 'chatgpt.com' ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== '/backend-api/codex' &&
        parsed.pathname !== '/backend-api/codex/')) return false
  } catch {
    return false
  }

  if (prepared.model.headers !== undefined &&
    (!isRecord(prepared.model.headers) ||
      Object.keys(prepared.model.headers).length > 0)) return false
  if (prepared.model.authHeader !== undefined &&
    prepared.model.authHeader !== false) return false
  if (prepared.model.params !== undefined) return false

  const model = prepared.model as unknown as Record<PropertyKey, unknown>
  return model[MODEL_PROVIDER_REQUEST_TRANSPORT] === undefined &&
    model[MODEL_PROVIDER_LOCAL_SERVICE] === undefined
}

function hasCompatibleOpenAiProviderConfig(
  config: OpenClawRuntimeConfig,
): boolean {
  const providers = config.models?.providers
  if (providers === undefined) return true
  if (!isRecord(providers)) return false

  for (const [providerId, provider] of Object.entries(providers)) {
    if (providerId.trim().toLowerCase() !== 'openai' ||
      !isRecord(provider) ||
      Object.keys(provider).length > 0) return false
  }
  return true
}

function resolveExplicitModelPrimary(
  model: unknown,
): { primary: string; safe: boolean } {
  if (typeof model === 'string') {
    const primary = model.trim()
    return {
      primary,
      safe: primary === model && /^openai\/[^/\s]+$/u.test(primary),
    }
  }
  if (!isRecord(model) ||
    !hasOnlyKeys(model, ['fallbacks', 'primary']) ||
    typeof model.primary !== 'string') return { primary: '', safe: false }
  const primary = model.primary.trim()
  const fallbacks = model.fallbacks
  return {
    primary,
    safe: primary === model.primary &&
      /^openai\/[^/\s]+$/u.test(primary) &&
      (fallbacks === undefined ||
        (Array.isArray(fallbacks) && fallbacks.length === 0)),
  }
}

function hasCompatibleModelEntryMap(
  models: unknown,
  primary: string,
): boolean {
  if (models === undefined) return true
  if (!isRecord(models)) return false
  for (const [modelRef, entry] of Object.entries(models)) {
    if (modelRef.trim() !== primary || !isRecord(entry)) return false
    if (Object.prototype.hasOwnProperty.call(entry, 'agentRuntime') ||
      Object.prototype.hasOwnProperty.call(entry, 'params')) return false
  }
  return true
}

function hasCompatibleAgentModelConfig(
  config: OpenClawRuntimeConfig,
  agentId?: string,
): boolean {
  const defaults = config.agents?.defaults
  if (!isRecord(defaults) ||
    Object.prototype.hasOwnProperty.call(defaults, 'agentRuntime') ||
    Object.prototype.hasOwnProperty.call(defaults, 'params')) return false

  const defaultModel = resolveExplicitModelPrimary(defaults.model)
  if (!defaultModel.safe ||
    !hasCompatibleModelEntryMap(defaults.models, defaultModel.primary)) {
    return false
  }
  if (agentId === undefined) return true

  const selected = config.agents?.list?.find((agent) =>
    agent.id?.trim() === agentId)
  if (selected === undefined) return true
  if (Object.prototype.hasOwnProperty.call(selected, 'agentRuntime') ||
    Object.prototype.hasOwnProperty.call(selected, 'params') ||
    Object.prototype.hasOwnProperty.call(selected, 'runtime')) return false

  const effectiveModel = selected.model === undefined
    ? defaultModel
    : resolveExplicitModelPrimary(selected.model)
  return effectiveModel.safe &&
    hasCompatibleModelEntryMap(selected.models, effectiveModel.primary)
}

function hasCompatibleCodexSearchConfig(
  config: OpenClawRuntimeConfig,
): boolean {
  const search = config.tools?.web?.search
  if (!isRecord(search) || !hasOnlyKeys(search, [
    'enabled',
    'openaiCodex',
    'provider',
  ])) return false
  const openaiCodex = search.openaiCodex
  if (openaiCodex !== undefined) {
    if (!isRecord(openaiCodex) || !hasOnlyKeys(openaiCodex, [
      'enabled',
    ])) return false
  }
  const provider = typeof search.provider === 'string'
    ? search.provider.trim().toLowerCase()
    : ''
  return search?.enabled !== false &&
    openaiCodex?.enabled !== false &&
    provider === 'codex'
}

function isBlankOptionalString(value: unknown): boolean {
  return value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim().length === 0)
}

function hasCompatibleCodexAppServerConfig(
  config: OpenClawRuntimeConfig,
  environment: NodeJS.ProcessEnv,
  expectedClearEnv?: readonly string[],
): boolean {
  if (
    environment.OPENCLAW_CODEX_APP_SERVER_BIN?.trim() ||
    environment.OPENCLAW_CODEX_APP_SERVER_ARGS?.trim()
  ) return false

  const appServer = config.plugins?.entries?.codex?.config?.appServer
  if (appServer === undefined) return true
  if (!isRecord(appServer) || !hasOnlyKeys(appServer, [
    'args',
    'authToken',
    'clearEnv',
    'command',
    'env',
    'headers',
    'homeScope',
    'networkProxy',
    'transport',
    'url',
  ])) return false

  const transport = appServer.transport
  if (
    transport !== undefined &&
    (typeof transport !== 'string' || transport.trim() !== 'stdio')
  ) return false

  const homeScope = appServer.homeScope
  if (
    homeScope !== undefined &&
    (typeof homeScope !== 'string' || homeScope.trim() !== 'agent')
  ) return false

  if (!isBlankOptionalString(appServer.command) ||
    !isBlankOptionalString(appServer.url) ||
    !isBlankOptionalString(appServer.authToken)) return false

  if (appServer.env !== undefined || appServer.networkProxy !== undefined) {
    return false
  }

  if (expectedClearEnv === undefined) {
    if (appServer.clearEnv !== undefined) {
      const safeDefault = codexAppServerClearEnv(environment)
      if (!Array.isArray(appServer.clearEnv) ||
        appServer.clearEnv.length !== safeDefault.length ||
        appServer.clearEnv.some((value, index) =>
          value !== safeDefault[index])) return false
    }
  } else if (!Array.isArray(appServer.clearEnv) ||
    appServer.clearEnv.length !== expectedClearEnv.length ||
    appServer.clearEnv.some((value, index) =>
      value !== expectedClearEnv[index])) return false

  if (
    appServer.args !== undefined &&
    (!Array.isArray(appServer.args) || appServer.args.length > 0)
  ) return false

  if (
    appServer.headers !== undefined &&
    (!isRecord(appServer.headers) || Object.keys(appServer.headers).length > 0)
  ) return false

  return true
}

async function hasOpenAiAccountSearchAuth(
  api: OpenClawBridgeApi,
  authRuntime: OpenClawAgentAuthRuntime,
  config: OpenClawRuntimeConfig,
  agentDir: string,
  workspaceDir: string,
  expectedProfileId: string,
  expectedOAuthIdentity?: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  if (!hasExactOpenAiAccountAuthState(
    authRuntime,
    config,
    agentDir,
    expectedProfileId,
    expectedOAuthIdentity,
  )) return false
  try {
    const auth = await api.runtime.modelAuth.resolveApiKeyForProvider({
      cfg: config,
      provider: 'openai',
      workspaceDir,
    })
    return isOpenAiAccountOAuth(auth) &&
      auth.profileId?.trim() === expectedProfileId &&
      hasExactOpenAiAccountAuthState(
        authRuntime,
        config,
        agentDir,
        expectedProfileId,
        expectedOAuthIdentity,
      )
  } catch {
    // Auth resolution can contain profile ids, paths, or provider detail.
    // The bridge exposes only the fixed account-auth remediation below.
    return false
  }
}

function hasProviderSecretEnvironment(
  environment: NodeJS.ProcessEnv,
): boolean {
  return Object.entries(environment).some(([rawName, rawValue]) => {
    if (rawValue === undefined || rawValue === '') return false
    const name = rawName.trim().toUpperCase()
    return !PROVIDER_CREDENTIAL_ENVIRONMENT_ALLOWLIST.has(name) &&
      isProviderCredentialEnvironmentName(name)
  })
}

function isProviderCredentialEnvironmentName(name: string): boolean {
  return PROVIDER_CREDENTIAL_ENVIRONMENT_EXACT_NAMES.has(name) ||
    /(?:^|_)(?:API_)?KEYS?$/u.test(name) ||
    /(?:^|_)API_KEY_.*$/u.test(name) ||
    /(?:^|_)(?:ACCESS|API|AUTH|BEARER|BOT|OAUTH)_TOKENS?$/u.test(name) ||
    /(?:^|_)(?:AUTHTOKEN|TOKENS?|SESSION_KEYS?)$/u.test(name) ||
    /(?:^|_)(?:(?:ACCESS|API|AUTH|BEARER|BOT|OAUTH)_)?TOKENS?_(?:FILE|PATH|FILE_DESCRIPTOR|FD)$/u
      .test(name) ||
    /(?:^|_)COOKIES?$/u.test(name) ||
    /(?:^|_)(?:CREDENTIALS?|CREDENTIALS?_FILE|KEY_FILE|TOKEN_FILE)$/u
      .test(name) ||
    /(?:^|_)(?:PRIVATE_KEY|CERTIFICATE)_(?:PATH|FILE|FILE_DESCRIPTOR|FD|P8|PEM|P12|PFX|B64|BASE64|JSON)$/u
      .test(name) ||
    /(?:^|_)(?:PASSWORD|PRIVATE_KEY|SECRETS?)$/u.test(name) ||
    /^OPENCLAW_LIVE_.+_KEYS?$/u.test(name)
}

const UNSAFE_PROVIDER_TRANSPORT_ENVIRONMENT_NAMES = new Set([
    'ALL_PROXY',
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
    'CODEX_SANDBOX',
    'CURL_CA_BUNDLE',
    'DOCKER_HTTP_PROXY',
    'DOCKER_HTTPS_PROXY',
    'DYLD_INSERT_LIBRARIES',
    'ELECTRON_GET_USE_PROXY',
    'FTP_PROXY',
    'GIT_SSL_CAINFO',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'LD_PRELOAD',
    'NODE_DEBUG',
    'NODE_DEBUG_NATIVE',
    'NODE_OPTIONS',
    'NODE_PATH',
    'NODE_USE_BUNDLED_CA',
    'NODE_USE_ENV_PROXY',
    'NODE_USE_OPENSSL_CA',
    'NODE_USE_SYSTEM_CA',
    'NO_PROXY',
    'NPM_CONFIG_CAFILE',
    'NPM_CONFIG_HTTP_PROXY',
    'NPM_CONFIG_HTTPS_PROXY',
    'NPM_CONFIG_NOPROXY',
    'NPM_CONFIG_PROXY',
    'OPENAI_API_BASE',
    'OPENAI_BASE_URL',
    'OPENAI_CUSTOM_HEADERS',
    'OPENAI_ORGANIZATION',
    'OPENAI_ORG_ID',
    'OPENAI_PROJECT',
    'OPENAI_PROJECT_ID',
    'OPENAI_LOG',
    'OPENCLAW_BUILD_PRIVATE_QA',
    'OPENCLAW_DEBUG_PROXY_BLOB_DIR',
    'OPENCLAW_DEBUG_PROXY_DB_PATH',
    'OPENCLAW_DEBUG_PROXY_ENABLED',
    'OPENCLAW_DEBUG_PROXY_REQUIRE',
    'OPENCLAW_DEBUG_PROXY_URL',
    'OPENCLAW_ENABLE_PRIVATE_QA_CLI',
    'OPENCLAW_QA_FORCE_RUNTIME',
    'OPENSSL_CONF',
    'PIP_PROXY',
    'REQUESTS_CA_BUNDLE',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
    'SSLKEYLOGFILE',
    'WSS_PROXY',
    'YARN_HTTP_PROXY',
    'YARN_NO_PROXY',
    '__CODEX_SNAPSHOT_OVERRIDE',
    '__CODEX_SNAPSHOT_PROXY_OVERRIDE',
])

function isUnsafeProviderTransportEnvironmentName(name: string): boolean {
  return UNSAFE_PROVIDER_TRANSPORT_ENVIRONMENT_NAMES.has(name) ||
    name === 'NODE_EXTRA_CA_CERTS' ||
    name === 'NODE_TLS_REJECT_UNAUTHORIZED' ||
    name === OPENCLAW_AUTO_CA_MARKER ||
    name.startsWith('CODEX_NETWORK_PROXY_') ||
    name.startsWith('OPENCLAW_DEBUG_PROXY_') ||
    name.startsWith('OPENCLAW_QA_')
}

function hasUnsafeProviderTransportEnvironment(
  environment: NodeJS.ProcessEnv,
): boolean {
  const autoCaAccepted = hasAttestedOpenClawSystemCa(environment)
  return Object.entries(environment).some(([rawName, rawValue]) => {
    if (rawValue === undefined || rawValue === '') return false
    const name = rawName.trim().toUpperCase()
    if (name === 'NODE_EXTRA_CA_CERTS' || name === OPENCLAW_AUTO_CA_MARKER) {
      return !autoCaAccepted
    }
    if (name === 'NODE_TLS_REJECT_UNAUTHORIZED') return rawValue !== '1'
    return isUnsafeProviderTransportEnvironmentName(name)
  })
}

function hasAttestedOpenClawSystemCa(
  environment: NodeJS.ProcessEnv,
): boolean {
  const caPath = environment.NODE_EXTRA_CA_CERTS
  const marker = environment[OPENCLAW_AUTO_CA_MARKER]
  if (!caPath && !marker) return false
  if (process.platform !== 'linux' || marker !== '1' || !caPath) return false
  const firstReadable = LINUX_SYSTEM_CA_PATHS.find((candidate) => {
    try {
      accessSync(candidate, fsConstants.R_OK)
      return true
    } catch {
      return false
    }
  })
  return caPath === firstReadable
}

function snapshotRuntimeConfig(
  config: OpenClawRuntimeConfig,
): OpenClawRuntimeConfig | null {
  try {
    const snapshot = structuredClone(config) as unknown
    return isRecord(snapshot) ? snapshot as OpenClawRuntimeConfig : null
  } catch {
    return null
  }
}

function codexAppServerClearEnv(
  environment: NodeJS.ProcessEnv,
): string[] {
  const names = new Set<string>(CODEX_APP_SERVER_ALWAYS_CLEAR_ENV)
  for (const rawName of Object.keys(environment)) {
    const exactName = rawName.trim()
    const name = exactName.toUpperCase()
    if (!name || name === 'CODEX_HOME') continue
    if (isProviderCredentialEnvironmentName(name) ||
      isUnsafeProviderTransportEnvironmentName(name) ||
      /^(?:PG|POSTGRES|SSH_)/u.test(name) ||
      /(?:^|_)(?:BRIDGE|DATABASE|HMAC)(?:_|$)/u.test(name) ||
      /(?:^|_)(?:PASSWORD|PRIVATE_KEY|SECRET)(?:_|$)/u.test(name)) {
      names.add(name)
      names.add(exactName)
    }
  }
  return [...names].sort()
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }
  return value
}

function hardenedRuntimeConfig(
  config: OpenClawRuntimeConfig,
  clearEnv: readonly string[],
): OpenClawRuntimeConfig | null {
  const snapshot = snapshotRuntimeConfig(config)
  if (!snapshot || !snapshot.plugins) return null
  const entries = isRecord(snapshot.plugins.entries)
    ? snapshot.plugins.entries
    : {}
  const codexEntry = isRecord(entries.codex) ? entries.codex : {}
  const codexConfig = isRecord(codexEntry.config) ? codexEntry.config : {}
  const appServer = isRecord(codexConfig.appServer)
    ? codexConfig.appServer
    : {}
  snapshot.plugins.entries = {
    ...entries,
    codex: {
      ...codexEntry,
      config: {
        ...codexConfig,
        appServer: {
          ...appServer,
          clearEnv: [...clearEnv],
        },
      },
    },
  }
  return deepFreeze(snapshot)
}

interface RuntimeConfigGuard {
  executionConfig: OpenClawRuntimeConfig
  readValidated(): OpenClawRuntimeConfig | null
  restore(): void
}

function installRuntimeConfigGuard(
  api: OpenClawBridgeApi,
  liveBaseline: OpenClawRuntimeConfig,
  clearEnv: readonly string[],
): RuntimeConfigGuard | null {
  const target = api.runtime.config
  const originalDescriptor = Object.getOwnPropertyDescriptor(target, 'current')
  const originalCurrent = target.current.bind(target)
  const executionConfig = hardenedRuntimeConfig(liveBaseline, clearEnv)
  if (!executionConfig) return null
  const guardedCurrent = () => executionConfig
  try {
    Object.defineProperty(target, 'current', {
      configurable: true,
      enumerable: originalDescriptor?.enumerable ?? true,
      value: guardedCurrent,
      writable: false,
    })
  } catch {
    return null
  }

  let restored = false
  return {
    executionConfig,
    readValidated() {
      if (restored || target.current !== guardedCurrent) return null
      try {
        const current = snapshotRuntimeConfig(originalCurrent())
        return current && isDeepStrictEqual(current, liveBaseline)
          ? executionConfig
          : null
      } catch {
        return null
      }
    },
    restore() {
      if (restored) return
      restored = true
      try {
        if (originalDescriptor) {
          Object.defineProperty(target, 'current', originalDescriptor)
        } else {
          Object.defineProperty(target, 'current', {
            configurable: true,
            enumerable: true,
            value: originalCurrent,
            writable: true,
          })
        }
      } catch {
        // This dedicated CLI process is shutting down. Never replace a value
        // installed by another owner while attempting best-effort restoration.
      }
    },
  }
}

function isCompatibleCodexProvider(
  provider: OpenClawWebSearchProvider,
): boolean {
  return provider.id === 'codex' &&
    provider.pluginId === 'codex' &&
    provider.requiresCredential === false &&
    provider.envVars.length === 0 &&
    provider.onboardingScopes?.includes('text-inference') === true
}

async function loadPluginRegistryRuntime(): Promise<OpenClawPluginRegistryRuntime> {
  return await import(
    'openclaw/plugin-sdk/plugin-runtime'
  ) as unknown as OpenClawPluginRegistryRuntime
}

type BoundCodexResolution = {
  bound: BoundCodexSearchProvider
  error: null
} | {
  bound: null
  error: string
}

async function resolveBoundCodexSearchProvider(
  api: OpenClawBridgeApi,
  config: OpenClawRuntimeConfig,
  registryRuntime: OpenClawPluginRegistryRuntime,
  attestor: CodexPackageAttestor,
): Promise<BoundCodexResolution> {
  try {
    const registry = registryRuntime.getGlobalPluginRegistry()
    if (!registry) return { bound: null, error: CODEX_SEARCH_PROVIDER_ERROR }
    const records = registry.plugins.filter((record) => record.id === 'codex')
    const registrations = registry.webSearchProviders.filter((entry) =>
      entry.pluginId === 'codex' && entry.provider.id === 'codex')
    const listed = api.runtime.webSearch.listProviders({ config })
      .filter((provider) => provider.id === 'codex')
    if (records.length === 0 || registrations.length === 0 || listed.length === 0) {
      return { bound: null, error: CODEX_SEARCH_PROVIDER_ERROR }
    }
    if (records.length !== 1 || registrations.length !== 1 ||
      listed.length !== 1) {
      return { bound: null, error: CODEX_SEARCH_ATTESTATION_ERROR }
    }
    const [record] = records
    const [registration] = registrations
    const [provider] = listed
    if (!record || !registration || !provider ||
      !isOfficialCodexPluginRecord(record) ||
      !isCompatibleCodexProvider(provider) ||
      registration.provider !== provider ||
      registration.source !== record.source ||
      registration.rootDir !== record.rootDir) {
      return { bound: null, error: CODEX_SEARCH_ATTESTATION_ERROR }
    }
    const attestation = await attestor(record)
    if (!attestation || !await attestation.revalidate()) {
      return { bound: null, error: CODEX_SEARCH_ATTESTATION_ERROR }
    }
    return {
      bound: {
        attestation,
        pluginRecord: record,
        provider,
        registration,
        registry,
        registryRuntime,
      },
      error: null,
    }
  } catch {
    return { bound: null, error: CODEX_SEARCH_ATTESTATION_ERROR }
  }
}

async function revalidateBoundCodexSearchProvider(
  api: OpenClawBridgeApi,
  config: OpenClawRuntimeConfig,
  bound: BoundCodexSearchProvider,
): Promise<boolean> {
  try {
    const registry = bound.registryRuntime.getGlobalPluginRegistry()
    if (registry !== bound.registry ||
      registry.plugins.filter((record) => record.id === 'codex').length !== 1 ||
      registry.plugins.find((record) => record.id === 'codex') !==
        bound.pluginRecord ||
      registry.webSearchProviders.filter((entry) =>
        entry.pluginId === 'codex' && entry.provider.id === 'codex').length !== 1 ||
      registry.webSearchProviders.find((entry) =>
        entry.pluginId === 'codex' && entry.provider.id === 'codex') !==
        bound.registration ||
      bound.registration.provider !== bound.provider ||
      bound.registration.source !== bound.pluginRecord.source ||
      bound.registration.rootDir !== bound.pluginRecord.rootDir ||
      !isOfficialCodexPluginRecord(bound.pluginRecord) ||
      !isCompatibleCodexProvider(bound.provider)) return false
    const listed = api.runtime.webSearch.listProviders({ config })
      .filter((provider) => provider.id === 'codex')
    return listed.length === 1 && listed[0] === bound.provider &&
      await bound.attestation.revalidate()
  } catch {
    return false
  }
}

function isValidCodexSearchResult(value: unknown, query: string): boolean {
  if (!isRecord(value) ||
    value.query !== query ||
    value.provider !== 'codex' ||
    typeof value.model !== 'string' || !value.model.trim() ||
    typeof value.tookMs !== 'number' ||
    !Number.isSafeInteger(value.tookMs) || value.tookMs < 0 ||
    typeof value.content !== 'string' || !value.content.trim() ||
    !Array.isArray(value.searches) || value.searches.length === 0 ||
    !isRecord(value.externalContent)) return false
  const boundary = value.externalContent
  return boundary.untrusted === true &&
    boundary.source === 'web_search' &&
    boundary.provider === 'codex' &&
    boundary.wrapped === true
}

async function runCodexSearchReadinessProbe(
  bound: BoundCodexSearchProvider,
  config: OpenClawRuntimeConfig,
  agentDir: string,
  authProfileId: string,
  authProfileStore: Record<string, unknown>,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController()
  const timedOut = Symbol('codex-search-readiness-timeout')
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const timeoutResult = new Promise<typeof timedOut>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort()
        resolve(timedOut)
      }, timeoutMs)
    })
    const execution = Promise.resolve().then(async () =>
      await bound.attestation.executeSearch({
        agentDir,
        authProfileId,
        authProfileStore,
        config: config as unknown as Record<string, unknown>,
        query: CODEX_SEARCH_READINESS_QUERY,
        searchConfig: config.tools?.web?.search as
          Record<string, unknown> | undefined,
        signal: controller.signal,
      }))
    const result = await Promise.race([
      execution,
      timeoutResult,
    ])
    if (result === timedOut) {
      // The pinned stdio client escalates close to process-group SIGKILL after
      // one second. Always keep this owning process alive for the complete
      // reviewed drain window, even when the JS task rejects first.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, CODEX_SEARCH_ABORT_DRAIN_MS)
      })
      return false
    }
    return result !== timedOut &&
      !controller.signal.aborted &&
      isValidCodexSearchResult(result, CODEX_SEARCH_READINESS_QUERY)
  } catch {
    return false
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

async function runOpenAiModelReadinessProbe(
  simpleCompletion: SimpleCompletionRuntime,
  prepared: PreparedSimpleCompletionModel,
  config: OpenClawRuntimeConfig,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController()
  const timedOut = Symbol('openai-model-readiness-timeout')
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const timeoutResult = new Promise<typeof timedOut>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort()
        resolve(timedOut)
      }, timeoutMs)
    })
    const result = await Promise.race([
      simpleCompletion.completeWithPreparedSimpleCompletionModel({
        auth: prepared.auth,
        cfg: config,
        context: {
          messages: [{
            content: OPENAI_MODEL_READINESS_PROMPT,
            role: 'user',
            timestamp: Date.now(),
          }],
          systemPrompt: OPENCLAW_LOCAL_MODEL_RUN_SYSTEM_PROMPT,
        },
        model: prepared.model,
        options: {
          maxTokens: 16,
          reasoning: 'low',
          signal: controller.signal,
        },
      }),
      timeoutResult,
    ])
    if (result === timedOut || controller.signal.aborted ||
      result.stopReason !== 'stop' || result.errorMessage) return false
    const output = result.content.map((block) =>
      block.type === 'text' && typeof block.text === 'string'
        ? block.text
        : '').join('')
    return output === OPENAI_MODEL_READINESS_RESPONSE
  } catch {
    return false
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function hasCompatiblePluginConfig(config: OpenClawRuntimeConfig): boolean {
  const plugins = config.plugins
  if (!isRecord(plugins) || !Array.isArray(plugins.allow) ||
    plugins.allow.length !== 2) return false
  const allow = plugins.allow.map((value) =>
    typeof value === 'string' ? value.trim().toLowerCase() : '')
  if (new Set(allow).size !== 2 ||
    !allow.includes('codex') ||
    !allow.includes('webchess')) return false

  const load = plugins.load
  if (load !== undefined &&
    (!isRecord(load) ||
      Object.prototype.hasOwnProperty.call(load, 'paths'))) return false

  const entries = plugins.entries
  if (entries === undefined) return true
  if (!isRecord(entries) || !Object.keys(entries).every((pluginId) => {
    const normalized = pluginId.trim().toLowerCase()
    return normalized === 'codex' || normalized === 'webchess'
  })) return false
  const codexEntry = entries.codex
  if (codexEntry === undefined) return true
  if (!isRecord(codexEntry) || !hasOnlyKeys(codexEntry, [
    'config',
    'enabled',
  ]) || (codexEntry.enabled !== undefined && codexEntry.enabled !== true)) {
    return false
  }
  const codexConfig = codexEntry.config
  return codexConfig === undefined ||
    (isRecord(codexConfig) && hasOnlyKeys(codexConfig, ['appServer']))
}

function staticReadinessFailure(
  api: OpenClawBridgeApi,
  config: OpenClawRuntimeConfig,
  environment: NodeJS.ProcessEnv,
  _agentDir?: string,
  agentId?: string,
  expectedClearEnv?: readonly string[],
): string | null {
  if (api.runtime.version !== PINNED_OPENCLAW_RUNTIME_VERSION) {
    return OPENCLAW_RUNTIME_VERSION_ERROR
  }
  if (hasProviderSecretEnvironment(environment)) {
    return PROVIDER_SECRET_ENV_ERROR
  }
  if (hasUnsafeProviderTransportEnvironment(environment) ||
    !hasCompatibleOpenAiProviderConfig(config) ||
    !hasCompatibleAgentModelConfig(config, agentId)) {
    return OPENAI_ACCOUNT_TRANSPORT_ERROR
  }
  if (!hasCompatibleCodexSearchConfig(config)) {
    return CODEX_SEARCH_CONFIG_ERROR
  }
  if (!hasCompatibleCodexAppServerConfig(
    config,
    environment,
    expectedClearEnv,
  )) {
    return CODEX_SEARCH_RUNTIME_ERROR
  }
  if (!hasCompatiblePluginConfig(config)) {
    return OPENCLAW_PLUGIN_CONFIG_ERROR
  }
  return null
}

type AccountModelPreparation = {
  ok: true
  prepared: PreparedSimpleCompletionModel
} | {
  message: string
  ok: false
}

async function prepareOpenAiAccountModel(
  simpleCompletion: SimpleCompletionRuntime,
  authRuntime: OpenClawAgentAuthRuntime,
  config: OpenClawRuntimeConfig,
  agentId: string,
  agentDir: string,
  expectedProfileId?: string,
  expectedOAuthIdentity?: Readonly<Record<string, unknown>>,
): Promise<AccountModelPreparation> {
  let prepared: PreparedSimpleCompletionModel | { error: string }
  try {
    prepared = await simpleCompletion.prepareSimpleCompletionModelForAgent({
      agentId,
      agentDir,
      cfg: config,
      skipAgentDiscovery: true,
    })
  } catch {
    return { message: OPENAI_ACCOUNT_AUTH_ERROR, ok: false }
  }
  if ('error' in prepared ||
    !isOpenAiAccountModel(prepared, config, expectedProfileId)) {
    return { message: OPENAI_ACCOUNT_AUTH_ERROR, ok: false }
  }
  if (!hasCanonicalOpenAiAccountModelTransport(prepared)) {
    return { message: OPENAI_ACCOUNT_TRANSPORT_ERROR, ok: false }
  }
  const profileId = prepared.auth.profileId?.trim()
  if (!profileId || !hasExactOpenAiAccountAuthState(
    authRuntime,
    config,
    agentDir,
    profileId,
    expectedOAuthIdentity,
  )) {
    return { message: OPENAI_ACCOUNT_AUTH_ERROR, ok: false }
  }
  return { ok: true, prepared }
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

async function loadAgentAuthRuntime(): Promise<OpenClawAgentAuthRuntime> {
  return await import(
    'openclaw/plugin-sdk/agent-runtime'
  ) as unknown as OpenClawAgentAuthRuntime
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
  const environment = options.environment ?? process.env
  const host = options.host ?? LOOPBACK_HOST
  if (host !== LOOPBACK_HOST) {
    throw new Error('The WebChess bridge must bind to 127.0.0.1.')
  }
  const maxRequestBytes = options.maxRequestBytes ?? MAX_BRIDGE_REQUEST_BYTES
  const maxResponseBytes = options.maxResponseBytes ?? MAX_BRIDGE_RESPONSE_BYTES
  const maxConcurrentRuns = options.maxConcurrentRuns ?? MAX_CONCURRENT_RUNS
  const requestedReadinessTimeout = options.readinessProbeTimeoutMs
  const readinessProbeTimeoutMs =
    typeof requestedReadinessTimeout === 'number' &&
    Number.isSafeInteger(requestedReadinessTimeout) &&
    requestedReadinessTimeout > 0
      ? Math.min(
          requestedReadinessTimeout,
          OPENAI_MODEL_READINESS_TIMEOUT_MS,
          CODEX_SEARCH_READINESS_TIMEOUT_MS,
        )
      : Math.min(
          OPENAI_MODEL_READINESS_TIMEOUT_MS,
          CODEX_SEARCH_READINESS_TIMEOUT_MS,
        )
  const token = options.token ?? randomBytes(32).toString('base64url')
  if (Buffer.byteLength(token, 'utf8') < 32) {
    throw new Error('The WebChess bridge bearer must contain at least 32 bytes.')
  }
  const startupConfig = (() => {
    try {
      return snapshotRuntimeConfig(api.runtime.config.current())
    } catch {
      return null
    }
  })()
  if (!startupConfig) throw new Error(OPENAI_ACCOUNT_TRANSPORT_ERROR)
  const initialFailure = staticReadinessFailure(
    api,
    startupConfig,
    environment,
  )
  if (initialFailure) throw new Error(initialFailure)

  let agentAuthRuntime: OpenClawAgentAuthRuntime
  let agentId = ''
  let agentDir = ''
  let agentWorkspaceDir = ''
  try {
    agentAuthRuntime = options.agentAuthRuntime ??
      await loadAgentAuthRuntime()
    agentId = agentAuthRuntime.resolveDefaultAgentId(startupConfig).trim()
    agentDir = agentAuthRuntime.resolveAgentDir(
      startupConfig,
      agentId,
      environment,
    ).trim()
    agentWorkspaceDir = agentAuthRuntime.resolveAgentWorkspaceDir(
      startupConfig,
      agentId,
      environment,
    ).trim()
  } catch {
    throw new Error(OPENAI_ACCOUNT_AUTH_ERROR)
  }
  if (!agentId || !agentDir || !agentWorkspaceDir) {
    throw new Error(OPENAI_ACCOUNT_AUTH_ERROR)
  }

  const resolvedFailure = staticReadinessFailure(
    api,
    startupConfig,
    environment,
    agentDir,
    agentId,
  )
  if (resolvedFailure) throw new Error(resolvedFailure)

  const clearEnv = codexAppServerClearEnv(environment)
  const runtimeConfigGuard = installRuntimeConfigGuard(
    api,
    startupConfig,
    clearEnv,
  )
  if (!runtimeConfigGuard) throw new Error(OPENAI_ACCOUNT_TRANSPORT_ERROR)
  const guardedStartupFailure = staticReadinessFailure(
    api,
    runtimeConfigGuard.executionConfig,
    environment,
    agentDir,
    agentId,
    clearEnv,
  )
  if (guardedStartupFailure) {
    runtimeConfigGuard.restore()
    throw new Error(guardedStartupFailure)
  }

  try {
    let pluginRegistryRuntime: OpenClawPluginRegistryRuntime
    try {
      pluginRegistryRuntime = options.pluginRegistryRuntime ??
        await loadPluginRegistryRuntime()
    } catch {
      throw new Error(CODEX_SEARCH_ATTESTATION_ERROR)
    }
    const boundResolution = await resolveBoundCodexSearchProvider(
      api,
      runtimeConfigGuard.executionConfig,
      pluginRegistryRuntime,
      options.codexPackageAttestor ?? attestOfficialCodexPackage,
    )
    if (!boundResolution.bound) throw new Error(boundResolution.error)
    const boundCodexProvider = boundResolution.bound
    if (!await revalidateBoundCodexSearchProvider(
      api,
      runtimeConfigGuard.executionConfig,
      boundCodexProvider,
    )) throw new Error(CODEX_SEARCH_ATTESTATION_ERROR)

  const accountProfileId = runtimeConfigGuard.executionConfig.auth
    ?.order?.openai?.[0]?.trim()
  const hasBaselineAuthState = accountProfileId
    ? hasExactOpenAiAccountAuthState(
        agentAuthRuntime,
        runtimeConfigGuard.executionConfig,
        agentDir,
        accountProfileId,
      )
    : false
  const baselineAuthStore = accountProfileId && hasBaselineAuthState
    ? loadBoundOpenAiOAuthStore(
        agentAuthRuntime,
        runtimeConfigGuard.executionConfig,
        agentDir,
        accountProfileId,
      )
    : null
  const accountOAuthIdentity = baselineAuthStore && accountProfileId
    ? snapshotOAuthCredentialIdentity(baselineAuthStore, accountProfileId)
    : null
  if (!accountProfileId || !accountOAuthIdentity ||
    !hasBaselineAuthState ||
    !hasStableOAuthAccountIdentifier(accountOAuthIdentity) ||
    !hasExactOpenAiAccountAuthState(
      agentAuthRuntime,
      runtimeConfigGuard.executionConfig,
      agentDir,
      accountProfileId,
      accountOAuthIdentity,
    )) throw new Error(OPENAI_ACCOUNT_AUTH_ERROR)

  let simpleCompletion: SimpleCompletionRuntime
  try {
    simpleCompletion = options.simpleCompletionRuntime ??
      await loadSimpleCompletionRuntime()
  } catch {
    throw new Error(OPENAI_ACCOUNT_AUTH_ERROR)
  }
  const preflightResult = await prepareOpenAiAccountModel(
    simpleCompletion,
    agentAuthRuntime,
    runtimeConfigGuard.executionConfig,
    agentId,
    agentDir,
    accountProfileId,
    accountOAuthIdentity,
  )
  if (!preflightResult.ok) throw new Error(preflightResult.message)
  const preflight = preflightResult.prepared
  if (preflight.auth.profileId?.trim() !== accountProfileId ||
    !await hasOpenAiAccountSearchAuth(
      api,
      agentAuthRuntime,
      runtimeConfigGuard.executionConfig,
      agentDir,
      agentWorkspaceDir,
      accountProfileId,
      accountOAuthIdentity,
    )) {
    throw new Error(OPENAI_ACCOUNT_AUTH_ERROR)
  }
  const currentStartupConfig = runtimeConfigGuard.readValidated()
  if (!currentStartupConfig) throw new Error(OPENAI_ACCOUNT_TRANSPORT_ERROR)
  const postPreflightFailure = staticReadinessFailure(
    api,
    currentStartupConfig,
    environment,
    agentDir,
    agentId,
  )
  if (postPreflightFailure) throw new Error(postPreflightFailure)
  if (!isOpenAiAccountModel(
    preflight,
    currentStartupConfig,
    accountProfileId,
  ) || !hasCanonicalOpenAiAccountModelTransport(preflight) ||
    !hasExactOpenAiAccountAuthState(
      agentAuthRuntime,
      currentStartupConfig,
      agentDir,
      accountProfileId,
      accountOAuthIdentity,
  )) {
    throw new Error(OPENAI_ACCOUNT_AUTH_ERROR)
  }
  if (!await runOpenAiModelReadinessProbe(
    simpleCompletion,
    preflight,
    currentStartupConfig,
    readinessProbeTimeoutMs,
  )) {
    throw new Error(OPENAI_MODEL_PROBE_ERROR)
  }
  const postModelProbeConfig = runtimeConfigGuard.readValidated()
  if (!postModelProbeConfig) throw new Error(OPENAI_ACCOUNT_TRANSPORT_ERROR)
  const postModelProbeFailure = staticReadinessFailure(
    api,
    postModelProbeConfig,
    environment,
    agentDir,
    agentId,
  )
  if (postModelProbeFailure) throw new Error(postModelProbeFailure)
  if (!await revalidateBoundCodexSearchProvider(
    api,
    postModelProbeConfig,
    boundCodexProvider,
  )) throw new Error(CODEX_SEARCH_ATTESTATION_ERROR)
  if (!await hasOpenAiAccountSearchAuth(
    api,
    agentAuthRuntime,
    postModelProbeConfig,
    agentDir,
    agentWorkspaceDir,
    accountProfileId,
    accountOAuthIdentity,
  )) {
    throw new Error(OPENAI_ACCOUNT_AUTH_ERROR)
  }
  const searchProbeConfig = runtimeConfigGuard.readValidated()
  if (!searchProbeConfig) throw new Error(OPENAI_ACCOUNT_TRANSPORT_ERROR)
  const searchProbeFailure = staticReadinessFailure(
    api,
    searchProbeConfig,
    environment,
    agentDir,
    agentId,
  )
  if (searchProbeFailure) throw new Error(searchProbeFailure)
  if (!isOpenAiAccountModel(
    preflight,
    searchProbeConfig,
    accountProfileId,
  ) || !hasCanonicalOpenAiAccountModelTransport(preflight) ||
    !hasExactOpenAiAccountAuthState(
      agentAuthRuntime,
      searchProbeConfig,
      agentDir,
      accountProfileId,
      accountOAuthIdentity,
  )) {
    throw new Error(OPENAI_ACCOUNT_AUTH_ERROR)
  }
  if (!await revalidateBoundCodexSearchProvider(
    api,
    searchProbeConfig,
    boundCodexProvider,
  )) throw new Error(CODEX_SEARCH_ATTESTATION_ERROR)
  const readinessAuthStore = loadBoundOpenAiOAuthStore(
    agentAuthRuntime,
    searchProbeConfig,
    agentDir,
    accountProfileId,
    accountOAuthIdentity,
  )
  if (!readinessAuthStore) throw new Error(OPENAI_ACCOUNT_AUTH_ERROR)
  if (!await runCodexSearchReadinessProbe(
    boundCodexProvider,
    searchProbeConfig,
    agentDir,
    accountProfileId,
    readinessAuthStore,
    readinessProbeTimeoutMs,
  )) {
    throw new Error(CODEX_SEARCH_PROBE_ERROR)
  }
  const postProbeConfig = runtimeConfigGuard.readValidated()
  if (!postProbeConfig) throw new Error(OPENAI_ACCOUNT_TRANSPORT_ERROR)
  const postProbeFailure = staticReadinessFailure(
    api,
    postProbeConfig,
    environment,
    agentDir,
    agentId,
  )
  if (postProbeFailure) throw new Error(postProbeFailure)
  if (!await revalidateBoundCodexSearchProvider(
    api,
    postProbeConfig,
    boundCodexProvider,
  )) throw new Error(CODEX_SEARCH_ATTESTATION_ERROR)
  if (!await hasOpenAiAccountSearchAuth(
    api,
    agentAuthRuntime,
    postProbeConfig,
    agentDir,
    agentWorkspaceDir,
    accountProfileId,
    accountOAuthIdentity,
  )) {
    throw new Error(OPENAI_ACCOUNT_AUTH_ERROR)
  }
  const finalStartupConfig = runtimeConfigGuard.readValidated()
  if (!finalStartupConfig) throw new Error(OPENAI_ACCOUNT_TRANSPORT_ERROR)
  const finalStartupFailure = staticReadinessFailure(
    api,
    finalStartupConfig,
    environment,
    agentDir,
    agentId,
  )
  if (finalStartupFailure) throw new Error(finalStartupFailure)
  if (!await revalidateBoundCodexSearchProvider(
    api,
    finalStartupConfig,
    boundCodexProvider,
  )) throw new Error(CODEX_SEARCH_ATTESTATION_ERROR)
  if (!isOpenAiAccountModel(
    preflight,
    finalStartupConfig,
    accountProfileId,
  ) || !hasCanonicalOpenAiAccountModelTransport(preflight) ||
    !hasExactOpenAiAccountAuthState(
      agentAuthRuntime,
      finalStartupConfig,
      agentDir,
      accountProfileId,
      accountOAuthIdentity,
    )) {
    throw new Error(OPENAI_ACCOUNT_AUTH_ERROR)
  }
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
        const statusConfig = runtimeConfigGuard.readValidated()
        if (!statusConfig) {
          throw new BridgeRequestError(
            503,
            'OPENCLAW_NOT_READY',
            OPENAI_ACCOUNT_TRANSPORT_ERROR,
          )
        }
        const statusFailure = staticReadinessFailure(
          api,
          statusConfig,
          environment,
          agentDir,
          agentId,
        )
        if (statusFailure) {
          throw new BridgeRequestError(
            503,
            'OPENCLAW_NOT_READY',
            statusFailure,
          )
        }
        if (!await revalidateBoundCodexSearchProvider(
          api,
          statusConfig,
          boundCodexProvider,
        )) {
          throw new BridgeRequestError(
            503,
            'OPENCLAW_NOT_READY',
            CODEX_SEARCH_ATTESTATION_ERROR,
          )
        }
        const statusModelResult = await prepareOpenAiAccountModel(
          simpleCompletion,
          agentAuthRuntime,
          statusConfig,
          agentId,
          agentDir,
          accountProfileId,
          accountOAuthIdentity,
        )
        if (!statusModelResult.ok) {
          throw new BridgeRequestError(
            503,
            'OPENCLAW_NOT_READY',
            statusModelResult.message,
          )
        }
        if (!await hasOpenAiAccountSearchAuth(
          api,
          agentAuthRuntime,
          statusConfig,
          agentDir,
          agentWorkspaceDir,
          accountProfileId,
          accountOAuthIdentity,
        )) {
          throw new BridgeRequestError(
            503,
            'OPENCLAW_NOT_READY',
            OPENAI_ACCOUNT_AUTH_ERROR,
          )
        }
        const postStatusConfig = runtimeConfigGuard.readValidated()
        if (!postStatusConfig) {
          throw new BridgeRequestError(
            503,
            'OPENCLAW_NOT_READY',
            OPENAI_ACCOUNT_TRANSPORT_ERROR,
          )
        }
        const postStatusFailure = staticReadinessFailure(
          api,
          postStatusConfig,
          environment,
          agentDir,
          agentId,
        )
        if (postStatusFailure) {
          throw new BridgeRequestError(
            503,
            'OPENCLAW_NOT_READY',
            postStatusFailure,
          )
        }
        if (!await revalidateBoundCodexSearchProvider(
          api,
          postStatusConfig,
          boundCodexProvider,
        )) {
          throw new BridgeRequestError(
            503,
            'OPENCLAW_NOT_READY',
            CODEX_SEARCH_ATTESTATION_ERROR,
          )
        }
        const statusPrepared = statusModelResult.prepared
        if (!isOpenAiAccountModel(
          statusPrepared,
          postStatusConfig,
          accountProfileId,
        ) || !hasExactOpenAiAccountAuthState(
          agentAuthRuntime,
          postStatusConfig,
          agentDir,
          accountProfileId,
          accountOAuthIdentity,
        )) {
          throw new BridgeRequestError(
            503,
            'OPENCLAW_NOT_READY',
            OPENAI_ACCOUNT_AUTH_ERROR,
          )
        }
        if (!hasCanonicalOpenAiAccountModelTransport(statusPrepared)) {
          throw new BridgeRequestError(
            503,
            'OPENCLAW_NOT_READY',
            OPENAI_ACCOUNT_TRANSPORT_ERROR,
          )
        }
        sendJson(response, 200, {
          available: true,
          model: `${statusPrepared.selection.provider}/${statusPrepared.selection.modelId}`,
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
          const requestConfig = runtimeConfigGuard.readValidated()
          if (!requestConfig) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              OPENAI_ACCOUNT_TRANSPORT_ERROR,
            )
          }
          const requestFailure = staticReadinessFailure(
            api,
            requestConfig,
            environment,
            agentDir,
            agentId,
          )
          if (requestFailure) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              requestFailure,
            )
          }
          if (!await revalidateBoundCodexSearchProvider(
            api,
            requestConfig,
            boundCodexProvider,
          )) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              CODEX_SEARCH_ATTESTATION_ERROR,
            )
          }
          const preparedResult = await prepareOpenAiAccountModel(
            simpleCompletion,
            agentAuthRuntime,
            requestConfig,
            agentId,
            agentDir,
            accountProfileId,
            accountOAuthIdentity,
          )
          if (timedOut) {
            throw new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'OpenClaw model preparation timed out.')
          }
          if (clientDisconnected || controller.signal.aborted) {
            throw new BridgeRequestError(408, 'OPENCLAW_ABORTED', 'The OpenClaw model run was cancelled.')
          }
          if (!preparedResult.ok) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              preparedResult.message,
            )
          }
          const prepared = preparedResult.prepared
          const postPrepareConfig = runtimeConfigGuard.readValidated()
          if (!postPrepareConfig) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              OPENAI_ACCOUNT_TRANSPORT_ERROR,
            )
          }
          const postPrepareFailure = staticReadinessFailure(
            api,
            postPrepareConfig,
            environment,
            agentDir,
            agentId,
          )
          if (postPrepareFailure) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              postPrepareFailure,
            )
          }
          if (!await revalidateBoundCodexSearchProvider(
            api,
            postPrepareConfig,
            boundCodexProvider,
          )) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              CODEX_SEARCH_ATTESTATION_ERROR,
            )
          }
          if (!isOpenAiAccountModel(
            prepared,
            postPrepareConfig,
            accountProfileId,
          ) || !hasExactOpenAiAccountAuthState(
            agentAuthRuntime,
            postPrepareConfig,
            agentDir,
            accountProfileId,
            accountOAuthIdentity,
          )) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              OPENAI_ACCOUNT_AUTH_ERROR,
            )
          }
          if (!hasCanonicalOpenAiAccountModelTransport(prepared)) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              OPENAI_ACCOUNT_TRANSPORT_ERROR,
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
                cfg: postPrepareConfig,
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
          const postCompletionConfig = runtimeConfigGuard.readValidated()
          if (!postCompletionConfig) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              OPENAI_ACCOUNT_TRANSPORT_ERROR,
            )
          }
          const postCompletionFailure = staticReadinessFailure(
            api,
            postCompletionConfig,
            environment,
            agentDir,
            agentId,
          )
          if (postCompletionFailure) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              postCompletionFailure,
            )
          }
          if (!await revalidateBoundCodexSearchProvider(
            api,
            postCompletionConfig,
            boundCodexProvider,
          )) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              CODEX_SEARCH_ATTESTATION_ERROR,
            )
          }
          if (!isOpenAiAccountModel(
            prepared,
            postCompletionConfig,
            accountProfileId,
          ) || !hasExactOpenAiAccountAuthState(
            agentAuthRuntime,
            postCompletionConfig,
            agentDir,
            accountProfileId,
            accountOAuthIdentity,
          )) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              OPENAI_ACCOUNT_AUTH_ERROR,
            )
          }
          if (!hasCanonicalOpenAiAccountModelTransport(prepared)) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_MODEL_NOT_READY',
              OPENAI_ACCOUNT_TRANSPORT_ERROR,
            )
          }
          if (result.stopReason !== 'stop' ||
            (result.errorMessage?.length ?? 0) > 0) {
            throw new BridgeRequestError(
              502,
              'OPENCLAW_MODEL_FAILED',
              'The OpenClaw model did not complete successfully.',
            )
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
          const requestConfig = runtimeConfigGuard.readValidated()
          if (!requestConfig) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              OPENAI_ACCOUNT_TRANSPORT_ERROR,
            )
          }
          const requestFailure = staticReadinessFailure(
            api,
            requestConfig,
            environment,
            agentDir,
            agentId,
          )
          if (requestFailure) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              requestFailure,
            )
          }
          if (!await revalidateBoundCodexSearchProvider(
            api,
            requestConfig,
            boundCodexProvider,
          )) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              CODEX_SEARCH_ATTESTATION_ERROR,
            )
          }
          if (!await hasOpenAiAccountSearchAuth(
            api,
            agentAuthRuntime,
            requestConfig,
            agentDir,
            agentWorkspaceDir,
            accountProfileId,
            accountOAuthIdentity,
          )) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              OPENAI_ACCOUNT_AUTH_ERROR,
            )
          }
          const postAuthConfig = runtimeConfigGuard.readValidated()
          if (!postAuthConfig) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              OPENAI_ACCOUNT_TRANSPORT_ERROR,
            )
          }
          const postAuthFailure = staticReadinessFailure(
            api,
            postAuthConfig,
            environment,
            agentDir,
            agentId,
          )
          if (postAuthFailure) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              postAuthFailure,
            )
          }
          if (!await revalidateBoundCodexSearchProvider(
            api,
            postAuthConfig,
            boundCodexProvider,
          )) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              CODEX_SEARCH_ATTESTATION_ERROR,
            )
          }
          if (!hasExactOpenAiAccountAuthState(
            agentAuthRuntime,
            postAuthConfig,
            agentDir,
            accountProfileId,
            accountOAuthIdentity,
          )) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              OPENAI_ACCOUNT_AUTH_ERROR,
            )
          }
          const boundAuthStore = loadBoundOpenAiOAuthStore(
            agentAuthRuntime,
            postAuthConfig,
            agentDir,
            accountProfileId,
            accountOAuthIdentity,
          )
          if (!boundAuthStore) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              OPENAI_ACCOUNT_AUTH_ERROR,
            )
          }
          let rawSearchResult: unknown
          try {
            rawSearchResult = await boundCodexProvider.attestation.executeSearch({
              agentDir,
              authProfileId: accountProfileId,
              authProfileStore: boundAuthStore,
              config: postAuthConfig as unknown as Record<string, unknown>,
              query: input.query,
              searchConfig: postAuthConfig.tools?.web?.search as
                Record<string, unknown> | undefined,
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
          const postSearchConfig = runtimeConfigGuard.readValidated()
          if (!postSearchConfig) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              OPENAI_ACCOUNT_TRANSPORT_ERROR,
            )
          }
          const postSearchFailure = staticReadinessFailure(
            api,
            postSearchConfig,
            environment,
            agentDir,
            agentId,
          )
          if (postSearchFailure) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              postSearchFailure,
            )
          }
          if (!await revalidateBoundCodexSearchProvider(
            api,
            postSearchConfig,
            boundCodexProvider,
          )) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              CODEX_SEARCH_ATTESTATION_ERROR,
            )
          }
          if (!await hasOpenAiAccountSearchAuth(
            api,
            agentAuthRuntime,
            postSearchConfig,
            agentDir,
            agentWorkspaceDir,
            accountProfileId,
            accountOAuthIdentity,
          )) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              OPENAI_ACCOUNT_AUTH_ERROR,
            )
          }
          if (timedOut) {
            throw new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'Codex Hosted Search timed out.')
          }
          if (clientDisconnected || controller.signal.aborted) {
            throw new BridgeRequestError(408, 'OPENCLAW_ABORTED', 'Codex Hosted Search was cancelled.')
          }
          const finalSearchConfig = runtimeConfigGuard.readValidated()
          if (!finalSearchConfig) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              OPENAI_ACCOUNT_TRANSPORT_ERROR,
            )
          }
          const finalSearchFailure = staticReadinessFailure(
            api,
            finalSearchConfig,
            environment,
            agentDir,
            agentId,
          )
          if (finalSearchFailure) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              finalSearchFailure,
            )
          }
          if (!await revalidateBoundCodexSearchProvider(
            api,
            finalSearchConfig,
            boundCodexProvider,
          )) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              CODEX_SEARCH_ATTESTATION_ERROR,
            )
          }
          if (!hasExactOpenAiAccountAuthState(
            agentAuthRuntime,
            finalSearchConfig,
            agentDir,
            accountProfileId,
            accountOAuthIdentity,
          )) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              OPENAI_ACCOUNT_AUTH_ERROR,
            )
          }
          if (!isValidCodexSearchResult(rawSearchResult, input.query)) {
            throw new BridgeRequestError(
              503,
              'OPENCLAW_SEARCH_NOT_READY',
              CODEX_SEARCH_PROVIDER_ERROR,
            )
          }
          sendJson(response, 200, {
            ok: true,
            capability: 'web.search',
            transport: 'local',
            provider: 'codex',
            attempts: [],
            inputBytes: Buffer.byteLength(input.query, 'utf8'),
            inputSha256: sha256(input.query),
            outputs: [{ result: rawSearchResult }],
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
      try {
        await Promise.allSettled([...activeRuns])
        await closeServer(server)
      } finally {
        runtimeConfigGuard.restore()
      }
    },
  }
  } catch (error) {
    runtimeConfigGuard.restore()
    throw error
  }
}
