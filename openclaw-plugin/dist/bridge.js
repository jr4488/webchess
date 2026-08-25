import { createHash, randomBytes, timingSafeEqual, } from 'node:crypto';
import { accessSync, constants as fsConstants } from 'node:fs';
import { createServer, } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { attestPinnedOpenClawPreparedAuthAccountInspector, attestOfficialCodexPackage, isOfficialCodexPluginRecord, resolveRuntimeSelectedOfficialCodexPluginRecord, snapshotOAuthCredentialIdentity, } from './codex-attestation.js';
export const BRIDGE_PROTOCOL_VERSION = 1;
export const MAX_BRIDGE_REQUEST_BYTES = 16 * 1024 * 1024;
export const MAX_BRIDGE_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_BRIDGE_PROMPT_CHARS = 12 * 1024 * 1024;
export const MAX_BRIDGE_QUERY_CHARS = 500;
export const CODEX_SEARCH_READINESS_QUERY = 'OpenAI official website';
export const OPENAI_MODEL_READINESS_PROMPT = 'Reply with exactly this ASCII token and nothing else: WEBCHESS_READY';
const MAX_CONCURRENT_RUNS = 4;
const LOOPBACK_HOST = '127.0.0.1';
const PROVIDER_ABORT_DRAIN_MS = 1_250;
/** Complete authenticated model envelope; the provider turn is nested within it. */
const MODEL_REQUEST_ENVELOPE_TIMEOUT_MS = 300_000;
/** Reserved inside the aggregate envelope for auth revalidation and response shaping. */
const MODEL_REQUEST_POSTFLIGHT_RESERVE_MS = 30_000;
const MAX_MODEL_TURN_ID_CHARS = 255;
const MAX_MODEL_TURN_RECORDS = 256;
const MODEL_TURN_TOMBSTONE_MS = 10 * 60_000;
const MODEL_TURN_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const CODEX_SEARCH_READINESS_TIMEOUT_MS = 300_000;
const CODEX_SEARCH_TIMEOUT_SECONDS = 300;
const OPENAI_MODEL_READINESS_TIMEOUT_MS = 150_000;
const OPENCLAW_STATUS_TIMEOUT_MS = 150_000;
const OPENAI_MODEL_READINESS_RESPONSE = 'WEBCHESS_READY';
const PINNED_OPENCLAW_RUNTIME_VERSION = '2026.7.1-2';
const OPENCLAW_LOCAL_MODEL_RUN_SYSTEM_PROMPT = 'You are a personal assistant running inside OpenClaw.';
const OPENAI_ACCOUNT_MODEL_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const MODEL_PROVIDER_REQUEST_TRANSPORT = Symbol.for('openclaw.modelProviderRequestTransport');
const MODEL_PROVIDER_LOCAL_SERVICE = Symbol.for('openclaw.modelProviderLocalService');
const OPENAI_ACCOUNT_AUTH_ERROR = 'WebChess requires one OpenAI account OAuth profile for both inference and Codex Hosted Search. Sign in with openclaw models auth login --provider openai, make that OAuth profile the only ordered OpenAI profile, then relaunch WebChess. API keys are not accepted.';
const PROVIDER_SECRET_ENV_ERROR = 'WebChess account-auth mode refuses provider credential environment variables. Remove provider API-key, API-token, access-token, auth-token, OAuth-token, cloud-credential, and profile-credential variables from the OpenClaw environment, then relaunch WebChess.';
const OPENAI_ACCOUNT_TRANSPORT_ERROR = 'WebChess requires the canonical OpenAI account endpoint with no custom provider endpoint, model, header, request, proxy, TLS, local-service, or debug-transport override. Remove those OpenAI transport overrides, then relaunch WebChess.';
const OPENCLAW_RUNTIME_VERSION_ERROR = 'WebChess requires the pinned OpenClaw 2026.7.1-2 runtime for its private account-auth and transport contracts. Install that exact OpenClaw version, then relaunch WebChess.';
const CODEX_SEARCH_CONFIG_ERROR = 'WebChess requires OpenClaw web search to stay enabled, Codex Hosted Search to stay enabled, tools.web.search.provider set to codex, and tools.web.search.timeoutSeconds set to 300.';
const CODEX_SEARCH_PROVIDER_ERROR = 'OpenClaw needs the codex plugin installed and enabled before WebChess can launch. Install or enable the codex plugin, then relaunch WebChess.';
const CODEX_SEARCH_ATTESTATION_ERROR = 'WebChess requires the exact official @openclaw/codex 2026.7.1-1 package and its reviewed @openai/codex 0.144.3 managed executable. Reinstall that exact official plugin through OpenClaw, then relaunch WebChess.';
const CODEX_SEARCH_PROBE_ERROR = 'WebChess could not complete its one-time authenticated Codex Hosted Search readiness probe. Verify the OpenAI account OAuth profile and official codex plugin, then relaunch WebChess.';
const OPENAI_MODEL_PROBE_ERROR = 'WebChess could not complete its one-time authenticated OpenAI model readiness probe. Verify the selected OpenAI account model and OAuth profile, then relaunch WebChess.';
const CODEX_SEARCH_RUNTIME_ERROR = 'WebChess requires the official Codex Hosted Search managed app-server in private stdio, agent-scoped mode. Remove custom Codex app-server command, argument, transport, URL, header, token, or user-home overrides, then relaunch WebChess.';
const OPENCLAW_PLUGIN_CONFIG_ERROR = 'WebChess requires plugins.allow to contain exactly codex, openai, and webchess, with no custom plugin load paths or additional plugin entries. Restore the dedicated WebChess OpenClaw profile, then relaunch WebChess.';
/**
 * Signal propagation asks the pinned provider runtime to cancel its worker.
 * This outer race also bounds the bridge when a dependency fails to settle its
 * JavaScript promise after cancellation, so the owning request cannot linger.
 */
async function raceProviderExecution(execute, signal, deadlineExpired) {
    let removeAbortListener;
    const aborted = new Promise((resolve) => {
        const onAbort = () => resolve({ status: 'aborted' });
        if (signal.aborted) {
            onAbort();
            return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    });
    const execution = Promise.resolve().then(async () => {
        // The abort promise may already be resolved before this microtask runs.
        // Recheck here so a queued provider factory can never begin after expiry.
        if (signal.aborted || deadlineExpired?.()) {
            return { status: 'aborted' };
        }
        return {
            status: 'completed',
            value: await execute(),
        };
    });
    try {
        return await Promise.race([execution, aborted]);
    }
    finally {
        removeAbortListener?.();
    }
}
class StartupReadinessDeadlineError extends Error {
    publicMessage;
    constructor(publicMessage) {
        super(publicMessage);
        this.publicMessage = publicMessage;
        this.name = 'StartupReadinessDeadlineError';
    }
}
function createStartupReadinessDeadline(timeoutMs, publicMessage) {
    const controller = new AbortController();
    const deadlineAt = Date.now() + timeoutMs;
    const expired = () => Date.now() >= deadlineAt;
    const assertBeforeDeadline = () => {
        if (!controller.signal.aborted && !expired())
            return;
        if (!controller.signal.aborted)
            controller.abort();
        throw new StartupReadinessDeadlineError(publicMessage);
    };
    return {
        deadlineAt,
        signal: controller.signal,
        assertBeforeDeadline,
        async run(execute) {
            assertBeforeDeadline();
            const remainingMs = Math.max(1, deadlineAt - Date.now());
            const timeout = setTimeout(() => controller.abort(), remainingMs);
            try {
                let outcome;
                try {
                    outcome = await raceProviderExecution(execute, controller.signal, expired);
                }
                catch (error) {
                    if (!controller.signal.aborted && !expired())
                        throw error;
                    if (!controller.signal.aborted)
                        controller.abort();
                    throw new StartupReadinessDeadlineError(publicMessage);
                }
                if (outcome.status === 'aborted' || expired()) {
                    if (!controller.signal.aborted)
                        controller.abort();
                    throw new StartupReadinessDeadlineError(publicMessage);
                }
                return outcome.value;
            }
            finally {
                clearTimeout(timeout);
            }
        },
    };
}
const OPENCLAW_AUTO_CA_MARKER = 'OPENCLAW_NODE_EXTRA_CA_CERTS_READY';
const LINUX_SYSTEM_CA_PATHS = [
    '/etc/ssl/certs/ca-certificates.crt',
    '/etc/pki/tls/certs/ca-bundle.crt',
    '/etc/ssl/ca-bundle.pem',
];
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
    'CODEX_ROLLOUT_TRACE_ROOT',
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
    'OPENCLAW_DEBUG_MODEL_PAYLOAD',
    'OPENCLAW_DEBUG_PROXY_BLOB_DIR',
    'OPENCLAW_DEBUG_PROXY_CERT_DIR',
    'OPENCLAW_DEBUG_PROXY_DB_PATH',
    'OPENCLAW_DEBUG_PROXY_ENABLED',
    'OPENCLAW_DEBUG_PROXY_REQUIRE',
    'OPENCLAW_DEBUG_PROXY_SESSION_ID',
    'OPENCLAW_DEBUG_PROXY_URL',
    'OPENCLAW_DEBUG_SSE',
    'OPENCLAW_ENABLE_PRIVATE_QA_CLI',
    'OPENCLAW_GATEWAY_PASSWORD',
    'OPENCLAW_GATEWAY_TOKEN',
    'OPENCLAW_LOAD_SHELL_ENV',
    'OPENCLAW_LOG_LEVEL',
    'OPENCLAW_MCP_TOKEN',
    OPENCLAW_AUTO_CA_MARKER,
    'OPENCLAW_CONFIG_PATH',
    'OPENCLAW_OAUTH_DIR',
    'OPENCLAW_PROFILE',
    'OPENCLAW_QA_FORCE_RUNTIME',
    'OPENCLAW_SECRET_SENTINELS',
    'OPENCLAW_STATE_DIR',
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
    'RUST_LOG',
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
];
const PROVIDER_CREDENTIAL_ENVIRONMENT_ALLOWLIST = new Set([
    // These reviewed names carry public metadata or WebChess-local service/IPC
    // state, not provider credentials. The Codex child still clears every
    // matching name, including these exceptions.
    'CLERK_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    'OPENCLAW_VAPID_PUBLIC_KEY',
    'POSTGRES_PASSWORD',
    'TELNYX_PUBLIC_KEY',
    'WEBCHESS_OPENCLAW_BRIDGE_TOKEN',
]);
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
    'OPENCLAW_SECRET_SENTINELS',
    'REDIS_URL',
    'SYNOLOGY_CHAT_INCOMING_URL',
]);
class BridgeRequestError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'BridgeRequestError';
    }
}
function sha256(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function isOpenAiAccountOAuth(auth) {
    const profileId = auth.profileId?.trim();
    return auth.mode === 'oauth' &&
        Boolean(profileId) &&
        auth.source === `profile:${profileId}`;
}
function hasExactOpenAiAuthOrder(config, profileId) {
    const order = config.auth?.order?.openai;
    return Array.isArray(order) &&
        order.length === 1 &&
        order[0]?.trim() === profileId;
}
function hasExactOpenAiAccountAuthState(runtime, config, agentDir, profileId, expectedOAuthIdentity) {
    try {
        const configuredProfiles = config.auth?.profiles;
        if (configuredProfiles !== undefined) {
            if (!isRecord(configuredProfiles) ||
                Object.keys(configuredProfiles).length !== 1 ||
                !Object.prototype.hasOwnProperty.call(configuredProfiles, profileId)) {
                return false;
            }
            const configuredProfile = configuredProfiles[profileId];
            if (!isRecord(configuredProfile) ||
                configuredProfile.mode !== 'oauth' ||
                configuredProfile.provider !== 'openai')
                return false;
        }
        const store = runtime.loadAuthProfileStoreForSecretsRuntime(agentDir, {
            config,
            externalCliProviderIds: ['openai', 'codex-cli'],
        });
        if (!isRecord(store.profiles) ||
            Object.keys(store.profiles).length !== 1 ||
            !Object.prototype.hasOwnProperty.call(store.profiles, profileId)) {
            return false;
        }
        const storedProfile = store.profiles[profileId];
        if (!isRecord(storedProfile) ||
            storedProfile.type !== 'oauth' ||
            storedProfile.provider !== 'openai')
            return false;
        const order = runtime.resolveAuthProfileOrder({
            cfg: config,
            provider: 'openai',
            store,
        });
        if (!hasExactOpenAiAuthOrder(config, profileId) ||
            order.length !== 1 || order[0]?.trim() !== profileId)
            return false;
        const currentOAuthIdentity = snapshotOAuthCredentialIdentity(store, profileId);
        if (!currentOAuthIdentity ||
            (expectedOAuthIdentity !== undefined && !isDeepStrictEqual(currentOAuthIdentity, expectedOAuthIdentity)))
            return false;
        return true;
    }
    catch {
        // Inspect only profile ids and structural type/provider fields. Store
        // paths, credentials, and resolver details remain private behind the
        // fixed readiness failure below.
        return false;
    }
}
function loadBoundOpenAiOAuthStore(runtime, config, agentDir, profileId, expectedOAuthIdentity) {
    try {
        const store = runtime.loadAuthProfileStoreForSecretsRuntime(agentDir, {
            config,
            externalCliProviderIds: ['openai', 'codex-cli'],
        });
        if (!isRecord(store.profiles) ||
            Object.keys(store.profiles).length !== 1)
            return null;
        const credential = store.profiles[profileId];
        if (!isRecord(credential) || credential.type !== 'oauth' ||
            credential.provider !== 'openai')
            return null;
        const currentOAuthIdentity = snapshotOAuthCredentialIdentity(store, profileId);
        if (!currentOAuthIdentity ||
            (expectedOAuthIdentity !== undefined && !isDeepStrictEqual(currentOAuthIdentity, expectedOAuthIdentity)))
            return null;
        const clonedCredential = structuredClone(credential);
        if (!isRecord(clonedCredential) || clonedCredential.type !== 'oauth' ||
            clonedCredential.provider !== 'openai')
            return null;
        // The official Codex client treats a supplied store without a persisted
        // marker as scoped. Give that disposable store access only: otherwise a
        // forced refresh can consume a single-use authoritative refresh token and
        // discard its replacement. The authoritative OpenClaw resolver above is
        // the only component allowed to refresh persisted account credentials.
        delete clonedCredential.refresh;
        delete clonedCredential.refreshToken;
        const clonedStore = {
            order: { openai: [profileId] },
            profiles: { [profileId]: clonedCredential },
            version: store.version,
        };
        return isDeepStrictEqual(snapshotOAuthCredentialIdentity(clonedStore, profileId), currentOAuthIdentity) ? clonedStore : null;
    }
    catch {
        return null;
    }
}
function hasStableOAuthIdentity(identity) {
    return typeof identity.accountId === 'string' &&
        Boolean(identity.accountId.trim()) &&
        identity.accountId === identity.accountId.trim() &&
        typeof identity.oauthSubjectSha256 === 'string' &&
        /^[0-9a-f]{64}$/u.test(identity.oauthSubjectSha256);
}
async function hasBoundPreparedOpenAiAccount(prepared, expectedOAuthIdentity, inspector, signal) {
    if (signal?.aborted || !hasStableOAuthIdentity(expectedOAuthIdentity)) {
        return false;
    }
    try {
        const preparedIdentity = await inspector.resolveIdentity(prepared.auth.apiKey);
        if (signal?.aborted || !preparedIdentity)
            return false;
        return preparedIdentity.accountId === expectedOAuthIdentity.accountId &&
            preparedIdentity.subjectSha256 ===
                expectedOAuthIdentity.oauthSubjectSha256;
    }
    catch {
        return false;
    }
}
function isOpenAiAccountModel(prepared, config, expectedProfileId) {
    const profileId = prepared.auth.profileId?.trim();
    return prepared.selection.provider.trim().toLowerCase() === 'openai' &&
        (prepared.selection.runtimeProvider === undefined ||
            prepared.selection.runtimeProvider.trim().toLowerCase() === 'openai') &&
        prepared.model.provider.trim().toLowerCase() === 'openai' &&
        prepared.model.api === 'openai-chatgpt-responses' &&
        isOpenAiAccountOAuth(prepared.auth) &&
        Boolean(profileId) &&
        (!expectedProfileId || profileId === expectedProfileId) &&
        hasExactOpenAiAuthOrder(config, profileId ?? '');
}
function hasCanonicalOpenAiAccountModelTransport(prepared) {
    const rawBaseUrl = prepared.model.baseUrl;
    if (rawBaseUrl !== OPENAI_ACCOUNT_MODEL_BASE_URL &&
        rawBaseUrl !== `${OPENAI_ACCOUNT_MODEL_BASE_URL}/`)
        return false;
    try {
        const parsed = new URL(rawBaseUrl);
        if (parsed.protocol !== 'https:' ||
            parsed.hostname !== 'chatgpt.com' ||
            parsed.port ||
            parsed.username ||
            parsed.password ||
            parsed.search ||
            parsed.hash ||
            (parsed.pathname !== '/backend-api/codex' &&
                parsed.pathname !== '/backend-api/codex/'))
            return false;
    }
    catch {
        return false;
    }
    if (prepared.model.headers !== undefined &&
        (!isRecord(prepared.model.headers) ||
            Object.keys(prepared.model.headers).length > 0))
        return false;
    if (prepared.model.authHeader !== undefined &&
        prepared.model.authHeader !== false)
        return false;
    if (prepared.model.params !== undefined)
        return false;
    const model = prepared.model;
    return model[MODEL_PROVIDER_REQUEST_TRANSPORT] === undefined &&
        model[MODEL_PROVIDER_LOCAL_SERVICE] === undefined;
}
function hasCompatibleOpenAiProviderConfig(config) {
    const providers = config.models?.providers;
    if (providers === undefined)
        return true;
    if (!isRecord(providers))
        return false;
    for (const [providerId, provider] of Object.entries(providers)) {
        if (providerId.trim().toLowerCase() !== 'openai' ||
            !isRecord(provider) ||
            Object.keys(provider).length > 0)
            return false;
    }
    return true;
}
function resolveExplicitModelPrimary(model) {
    if (typeof model === 'string') {
        const primary = model.trim();
        return {
            primary,
            safe: primary === model && /^openai\/[^/\s]+$/u.test(primary),
        };
    }
    if (!isRecord(model) ||
        !hasOnlyKeys(model, ['fallbacks', 'primary']) ||
        typeof model.primary !== 'string')
        return { primary: '', safe: false };
    const primary = model.primary.trim();
    const fallbacks = model.fallbacks;
    return {
        primary,
        safe: primary === model.primary &&
            /^openai\/[^/\s]+$/u.test(primary) &&
            (fallbacks === undefined ||
                (Array.isArray(fallbacks) && fallbacks.length === 0)),
    };
}
function hasCompatibleModelEntryMap(models, primary) {
    if (models === undefined)
        return true;
    if (!isRecord(models))
        return false;
    for (const [modelRef, entry] of Object.entries(models)) {
        if (modelRef.trim() !== primary || !isRecord(entry))
            return false;
        if (Object.prototype.hasOwnProperty.call(entry, 'agentRuntime') ||
            Object.prototype.hasOwnProperty.call(entry, 'params'))
            return false;
    }
    return true;
}
function hasCompatibleAgentModelConfig(config, agentId) {
    const defaults = config.agents?.defaults;
    if (!isRecord(defaults) ||
        Object.prototype.hasOwnProperty.call(defaults, 'agentRuntime') ||
        Object.prototype.hasOwnProperty.call(defaults, 'params'))
        return false;
    const defaultModel = resolveExplicitModelPrimary(defaults.model);
    if (!defaultModel.safe ||
        !hasCompatibleModelEntryMap(defaults.models, defaultModel.primary)) {
        return false;
    }
    if (agentId === undefined)
        return true;
    const selected = config.agents?.list?.find((agent) => agent.id?.trim() === agentId);
    if (selected === undefined)
        return true;
    if (Object.prototype.hasOwnProperty.call(selected, 'agentRuntime') ||
        Object.prototype.hasOwnProperty.call(selected, 'params') ||
        Object.prototype.hasOwnProperty.call(selected, 'runtime'))
        return false;
    const effectiveModel = selected.model === undefined
        ? defaultModel
        : resolveExplicitModelPrimary(selected.model);
    return effectiveModel.safe &&
        hasCompatibleModelEntryMap(selected.models, effectiveModel.primary);
}
function hasCompatibleCodexSearchConfig(config) {
    const search = config.tools?.web?.search;
    if (!isRecord(search) || !hasOnlyKeys(search, [
        'enabled',
        'openaiCodex',
        'provider',
        'timeoutSeconds',
    ]))
        return false;
    const openaiCodex = search.openaiCodex;
    if (openaiCodex !== undefined) {
        if (!isRecord(openaiCodex) || !hasOnlyKeys(openaiCodex, [
            'enabled',
        ]))
            return false;
    }
    const provider = typeof search.provider === 'string'
        ? search.provider.trim().toLowerCase()
        : '';
    return search?.enabled !== false &&
        openaiCodex?.enabled !== false &&
        provider === 'codex' &&
        search.timeoutSeconds === CODEX_SEARCH_TIMEOUT_SECONDS;
}
function isBlankOptionalString(value) {
    return value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim().length === 0);
}
function hasCompatibleCodexAppServerConfig(config, environment, expectedClearEnv) {
    if (environment.OPENCLAW_CODEX_APP_SERVER_BIN?.trim() ||
        environment.OPENCLAW_CODEX_APP_SERVER_ARGS?.trim())
        return false;
    const appServer = config.plugins?.entries?.codex?.config?.appServer;
    if (appServer === undefined)
        return true;
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
    ]))
        return false;
    const transport = appServer.transport;
    if (transport !== undefined &&
        (typeof transport !== 'string' || transport.trim() !== 'stdio'))
        return false;
    const homeScope = appServer.homeScope;
    if (homeScope !== undefined &&
        (typeof homeScope !== 'string' || homeScope.trim() !== 'agent'))
        return false;
    if (!isBlankOptionalString(appServer.command) ||
        !isBlankOptionalString(appServer.url) ||
        !isBlankOptionalString(appServer.authToken))
        return false;
    if (appServer.env !== undefined || appServer.networkProxy !== undefined) {
        return false;
    }
    if (expectedClearEnv === undefined) {
        if (appServer.clearEnv !== undefined) {
            const safeDefault = codexAppServerClearEnv(environment);
            if (!Array.isArray(appServer.clearEnv) ||
                appServer.clearEnv.length !== safeDefault.length ||
                appServer.clearEnv.some((value, index) => value !== safeDefault[index]))
                return false;
        }
    }
    else if (!Array.isArray(appServer.clearEnv) ||
        appServer.clearEnv.length !== expectedClearEnv.length ||
        appServer.clearEnv.some((value, index) => value !== expectedClearEnv[index]))
        return false;
    if (appServer.args !== undefined &&
        (!Array.isArray(appServer.args) || appServer.args.length > 0))
        return false;
    if (appServer.headers !== undefined &&
        (!isRecord(appServer.headers) || Object.keys(appServer.headers).length > 0))
        return false;
    return true;
}
async function hasOpenAiAccountSearchAuth(api, authRuntime, config, agentDir, expectedProfileId, expectedOAuthIdentity, signal) {
    if (signal?.aborted || !hasExactOpenAiAccountAuthState(authRuntime, config, agentDir, expectedProfileId, expectedOAuthIdentity))
        return false;
    try {
        const { mode, profileId, source } = await api.runtime.modelAuth.resolveApiKeyForProvider({
            agentDir,
            cfg: config,
            lockedProfile: true,
            modelApi: 'openai-chatgpt-responses',
            profileId: expectedProfileId,
            provider: 'openai',
        });
        return !signal?.aborted &&
            mode === 'oauth' &&
            profileId === expectedProfileId &&
            source === `profile:${expectedProfileId}` &&
            hasExactOpenAiAccountAuthState(authRuntime, config, agentDir, expectedProfileId, expectedOAuthIdentity);
    }
    catch {
        // Auth resolution can contain profile ids, paths, or provider detail.
        // The bridge exposes only the fixed account-auth remediation below.
        return false;
    }
}
function hasProviderSecretEnvironment(environment) {
    return Object.entries(environment).some(([rawName, rawValue]) => {
        if (rawValue === undefined || rawValue === '')
            return false;
        const name = rawName.trim().toUpperCase();
        return !PROVIDER_CREDENTIAL_ENVIRONMENT_ALLOWLIST.has(name) &&
            isProviderCredentialEnvironmentName(name);
    });
}
function isProviderCredentialEnvironmentName(name) {
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
        /^OPENCLAW_LIVE_.+_KEYS?$/u.test(name);
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
    'CODEX_ROLLOUT_TRACE_ROOT',
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
    'OPENCLAW_DEBUG_MODEL_PAYLOAD',
    'OPENCLAW_DEBUG_PROXY_BLOB_DIR',
    'OPENCLAW_DEBUG_PROXY_DB_PATH',
    'OPENCLAW_DEBUG_PROXY_ENABLED',
    'OPENCLAW_DEBUG_PROXY_REQUIRE',
    'OPENCLAW_DEBUG_PROXY_URL',
    'OPENCLAW_DEBUG_SSE',
    'OPENCLAW_ENABLE_PRIVATE_QA_CLI',
    'OPENCLAW_LOAD_SHELL_ENV',
    'OPENCLAW_LOG_LEVEL',
    'OPENCLAW_QA_FORCE_RUNTIME',
    'OPENSSL_CONF',
    'PIP_PROXY',
    'REQUESTS_CA_BUNDLE',
    'RUST_LOG',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
    'SSLKEYLOGFILE',
    'WSS_PROXY',
    'YARN_HTTP_PROXY',
    'YARN_NO_PROXY',
    '__CODEX_SNAPSHOT_OVERRIDE',
    '__CODEX_SNAPSHOT_PROXY_OVERRIDE',
]);
function isUnsafeProviderTransportEnvironmentName(name) {
    return UNSAFE_PROVIDER_TRANSPORT_ENVIRONMENT_NAMES.has(name) ||
        name === 'NODE_EXTRA_CA_CERTS' ||
        name === 'NODE_TLS_REJECT_UNAUTHORIZED' ||
        name === OPENCLAW_AUTO_CA_MARKER ||
        name.startsWith('CODEX_NETWORK_PROXY_') ||
        name.startsWith('OPENCLAW_DEBUG_PROXY_') ||
        name.startsWith('OPENCLAW_QA_');
}
function hasUnsafeProviderTransportEnvironment(environment) {
    const autoCaAccepted = hasAttestedOpenClawSystemCa(environment);
    return Object.entries(environment).some(([rawName, rawValue]) => {
        if (rawValue === undefined || rawValue === '')
            return false;
        const name = rawName.trim().toUpperCase();
        if (name === 'NODE_EXTRA_CA_CERTS' || name === OPENCLAW_AUTO_CA_MARKER) {
            return !autoCaAccepted;
        }
        if (name === 'NODE_TLS_REJECT_UNAUTHORIZED')
            return rawValue !== '1';
        return isUnsafeProviderTransportEnvironmentName(name);
    });
}
function hasAttestedOpenClawSystemCa(environment) {
    const caPath = environment.NODE_EXTRA_CA_CERTS;
    const marker = environment[OPENCLAW_AUTO_CA_MARKER];
    if (!caPath && !marker)
        return false;
    if (process.platform !== 'linux' || marker !== '1' || !caPath)
        return false;
    const firstReadable = LINUX_SYSTEM_CA_PATHS.find((candidate) => {
        try {
            accessSync(candidate, fsConstants.R_OK);
            return true;
        }
        catch {
            return false;
        }
    });
    return caPath === firstReadable;
}
function snapshotRuntimeConfig(config) {
    try {
        const snapshot = structuredClone(config);
        return isRecord(snapshot) ? snapshot : null;
    }
    catch {
        return null;
    }
}
function codexAppServerClearEnv(environment) {
    const names = new Set([
        ...CODEX_APP_SERVER_ALWAYS_CLEAR_ENV,
        ...PROVIDER_CREDENTIAL_ENVIRONMENT_EXACT_NAMES,
    ]);
    for (const rawName of Object.keys(environment)) {
        const exactName = rawName.trim();
        const name = exactName.toUpperCase();
        if (!name || name === 'CODEX_HOME')
            continue;
        if (isProviderCredentialEnvironmentName(name) ||
            isUnsafeProviderTransportEnvironmentName(name) ||
            /^(?:PG|POSTGRES|SSH_)/u.test(name) ||
            /(?:^|_)(?:BRIDGE|DATABASE|HMAC)(?:_|$)/u.test(name) ||
            /(?:^|_)(?:PASSWORD|PRIVATE_KEY|SECRET)(?:_|$)/u.test(name)) {
            names.add(name);
            names.add(exactName);
        }
    }
    return [...names].sort();
}
function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value))
        return value;
    Object.freeze(value);
    for (const nested of Object.values(value)) {
        deepFreeze(nested);
    }
    return value;
}
function hardenedRuntimeConfig(config, clearEnv) {
    const snapshot = snapshotRuntimeConfig(config);
    if (!snapshot || !snapshot.plugins)
        return null;
    const entries = isRecord(snapshot.plugins.entries)
        ? snapshot.plugins.entries
        : {};
    const codexEntry = isRecord(entries.codex) ? entries.codex : {};
    const codexConfig = isRecord(codexEntry.config) ? codexEntry.config : {};
    const appServer = isRecord(codexConfig.appServer)
        ? codexConfig.appServer
        : {};
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
    };
    return deepFreeze(snapshot);
}
function installRuntimeConfigGuard(api, liveBaseline, clearEnv) {
    const target = api.runtime.config;
    const originalDescriptor = Object.getOwnPropertyDescriptor(target, 'current');
    const originalCurrent = target.current.bind(target);
    const executionConfig = hardenedRuntimeConfig(liveBaseline, clearEnv);
    if (!executionConfig)
        return null;
    const guardedCurrent = () => executionConfig;
    try {
        Object.defineProperty(target, 'current', {
            configurable: true,
            enumerable: originalDescriptor?.enumerable ?? true,
            value: guardedCurrent,
            writable: false,
        });
    }
    catch {
        return null;
    }
    let restored = false;
    return {
        executionConfig,
        readValidated() {
            if (restored || target.current !== guardedCurrent)
                return null;
            try {
                const current = snapshotRuntimeConfig(originalCurrent());
                return current && isDeepStrictEqual(current, liveBaseline)
                    ? executionConfig
                    : null;
            }
            catch {
                return null;
            }
        },
        restore() {
            if (restored)
                return;
            restored = true;
            try {
                if (originalDescriptor) {
                    Object.defineProperty(target, 'current', originalDescriptor);
                }
                else {
                    Object.defineProperty(target, 'current', {
                        configurable: true,
                        enumerable: true,
                        value: originalCurrent,
                        writable: true,
                    });
                }
            }
            catch {
                // This dedicated CLI process is shutting down. Never replace a value
                // installed by another owner while attempting best-effort restoration.
            }
        },
    };
}
const CODEX_PROVIDER_CONTRACT_KEYS = Object.freeze([
    'applySelectionConfig',
    'autoDetectOrder',
    'createTool',
    'credentialPath',
    'docsUrl',
    'envVars',
    'getCredentialValue',
    'hint',
    'id',
    'inactiveSecretPaths',
    'label',
    'onboardingScopes',
    'placeholder',
    'pluginId',
    'requiresCredential',
    'runSetup',
    'setCredentialValue',
    'signupUrl',
]);
const CODEX_PROVIDER_FUNCTION_KEYS = new Set([
    'applySelectionConfig',
    'createTool',
    'getCredentialValue',
    'runSetup',
    'setCredentialValue',
]);
function isExactCodexProviderContract(provider) {
    const descriptors = Object.getOwnPropertyDescriptors(provider);
    if (Object.getPrototypeOf(provider) !== Object.prototype ||
        Reflect.ownKeys(provider).some((key) => typeof key !== 'string') ||
        !isDeepStrictEqual(Object.keys(provider).sort(), [...CODEX_PROVIDER_CONTRACT_KEYS].sort()) || !CODEX_PROVIDER_CONTRACT_KEYS.every((key) => {
        const descriptor = descriptors[key];
        return descriptor !== undefined && 'value' in descriptor &&
            descriptor.configurable === true &&
            descriptor.enumerable === true && descriptor.writable === true;
    }))
        return false;
    return provider.id === 'codex' &&
        provider.pluginId === 'codex' &&
        provider.label === 'Codex Hosted Search' &&
        provider.hint ===
            'Grounded answers through your Codex app-server account' &&
        provider.requiresCredential === false &&
        isDeepStrictEqual(provider.envVars, []) &&
        isDeepStrictEqual(provider.onboardingScopes, ['text-inference']) &&
        provider.placeholder === '(uses Codex sign-in)' &&
        provider.signupUrl === 'https://chatgpt.com/codex' &&
        provider.docsUrl === 'https://docs.openclaw.ai/tools/web' &&
        provider.autoDetectOrder === 900 &&
        provider.credentialPath === '' &&
        isDeepStrictEqual(provider.inactiveSecretPaths, []) &&
        [...CODEX_PROVIDER_FUNCTION_KEYS].every((key) => typeof provider[key] ===
            'function');
}
function hasSameCodexProviderContract(initial, current) {
    if (!isExactCodexProviderContract(initial) ||
        !isExactCodexProviderContract(current))
        return false;
    const left = initial;
    const right = current;
    return CODEX_PROVIDER_CONTRACT_KEYS.every((key) => CODEX_PROVIDER_FUNCTION_KEYS.has(key)
        ? left[key] === right[key]
        : isDeepStrictEqual(left[key], right[key]));
}
async function resolveBoundCodexSearchProvider(api, config, attestor, recordResolver, environment, stateDir, workspaceDir, emptyEnvironmentNames, signal) {
    try {
        if (signal?.aborted) {
            return { bound: null, error: CODEX_SEARCH_ATTESTATION_ERROR };
        }
        // The pinned runtime cold-loads provider plugins with activate:false and
        // returns shallow clones. It intentionally does not commit that registry
        // globally, so source provenance comes from the exact pinned OpenClaw
        // static/runtime inspection of the selected, fully attested install. Run
        // that proof before provider enumeration can import code in this process.
        const record = await recordResolver(environment, stateDir, workspaceDir, emptyEnvironmentNames);
        if (signal?.aborted || !record || !isOfficialCodexPluginRecord(record)) {
            return { bound: null, error: CODEX_SEARCH_ATTESTATION_ERROR };
        }
        const attestation = await attestor(record);
        if (signal?.aborted || !attestation) {
            return { bound: null, error: CODEX_SEARCH_ATTESTATION_ERROR };
        }
        const initiallyValid = await attestation.revalidate();
        if (signal?.aborted || !initiallyValid) {
            return { bound: null, error: CODEX_SEARCH_ATTESTATION_ERROR };
        }
        const listed = api.runtime.webSearch.listProviders({ config })
            .filter((provider) => provider.id === 'codex');
        if (listed.length === 0) {
            return { bound: null, error: CODEX_SEARCH_PROVIDER_ERROR };
        }
        if (listed.length !== 1) {
            return { bound: null, error: CODEX_SEARCH_ATTESTATION_ERROR };
        }
        const [provider] = listed;
        if (signal?.aborted || !provider ||
            !isExactCodexProviderContract(provider)) {
            return { bound: null, error: CODEX_SEARCH_ATTESTATION_ERROR };
        }
        const finallyValid = await attestation.revalidate();
        if (signal?.aborted || !finallyValid) {
            return { bound: null, error: CODEX_SEARCH_ATTESTATION_ERROR };
        }
        return {
            bound: {
                attestation,
                pluginRecord: record,
                provider,
            },
            error: null,
        };
    }
    catch {
        return { bound: null, error: CODEX_SEARCH_ATTESTATION_ERROR };
    }
}
async function revalidateBoundCodexSearchProvider(api, config, bound, signal) {
    try {
        if (signal?.aborted)
            return false;
        if (!isOfficialCodexPluginRecord(bound.pluginRecord) ||
            !isExactCodexProviderContract(bound.provider) ||
            !await bound.attestation.revalidate())
            return false;
        if (signal?.aborted)
            return false;
        const listed = api.runtime.webSearch.listProviders({ config })
            .filter((provider) => provider.id === 'codex');
        if (listed.length !== 1 || !listed[0] ||
            !hasSameCodexProviderContract(bound.provider, listed[0]) ||
            signal?.aborted)
            return false;
        const revalidated = await bound.attestation.revalidate();
        return revalidated && !signal?.aborted;
    }
    catch {
        return false;
    }
}
function isValidCodexSearchResult(value, query) {
    if (!isRecord(value) ||
        value.query !== query ||
        value.provider !== 'codex' ||
        typeof value.model !== 'string' || !value.model.trim() ||
        typeof value.tookMs !== 'number' ||
        !Number.isSafeInteger(value.tookMs) || value.tookMs < 0 ||
        typeof value.content !== 'string' || !value.content.trim() ||
        !Array.isArray(value.searches) || value.searches.length === 0 ||
        !isRecord(value.externalContent))
        return false;
    const boundary = value.externalContent;
    return boundary.untrusted === true &&
        boundary.source === 'web_search' &&
        boundary.provider === 'codex' &&
        boundary.wrapped === true;
}
async function runCodexSearchReadinessProbe(bound, config, agentDir, authProfileId, authProfileStore, deadline) {
    try {
        const result = await deadline.run(async () => await bound.attestation.executeSearch({
            agentDir,
            authProfileId,
            authProfileStore,
            config: config,
            query: CODEX_SEARCH_READINESS_QUERY,
            searchConfig: config.tools?.web?.search,
            signal: deadline.signal,
        }));
        return !deadline.signal.aborted &&
            isValidCodexSearchResult(result, CODEX_SEARCH_READINESS_QUERY);
    }
    catch (error) {
        if (error instanceof StartupReadinessDeadlineError) {
            // The pinned stdio client escalates close to process-group SIGKILL after
            // one second. Keep this owning process alive for the reviewed drain
            // window, but never resume startup work after the absolute deadline.
            await new Promise((resolve) => {
                setTimeout(resolve, PROVIDER_ABORT_DRAIN_MS);
            });
        }
        return false;
    }
}
async function runOpenAiModelReadinessProbe(simpleCompletion, prepared, config, deadline) {
    try {
        const result = await deadline.run(async () => await simpleCompletion.completeWithPreparedSimpleCompletionModel({
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
                signal: deadline.signal,
            },
        }));
        if (deadline.signal.aborted ||
            result.stopReason !== 'stop' || result.errorMessage)
            return false;
        const output = result.content.map((block) => block.type === 'text' && typeof block.text === 'string'
            ? block.text
            : '').join('');
        return output === OPENAI_MODEL_READINESS_RESPONSE;
    }
    catch (error) {
        if (error instanceof StartupReadinessDeadlineError) {
            await new Promise((resolve) => {
                setTimeout(resolve, PROVIDER_ABORT_DRAIN_MS);
            });
        }
        return false;
    }
}
function hasCompatiblePluginConfig(config) {
    const plugins = config.plugins;
    if (!isRecord(plugins) || !Array.isArray(plugins.allow) ||
        plugins.allow.length !== 3)
        return false;
    const allow = plugins.allow.map((value) => typeof value === 'string' ? value.trim().toLowerCase() : '');
    if (new Set(allow).size !== 3 ||
        !allow.includes('codex') ||
        !allow.includes('openai') ||
        !allow.includes('webchess'))
        return false;
    const load = plugins.load;
    if (load !== undefined &&
        (!isRecord(load) ||
            Object.prototype.hasOwnProperty.call(load, 'paths')))
        return false;
    const entries = plugins.entries;
    if (entries === undefined)
        return true;
    if (!isRecord(entries) || !Object.keys(entries).every((pluginId) => {
        const normalized = pluginId.trim().toLowerCase();
        return normalized === 'codex' || normalized === 'webchess';
    }))
        return false;
    const codexEntry = entries.codex;
    if (codexEntry === undefined)
        return true;
    if (!isRecord(codexEntry) || !hasOnlyKeys(codexEntry, [
        'config',
        'enabled',
    ]) || (codexEntry.enabled !== undefined && codexEntry.enabled !== true)) {
        return false;
    }
    const codexConfig = codexEntry.config;
    if (codexConfig === undefined)
        return true;
    if (!isRecord(codexConfig) || !hasOnlyKeys(codexConfig, [
        'appServer',
        'codexDynamicToolsExclude',
        'codexDynamicToolsLoading',
    ]))
        return false;
    const dynamicToolsLoading = codexConfig.codexDynamicToolsLoading;
    const dynamicToolsExclude = codexConfig.codexDynamicToolsExclude;
    return (dynamicToolsLoading === undefined ||
        dynamicToolsLoading === 'searchable') &&
        (dynamicToolsExclude === undefined ||
            (Array.isArray(dynamicToolsExclude) &&
                dynamicToolsExclude.length === 0));
}
function staticReadinessFailure(api, config, environment, _agentDir, agentId, expectedClearEnv) {
    if (api.runtime.version !== PINNED_OPENCLAW_RUNTIME_VERSION) {
        return OPENCLAW_RUNTIME_VERSION_ERROR;
    }
    if (Object.prototype.hasOwnProperty.call(config, 'env')) {
        return OPENAI_ACCOUNT_TRANSPORT_ERROR;
    }
    if (hasProviderSecretEnvironment(environment)) {
        return PROVIDER_SECRET_ENV_ERROR;
    }
    if (hasUnsafeProviderTransportEnvironment(environment) ||
        !hasCompatibleOpenAiProviderConfig(config) ||
        !hasCompatibleAgentModelConfig(config, agentId)) {
        return OPENAI_ACCOUNT_TRANSPORT_ERROR;
    }
    if (!hasCompatibleCodexSearchConfig(config)) {
        return CODEX_SEARCH_CONFIG_ERROR;
    }
    if (!hasCompatibleCodexAppServerConfig(config, environment, expectedClearEnv)) {
        return CODEX_SEARCH_RUNTIME_ERROR;
    }
    if (!hasCompatiblePluginConfig(config)) {
        return OPENCLAW_PLUGIN_CONFIG_ERROR;
    }
    return null;
}
async function prepareOpenAiAccountModel(simpleCompletion, preparedAuthAccountInspector, authRuntime, config, agentId, agentDir, expectedProfileId, expectedOAuthIdentity, signal) {
    let prepared;
    try {
        if (signal?.aborted) {
            return { message: OPENAI_MODEL_PROBE_ERROR, ok: false };
        }
        prepared = await simpleCompletion.prepareSimpleCompletionModelForAgent({
            agentId,
            agentDir,
            allowBundledStaticCatalogFallback: true,
            cfg: config,
            skipAgentDiscovery: true,
        });
    }
    catch {
        return { message: OPENAI_ACCOUNT_AUTH_ERROR, ok: false };
    }
    if (signal?.aborted || 'error' in prepared ||
        !isOpenAiAccountModel(prepared, config, expectedProfileId)) {
        return { message: OPENAI_ACCOUNT_AUTH_ERROR, ok: false };
    }
    if (!hasCanonicalOpenAiAccountModelTransport(prepared)) {
        return { message: OPENAI_ACCOUNT_TRANSPORT_ERROR, ok: false };
    }
    if (!expectedOAuthIdentity || !await hasBoundPreparedOpenAiAccount(prepared, expectedOAuthIdentity, preparedAuthAccountInspector, signal)) {
        return { message: OPENAI_ACCOUNT_AUTH_ERROR, ok: false };
    }
    const profileId = prepared.auth.profileId?.trim();
    if (signal?.aborted || !profileId || !hasExactOpenAiAccountAuthState(authRuntime, config, agentDir, profileId, expectedOAuthIdentity)) {
        return { message: OPENAI_ACCOUNT_AUTH_ERROR, ok: false };
    }
    return { ok: true, prepared };
}
function hasOnlyKeys(value, allowed) {
    const accepted = new Set(allowed);
    return Object.keys(value).every((key) => accepted.has(key));
}
function requireInteger(value, minimum, maximum, label) {
    if (typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < minimum ||
        value > maximum) {
        throw new BridgeRequestError(400, 'INVALID_REQUEST', `${label} is invalid.`);
    }
    return value;
}
function parseModelRunRequest(value) {
    if (!isRecord(value) ||
        !hasOnlyKeys(value, ['prompt', 'thinking', 'timeoutMs', 'turnId', 'version']) ||
        value.version !== BRIDGE_PROTOCOL_VERSION ||
        typeof value.prompt !== 'string' ||
        value.prompt.trim().length === 0 ||
        value.prompt.length > MAX_BRIDGE_PROMPT_CHARS ||
        (value.turnId !== undefined && (typeof value.turnId !== 'string' ||
            value.turnId.length < 1 ||
            value.turnId.length > MAX_MODEL_TURN_ID_CHARS ||
            !MODEL_TURN_ID_PATTERN.test(value.turnId))) ||
        (value.thinking !== 'low' && value.thinking !== 'medium')) {
        throw new BridgeRequestError(400, 'INVALID_REQUEST', 'The model request does not match the bridge contract.');
    }
    return {
        prompt: value.prompt,
        thinking: value.thinking,
        timeoutMs: requireInteger(value.timeoutMs, 1_000, 150_000, 'timeoutMs'),
        turnId: typeof value.turnId === 'string' ? value.turnId : null,
        version: 1,
    };
}
function modelTurnRequestDigest(input) {
    return sha256(JSON.stringify({
        prompt: input.prompt,
        thinking: input.thinking,
        timeoutMs: input.timeoutMs,
        version: input.version,
    }));
}
function parseWebSearchRequest(value) {
    if (!isRecord(value) ||
        !hasOnlyKeys(value, ['limit', 'query', 'timeoutMs', 'version']) ||
        value.version !== BRIDGE_PROTOCOL_VERSION ||
        typeof value.query !== 'string' ||
        value.query.length === 0 ||
        value.query.length > MAX_BRIDGE_QUERY_CHARS ||
        value.query.trim() !== value.query ||
        /[\p{C}\r\n]/gu.test(value.query)) {
        throw new BridgeRequestError(400, 'INVALID_REQUEST', 'The web search request does not match the bridge contract.');
    }
    return {
        limit: requireInteger(value.limit, 1, 10, 'limit'),
        query: value.query,
        timeoutMs: requireInteger(value.timeoutMs, 1_000, 300_000, 'timeoutMs'),
        version: 1,
    };
}
function authorized(request, token) {
    const supplied = request.headers.authorization;
    if (typeof supplied !== 'string')
        return false;
    const expected = Buffer.from(`Bearer ${token}`, 'utf8');
    const received = Buffer.from(supplied, 'utf8');
    return expected.length === received.length && timingSafeEqual(expected, received);
}
async function readJsonBody(request, maxBytes) {
    const contentType = request.headers['content-type'];
    if (typeof contentType !== 'string' ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
        throw new BridgeRequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'The bridge accepts application/json only.');
    }
    const declared = request.headers['content-length'];
    if (declared !== undefined) {
        const parsed = Number(declared);
        if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
            throw new BridgeRequestError(413, 'REQUEST_TOO_LARGE', 'The bridge request exceeds its byte limit.');
        }
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maxBytes) {
            throw new BridgeRequestError(413, 'REQUEST_TOO_LARGE', 'The bridge request exceeds its byte limit.');
        }
        chunks.push(buffer);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        throw new BridgeRequestError(400, 'INVALID_JSON', 'The bridge request is not valid JSON.');
    }
}
function responseHeaders() {
    return {
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Type': 'application/json; charset=utf-8',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
    };
}
function sendJson(response, status, value, maxBytes) {
    if (response.destroyed || response.writableEnded)
        return;
    let body = JSON.stringify(value);
    if (Buffer.byteLength(body, 'utf8') > maxBytes) {
        status = 502;
        body = JSON.stringify({
            error: {
                code: 'RESPONSE_TOO_LARGE',
                message: 'The OpenClaw result exceeded the bridge response limit.',
            },
        });
    }
    response.writeHead(status, {
        ...responseHeaders(),
        'Content-Length': String(Buffer.byteLength(body, 'utf8')),
    });
    response.end(body);
}
function bridgeFailure(error) {
    if (error instanceof BridgeRequestError) {
        return {
            code: error.code,
            message: error.message,
            status: error.status,
        };
    }
    return {
        code: 'OPENCLAW_RUNTIME_FAILED',
        message: 'The OpenClaw plugin runtime could not complete the request.',
        status: 502,
    };
}
async function loadSimpleCompletionRuntime() {
    // This focused package export is the same simple-completion runtime used by
    // `openclaw infer model run --local`. Keep its role/reasoning semantics in
    // lockstep with the pinned OpenClaw version; raw embedded-agent mode differs.
    return await import('openclaw/plugin-sdk/simple-completion-runtime');
}
async function loadAgentAuthRuntime() {
    return await import('openclaw/plugin-sdk/agent-runtime');
}
function textFromCompletion(content) {
    return content
        .map((block) => block.type === 'text' && typeof block.text === 'string'
        ? block.text
        : '')
        .join('')
        .trim();
}
function listen(server, host) {
    return new Promise((resolve, reject) => {
        const onError = (error) => {
            server.off('listening', onListening);
            reject(error);
        };
        const onListening = () => {
            server.off('error', onError);
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('The WebChess bridge did not receive a TCP port.'));
                return;
            }
            resolve(address.port);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(0, host);
    });
}
function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections?.();
    });
}
export async function startWebChessBridge(api, _runtimeRoot, options = {}) {
    const environment = options.environment ?? process.env;
    const host = options.host ?? LOOPBACK_HOST;
    if (host !== LOOPBACK_HOST) {
        throw new Error('The WebChess bridge must bind to 127.0.0.1.');
    }
    const maxRequestBytes = options.maxRequestBytes ?? MAX_BRIDGE_REQUEST_BYTES;
    const maxResponseBytes = options.maxResponseBytes ?? MAX_BRIDGE_RESPONSE_BYTES;
    const maxConcurrentRuns = options.maxConcurrentRuns ?? MAX_CONCURRENT_RUNS;
    const requestedReadinessTimeout = options.readinessProbeTimeoutMs;
    const hasRequestedReadinessTimeout = typeof requestedReadinessTimeout === 'number' &&
        Number.isSafeInteger(requestedReadinessTimeout) &&
        requestedReadinessTimeout > 0;
    const modelReadinessTimeoutMs = hasRequestedReadinessTimeout
        ? Math.min(requestedReadinessTimeout, OPENAI_MODEL_READINESS_TIMEOUT_MS)
        : OPENAI_MODEL_READINESS_TIMEOUT_MS;
    const searchReadinessTimeoutMs = hasRequestedReadinessTimeout
        ? Math.min(requestedReadinessTimeout, CODEX_SEARCH_READINESS_TIMEOUT_MS)
        : CODEX_SEARCH_READINESS_TIMEOUT_MS;
    const token = options.token ?? randomBytes(32).toString('base64url');
    if (Buffer.byteLength(token, 'utf8') < 32) {
        throw new Error('The WebChess bridge bearer must contain at least 32 bytes.');
    }
    const startupConfig = (() => {
        try {
            return snapshotRuntimeConfig(api.runtime.config.current());
        }
        catch {
            return null;
        }
    })();
    if (!startupConfig)
        throw new Error(OPENAI_ACCOUNT_TRANSPORT_ERROR);
    const initialFailure = staticReadinessFailure(api, startupConfig, environment);
    if (initialFailure)
        throw new Error(initialFailure);
    const modelReadinessDeadline = createStartupReadinessDeadline(modelReadinessTimeoutMs, OPENAI_MODEL_PROBE_ERROR);
    const agentAuthRuntime = options.agentAuthRuntime ??
        await modelReadinessDeadline.run(async () => {
            try {
                return await loadAgentAuthRuntime();
            }
            catch {
                throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
            }
        });
    let agentId = '';
    let agentDir = '';
    let agentWorkspaceDir;
    try {
        agentId = agentAuthRuntime.resolveDefaultAgentId(startupConfig).trim();
        agentDir = agentAuthRuntime.resolveAgentDir(startupConfig, agentId, environment).trim();
        agentWorkspaceDir = agentAuthRuntime.resolveAgentWorkspaceDir(startupConfig, agentId, environment).trim();
    }
    catch {
        throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
    }
    if (!agentId || !agentDir || !agentWorkspaceDir) {
        throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
    }
    const resolvedFailure = staticReadinessFailure(api, startupConfig, environment, agentDir, agentId);
    if (resolvedFailure)
        throw new Error(resolvedFailure);
    const clearEnv = codexAppServerClearEnv(environment);
    const runtimeConfigGuard = installRuntimeConfigGuard(api, startupConfig, clearEnv);
    if (!runtimeConfigGuard)
        throw new Error(OPENAI_ACCOUNT_TRANSPORT_ERROR);
    const guardedStartupFailure = staticReadinessFailure(api, runtimeConfigGuard.executionConfig, environment, agentDir, agentId, clearEnv);
    if (guardedStartupFailure) {
        runtimeConfigGuard.restore();
        throw new Error(guardedStartupFailure);
    }
    try {
        const accountProfileId = runtimeConfigGuard.executionConfig.auth
            ?.order?.openai?.[0]?.trim();
        const hasBaselineAuthState = accountProfileId
            ? hasExactOpenAiAccountAuthState(agentAuthRuntime, runtimeConfigGuard.executionConfig, agentDir, accountProfileId)
            : false;
        const baselineAuthStore = accountProfileId && hasBaselineAuthState
            ? loadBoundOpenAiOAuthStore(agentAuthRuntime, runtimeConfigGuard.executionConfig, agentDir, accountProfileId)
            : null;
        const accountOAuthIdentity = baselineAuthStore && accountProfileId
            ? snapshotOAuthCredentialIdentity(baselineAuthStore, accountProfileId)
            : null;
        if (!accountProfileId || !accountOAuthIdentity ||
            !hasBaselineAuthState ||
            !hasStableOAuthIdentity(accountOAuthIdentity) ||
            !hasExactOpenAiAccountAuthState(agentAuthRuntime, runtimeConfigGuard.executionConfig, agentDir, accountProfileId, accountOAuthIdentity))
            throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
        const simpleCompletion = options.simpleCompletionRuntime ??
            await modelReadinessDeadline.run(async () => {
                try {
                    return await loadSimpleCompletionRuntime();
                }
                catch {
                    throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
                }
            });
        const inspectedPreparedAuthAccount = options.preparedAuthAccountInspector ??
            await modelReadinessDeadline.run(async () => {
                try {
                    return await attestPinnedOpenClawPreparedAuthAccountInspector();
                }
                catch {
                    throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
                }
            });
        if (!inspectedPreparedAuthAccount) {
            throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
        }
        const preparedAuthAccountInspector = inspectedPreparedAuthAccount;
        const preflightResult = await modelReadinessDeadline.run(async () => await prepareOpenAiAccountModel(simpleCompletion, preparedAuthAccountInspector, agentAuthRuntime, runtimeConfigGuard.executionConfig, agentId, agentDir, accountProfileId, accountOAuthIdentity, modelReadinessDeadline.signal));
        if (!preflightResult.ok)
            throw new Error(preflightResult.message);
        const preflight = preflightResult.prepared;
        if (preflight.auth.profileId?.trim() !== accountProfileId) {
            throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
        }
        const currentStartupConfig = runtimeConfigGuard.readValidated();
        if (!currentStartupConfig)
            throw new Error(OPENAI_ACCOUNT_TRANSPORT_ERROR);
        const postPreflightFailure = staticReadinessFailure(api, currentStartupConfig, environment, agentDir, agentId);
        if (postPreflightFailure)
            throw new Error(postPreflightFailure);
        if (!isOpenAiAccountModel(preflight, currentStartupConfig, accountProfileId) || !hasCanonicalOpenAiAccountModelTransport(preflight) ||
            !await modelReadinessDeadline.run(async () => await hasBoundPreparedOpenAiAccount(preflight, accountOAuthIdentity, preparedAuthAccountInspector, modelReadinessDeadline.signal)) ||
            !hasExactOpenAiAccountAuthState(agentAuthRuntime, currentStartupConfig, agentDir, accountProfileId, accountOAuthIdentity)) {
            throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
        }
        if (!await runOpenAiModelReadinessProbe(simpleCompletion, preflight, currentStartupConfig, modelReadinessDeadline)) {
            throw new Error(OPENAI_MODEL_PROBE_ERROR);
        }
        const postModelProbeConfig = runtimeConfigGuard.readValidated();
        if (!postModelProbeConfig)
            throw new Error(OPENAI_ACCOUNT_TRANSPORT_ERROR);
        const postModelProbeFailure = staticReadinessFailure(api, postModelProbeConfig, environment, agentDir, agentId);
        if (postModelProbeFailure)
            throw new Error(postModelProbeFailure);
        modelReadinessDeadline.assertBeforeDeadline();
        const searchReadinessDeadline = createStartupReadinessDeadline(searchReadinessTimeoutMs, CODEX_SEARCH_PROBE_ERROR);
        let stateDir;
        try {
            stateDir = api.runtime.state.resolveStateDir(environment);
        }
        catch {
            throw new Error(CODEX_SEARCH_ATTESTATION_ERROR);
        }
        const boundResolution = await searchReadinessDeadline.run(async () => await resolveBoundCodexSearchProvider(api, runtimeConfigGuard.executionConfig, options.codexPackageAttestor ?? attestOfficialCodexPackage, options.codexPluginRecordResolver ??
            resolveRuntimeSelectedOfficialCodexPluginRecord, environment, stateDir, agentWorkspaceDir, clearEnv, searchReadinessDeadline.signal));
        if (!boundResolution.bound)
            throw new Error(boundResolution.error);
        const boundCodexProvider = boundResolution.bound;
        if (!await searchReadinessDeadline.run(async () => await revalidateBoundCodexSearchProvider(api, runtimeConfigGuard.executionConfig, boundCodexProvider, searchReadinessDeadline.signal)))
            throw new Error(CODEX_SEARCH_ATTESTATION_ERROR);
        if (!await searchReadinessDeadline.run(async () => await hasOpenAiAccountSearchAuth(api, agentAuthRuntime, runtimeConfigGuard.executionConfig, agentDir, accountProfileId, accountOAuthIdentity, searchReadinessDeadline.signal))) {
            throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
        }
        const searchProbeConfig = runtimeConfigGuard.readValidated();
        if (!searchProbeConfig)
            throw new Error(OPENAI_ACCOUNT_TRANSPORT_ERROR);
        const searchProbeFailure = staticReadinessFailure(api, searchProbeConfig, environment, agentDir, agentId);
        if (searchProbeFailure)
            throw new Error(searchProbeFailure);
        if (!isOpenAiAccountModel(preflight, searchProbeConfig, accountProfileId) || !hasCanonicalOpenAiAccountModelTransport(preflight) ||
            !await searchReadinessDeadline.run(async () => await hasBoundPreparedOpenAiAccount(preflight, accountOAuthIdentity, preparedAuthAccountInspector, searchReadinessDeadline.signal)) ||
            !hasExactOpenAiAccountAuthState(agentAuthRuntime, searchProbeConfig, agentDir, accountProfileId, accountOAuthIdentity)) {
            throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
        }
        if (!await searchReadinessDeadline.run(async () => await revalidateBoundCodexSearchProvider(api, searchProbeConfig, boundCodexProvider, searchReadinessDeadline.signal)))
            throw new Error(CODEX_SEARCH_ATTESTATION_ERROR);
        const readinessAuthStore = loadBoundOpenAiOAuthStore(agentAuthRuntime, searchProbeConfig, agentDir, accountProfileId, accountOAuthIdentity);
        if (!readinessAuthStore)
            throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
        if (!await runCodexSearchReadinessProbe(boundCodexProvider, searchProbeConfig, agentDir, accountProfileId, readinessAuthStore, searchReadinessDeadline)) {
            throw new Error(CODEX_SEARCH_PROBE_ERROR);
        }
        const postProbeConfig = runtimeConfigGuard.readValidated();
        if (!postProbeConfig)
            throw new Error(OPENAI_ACCOUNT_TRANSPORT_ERROR);
        const postProbeFailure = staticReadinessFailure(api, postProbeConfig, environment, agentDir, agentId);
        if (postProbeFailure)
            throw new Error(postProbeFailure);
        if (!await searchReadinessDeadline.run(async () => await revalidateBoundCodexSearchProvider(api, postProbeConfig, boundCodexProvider, searchReadinessDeadline.signal)))
            throw new Error(CODEX_SEARCH_ATTESTATION_ERROR);
        if (!await searchReadinessDeadline.run(async () => await hasOpenAiAccountSearchAuth(api, agentAuthRuntime, postProbeConfig, agentDir, accountProfileId, accountOAuthIdentity, searchReadinessDeadline.signal))) {
            throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
        }
        const finalStartupConfig = runtimeConfigGuard.readValidated();
        if (!finalStartupConfig)
            throw new Error(OPENAI_ACCOUNT_TRANSPORT_ERROR);
        const finalStartupFailure = staticReadinessFailure(api, finalStartupConfig, environment, agentDir, agentId);
        if (finalStartupFailure)
            throw new Error(finalStartupFailure);
        if (!await searchReadinessDeadline.run(async () => await revalidateBoundCodexSearchProvider(api, finalStartupConfig, boundCodexProvider, searchReadinessDeadline.signal)))
            throw new Error(CODEX_SEARCH_ATTESTATION_ERROR);
        if (!await searchReadinessDeadline.run(async () => await hasOpenAiAccountSearchAuth(api, agentAuthRuntime, finalStartupConfig, agentDir, accountProfileId, accountOAuthIdentity, searchReadinessDeadline.signal))) {
            throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
        }
        if (!isOpenAiAccountModel(preflight, finalStartupConfig, accountProfileId) || !hasCanonicalOpenAiAccountModelTransport(preflight) ||
            !await searchReadinessDeadline.run(async () => await hasBoundPreparedOpenAiAccount(preflight, accountOAuthIdentity, preparedAuthAccountInspector, searchReadinessDeadline.signal)) ||
            !hasExactOpenAiAccountAuthState(agentAuthRuntime, finalStartupConfig, agentDir, accountProfileId, accountOAuthIdentity)) {
            throw new Error(OPENAI_ACCOUNT_AUTH_ERROR);
        }
        searchReadinessDeadline.assertBeforeDeadline();
        const activeControllers = new Set();
        const activeRuns = new Set();
        const drainingStatusExecutions = new Map();
        const drainingModelExecutions = new Map();
        const assertNoDrainingModelExecution = () => {
            if (drainingModelExecutions.size === 0)
                return;
            throw new BridgeRequestError(503, 'MODEL_PROVIDER_DRAINING', 'A previous model turn is still draining after cancellation.');
        };
        const drainDetachedStatusExecution = async (controller, execution) => {
            drainingStatusExecutions.set(controller, execution);
            const retire = () => {
                if (drainingStatusExecutions.get(controller) !== execution)
                    return;
                drainingStatusExecutions.delete(controller);
                activeControllers.delete(controller);
            };
            const retirement = execution.then(retire, retire);
            let timeout;
            try {
                await Promise.race([
                    retirement,
                    new Promise((resolve) => {
                        timeout = setTimeout(resolve, PROVIDER_ABORT_DRAIN_MS);
                    }),
                ]);
            }
            finally {
                if (timeout !== undefined)
                    clearTimeout(timeout);
            }
        };
        const modelTurns = new Map();
        const completeModelTurn = (record) => {
            if (modelTurns.get(record.turnId) !== record || record.state === 'terminal') {
                return;
            }
            record.state = 'terminal';
            record.expiresAt = Date.now() + MODEL_TURN_TOMBSTONE_MS;
        };
        const reserveModelTurn = (input) => {
            if (input.turnId === null)
                return null;
            const now = Date.now();
            for (const [turnId, record] of modelTurns) {
                if (record.state === 'terminal' &&
                    record.expiresAt !== null && record.expiresAt <= now) {
                    modelTurns.delete(turnId);
                }
            }
            const digest = modelTurnRequestDigest(input);
            const existing = modelTurns.get(input.turnId);
            if (existing) {
                if (existing.digest !== digest) {
                    throw new BridgeRequestError(409, 'MODEL_TURN_CONFLICT', 'The model turn identity was already bound to different input.');
                }
                throw new BridgeRequestError(409, existing.state === 'terminal'
                    ? 'MODEL_TURN_ALREADY_SETTLED'
                    : 'MODEL_TURN_IN_PROGRESS', existing.state === 'terminal'
                    ? 'The model turn was already settled.'
                    : 'The model turn is already running.');
            }
            while (modelTurns.size >= MAX_MODEL_TURN_RECORDS) {
                const oldestTerminal = [...modelTurns.entries()].find(([, record]) => record.state === 'terminal');
                if (!oldestTerminal) {
                    throw new BridgeRequestError(503, 'MODEL_TURN_REGISTRY_FULL', 'The model turn registry is at its safe in-process limit.');
                }
                modelTurns.delete(oldestTerminal[0]);
            }
            const record = {
                digest,
                expiresAt: null,
                state: 'active',
                turnId: input.turnId,
            };
            modelTurns.set(record.turnId, record);
            return record;
        };
        let expectedHost = '';
        let closing = false;
        const server = createServer((request, response) => {
            const run = (async () => {
                if (closing ||
                    request.socket.remoteAddress !== LOOPBACK_HOST ||
                    request.headers.host !== expectedHost ||
                    !authorized(request, token)) {
                    throw new BridgeRequestError(401, 'UNAUTHORIZED', 'Bridge authorization failed.');
                }
                if (activeControllers.size >= maxConcurrentRuns) {
                    throw new BridgeRequestError(503, 'BRIDGE_BUSY', 'The bridge is at its concurrency limit.');
                }
                if (request.method === 'GET' && request.url === '/v1/status') {
                    const controller = new AbortController();
                    activeControllers.add(controller);
                    let timedOut = false;
                    let clientDisconnected = false;
                    const requestDeadline = Date.now() + OPENCLAW_STATUS_TIMEOUT_MS;
                    const markTimedOut = () => {
                        timedOut = true;
                        controller.abort(new Error('WebChess bridge status timeout'));
                    };
                    const expireElapsedDeadline = () => {
                        if (!timedOut && Date.now() >= requestDeadline)
                            markTimedOut();
                        return timedOut;
                    };
                    const timeout = setTimeout(markTimedOut, OPENCLAW_STATUS_TIMEOUT_MS);
                    const onAborted = () => {
                        clientDisconnected = true;
                        controller.abort(new Error('WebChess bridge status client disconnected'));
                    };
                    const onClosed = () => {
                        if (!response.writableEnded)
                            onAborted();
                    };
                    request.once('aborted', onAborted);
                    response.once('close', onClosed);
                    if (request.aborted || response.destroyed)
                        onAborted();
                    const statusDependencyExecution = { current: null };
                    const statusAbortFailure = () => {
                        expireElapsedDeadline();
                        return timedOut
                            ? new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'The OpenClaw status check timed out.')
                            : new BridgeRequestError(408, 'OPENCLAW_ABORTED', 'The OpenClaw status check was cancelled.');
                    };
                    const runStatusStage = async (execute) => {
                        if (expireElapsedDeadline() || controller.signal.aborted) {
                            throw statusAbortFailure();
                        }
                        let outcome;
                        try {
                            outcome = await raceProviderExecution(() => {
                                const execution = execute();
                                statusDependencyExecution.current = execution;
                                void execution.then(() => {
                                    if (statusDependencyExecution.current === execution) {
                                        statusDependencyExecution.current = null;
                                    }
                                }, () => {
                                    if (statusDependencyExecution.current === execution) {
                                        statusDependencyExecution.current = null;
                                    }
                                });
                                return execution;
                            }, controller.signal, expireElapsedDeadline);
                        }
                        catch (error) {
                            if (!expireElapsedDeadline() && !controller.signal.aborted) {
                                throw error;
                            }
                            throw statusAbortFailure();
                        }
                        if (outcome.status === 'aborted' ||
                            expireElapsedDeadline() || controller.signal.aborted) {
                            throw statusAbortFailure();
                        }
                        return outcome.value;
                    };
                    try {
                        const statusConfig = runtimeConfigGuard.readValidated();
                        if (!statusConfig) {
                            throw new BridgeRequestError(503, 'OPENCLAW_NOT_READY', OPENAI_ACCOUNT_TRANSPORT_ERROR);
                        }
                        const statusFailure = staticReadinessFailure(api, statusConfig, environment, agentDir, agentId);
                        if (statusFailure) {
                            throw new BridgeRequestError(503, 'OPENCLAW_NOT_READY', statusFailure);
                        }
                        if (!await runStatusStage(async () => await revalidateBoundCodexSearchProvider(api, statusConfig, boundCodexProvider, controller.signal))) {
                            throw new BridgeRequestError(503, 'OPENCLAW_NOT_READY', CODEX_SEARCH_ATTESTATION_ERROR);
                        }
                        const statusModelResult = await runStatusStage(async () => await prepareOpenAiAccountModel(simpleCompletion, preparedAuthAccountInspector, agentAuthRuntime, statusConfig, agentId, agentDir, accountProfileId, accountOAuthIdentity, controller.signal));
                        if (!statusModelResult.ok) {
                            throw new BridgeRequestError(503, 'OPENCLAW_NOT_READY', statusModelResult.message);
                        }
                        if (!await runStatusStage(async () => await hasOpenAiAccountSearchAuth(api, agentAuthRuntime, statusConfig, agentDir, accountProfileId, accountOAuthIdentity, controller.signal))) {
                            throw new BridgeRequestError(503, 'OPENCLAW_NOT_READY', OPENAI_ACCOUNT_AUTH_ERROR);
                        }
                        const postStatusConfig = runtimeConfigGuard.readValidated();
                        if (!postStatusConfig) {
                            throw new BridgeRequestError(503, 'OPENCLAW_NOT_READY', OPENAI_ACCOUNT_TRANSPORT_ERROR);
                        }
                        const postStatusFailure = staticReadinessFailure(api, postStatusConfig, environment, agentDir, agentId);
                        if (postStatusFailure) {
                            throw new BridgeRequestError(503, 'OPENCLAW_NOT_READY', postStatusFailure);
                        }
                        if (!await runStatusStage(async () => await revalidateBoundCodexSearchProvider(api, postStatusConfig, boundCodexProvider, controller.signal))) {
                            throw new BridgeRequestError(503, 'OPENCLAW_NOT_READY', CODEX_SEARCH_ATTESTATION_ERROR);
                        }
                        const statusPrepared = statusModelResult.prepared;
                        if (!isOpenAiAccountModel(statusPrepared, postStatusConfig, accountProfileId) || !await runStatusStage(async () => await hasBoundPreparedOpenAiAccount(statusPrepared, accountOAuthIdentity, preparedAuthAccountInspector, controller.signal)) || !hasExactOpenAiAccountAuthState(agentAuthRuntime, postStatusConfig, agentDir, accountProfileId, accountOAuthIdentity)) {
                            throw new BridgeRequestError(503, 'OPENCLAW_NOT_READY', OPENAI_ACCOUNT_AUTH_ERROR);
                        }
                        if (!hasCanonicalOpenAiAccountModelTransport(statusPrepared)) {
                            throw new BridgeRequestError(503, 'OPENCLAW_NOT_READY', OPENAI_ACCOUNT_TRANSPORT_ERROR);
                        }
                        if (expireElapsedDeadline() || clientDisconnected ||
                            controller.signal.aborted) {
                            throw statusAbortFailure();
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
                        }, maxResponseBytes);
                        return;
                    }
                    finally {
                        clearTimeout(timeout);
                        request.off('aborted', onAborted);
                        response.off('close', onClosed);
                        const detachedExecution = statusDependencyExecution.current;
                        if (detachedExecution) {
                            await drainDetachedStatusExecution(controller, detachedExecution);
                        }
                        else {
                            activeControllers.delete(controller);
                        }
                    }
                }
                if (request.method !== 'POST') {
                    throw new BridgeRequestError(404, 'NOT_FOUND', 'Unknown bridge endpoint.');
                }
                const body = await readJsonBody(request, maxRequestBytes);
                const controller = new AbortController();
                activeControllers.add(controller);
                let timedOut = false;
                let clientDisconnected = false;
                const timeoutMs = isRecord(body) && typeof body.timeoutMs === 'number'
                    ? body.timeoutMs
                    : 0;
                const timeoutDelayMs = Number.isSafeInteger(timeoutMs) && timeoutMs > 0
                    ? timeoutMs
                    : 1;
                const requestStartedAt = Date.now();
                let requestDeadline = requestStartedAt + timeoutDelayMs;
                const markTimedOut = () => {
                    timedOut = true;
                    controller.abort(new Error('WebChess bridge timeout'));
                };
                const expireElapsedDeadline = () => {
                    if (!timedOut && Date.now() >= requestDeadline)
                        markTimedOut();
                    return timedOut;
                };
                let timeout = setTimeout(markTimedOut, timeoutDelayMs);
                const resetRequestDeadline = (deadlineAt) => {
                    clearTimeout(timeout);
                    requestDeadline = deadlineAt;
                    timeout = setTimeout(markTimedOut, Math.max(1, requestDeadline - Date.now()));
                };
                const onAborted = () => {
                    clientDisconnected = true;
                    controller.abort(new Error('WebChess bridge client disconnected'));
                };
                const onClosed = () => {
                    if (!response.writableEnded)
                        onAborted();
                };
                request.once('aborted', onAborted);
                response.once('close', onClosed);
                let modelTurn = null;
                const modelProviderExecution = {
                    current: null,
                };
                try {
                    if (request.url === '/v1/model/run') {
                        const input = parseModelRunRequest(body);
                        // A timed-out provider may ignore cancellation and continue running
                        // after its HTTP request has settled. Do not let a fresh logical turn
                        // overlap that unknown outcome: one retained controller is not enough
                        // to fill the bridge's general four-request limit by itself.
                        assertNoDrainingModelExecution();
                        const modelRequestDeadline = requestStartedAt + MODEL_REQUEST_ENVELOPE_TIMEOUT_MS;
                        const latestProviderStartAt = modelRequestDeadline -
                            input.timeoutMs - MODEL_REQUEST_POSTFLIGHT_RESERVE_MS;
                        // Preflight has a bounded share of the aggregate envelope. Refuse to
                        // start a provider turn unless its complete allowance and postflight
                        // reserve still fit; this prevents authenticated setup from silently
                        // shortening the provider's configured 150-second ceiling.
                        resetRequestDeadline(latestProviderStartAt);
                        modelTurn = reserveModelTurn(input);
                        const providerController = new AbortController();
                        let providerTimedOut = false;
                        let providerDeadlineAt = null;
                        const markProviderTimedOut = () => {
                            if (providerTimedOut)
                                return;
                            providerTimedOut = true;
                            providerController.abort(new Error('WebChess bridge provider timeout'));
                        };
                        const providerDeadlineExpired = () => {
                            if (!providerTimedOut && providerDeadlineAt !== null &&
                                Date.now() >= providerDeadlineAt) {
                                markProviderTimedOut();
                            }
                            return providerTimedOut;
                        };
                        const modelAbortFailure = () => {
                            expireElapsedDeadline();
                            return timedOut || providerDeadlineExpired()
                                ? new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'The OpenClaw model run timed out.')
                                : new BridgeRequestError(408, 'OPENCLAW_ABORTED', 'The OpenClaw model run was cancelled.');
                        };
                        const runModelStage = async (execute) => {
                            if (expireElapsedDeadline() || controller.signal.aborted) {
                                throw modelAbortFailure();
                            }
                            const outcome = await raceProviderExecution(execute, controller.signal, expireElapsedDeadline);
                            if (outcome.status === 'aborted' ||
                                expireElapsedDeadline() || controller.signal.aborted) {
                                throw modelAbortFailure();
                            }
                            return outcome.value;
                        };
                        const requestConfig = runtimeConfigGuard.readValidated();
                        if (!requestConfig) {
                            throw new BridgeRequestError(503, 'OPENCLAW_MODEL_NOT_READY', OPENAI_ACCOUNT_TRANSPORT_ERROR);
                        }
                        const requestFailure = staticReadinessFailure(api, requestConfig, environment, agentDir, agentId);
                        if (requestFailure) {
                            throw new BridgeRequestError(503, 'OPENCLAW_MODEL_NOT_READY', requestFailure);
                        }
                        if (!await runModelStage(async () => await revalidateBoundCodexSearchProvider(api, requestConfig, boundCodexProvider, controller.signal))) {
                            throw new BridgeRequestError(503, 'OPENCLAW_MODEL_NOT_READY', CODEX_SEARCH_ATTESTATION_ERROR);
                        }
                        const preparedResult = await runModelStage(async () => await prepareOpenAiAccountModel(simpleCompletion, preparedAuthAccountInspector, agentAuthRuntime, requestConfig, agentId, agentDir, accountProfileId, accountOAuthIdentity));
                        if (!preparedResult.ok) {
                            throw new BridgeRequestError(503, 'OPENCLAW_MODEL_NOT_READY', preparedResult.message);
                        }
                        const prepared = preparedResult.prepared;
                        const postPrepareConfig = runtimeConfigGuard.readValidated();
                        if (!postPrepareConfig) {
                            throw new BridgeRequestError(503, 'OPENCLAW_MODEL_NOT_READY', OPENAI_ACCOUNT_TRANSPORT_ERROR);
                        }
                        const postPrepareFailure = staticReadinessFailure(api, postPrepareConfig, environment, agentDir, agentId);
                        if (postPrepareFailure) {
                            throw new BridgeRequestError(503, 'OPENCLAW_MODEL_NOT_READY', postPrepareFailure);
                        }
                        if (!await runModelStage(async () => await revalidateBoundCodexSearchProvider(api, postPrepareConfig, boundCodexProvider, controller.signal))) {
                            throw new BridgeRequestError(503, 'OPENCLAW_MODEL_NOT_READY', CODEX_SEARCH_ATTESTATION_ERROR);
                        }
                        const preparedAccountBound = await runModelStage(async () => await hasBoundPreparedOpenAiAccount(prepared, accountOAuthIdentity, preparedAuthAccountInspector));
                        if (!isOpenAiAccountModel(prepared, postPrepareConfig, accountProfileId) || !preparedAccountBound || !hasExactOpenAiAccountAuthState(agentAuthRuntime, postPrepareConfig, agentDir, accountProfileId, accountOAuthIdentity)) {
                            throw new BridgeRequestError(503, 'OPENCLAW_MODEL_NOT_READY', OPENAI_ACCOUNT_AUTH_ERROR);
                        }
                        if (!hasCanonicalOpenAiAccountModelTransport(prepared)) {
                            throw new BridgeRequestError(503, 'OPENCLAW_MODEL_NOT_READY', OPENAI_ACCOUNT_TRANSPORT_ERROR);
                        }
                        const systemPrompt = prepared.model.api === 'openai-chatgpt-responses'
                            ? OPENCLAW_LOCAL_MODEL_RUN_SYSTEM_PROMPT
                            : undefined;
                        let result;
                        let providerStarted = false;
                        const providerSignal = AbortSignal.any([
                            controller.signal,
                            providerController.signal,
                        ]);
                        const retainDrainingModelExecution = () => {
                            const execution = modelProviderExecution.current;
                            if (!execution)
                                return false;
                            if (modelTurn)
                                modelTurn.state = 'draining';
                            drainingModelExecutions.set(controller, execution);
                            return true;
                        };
                        const onProviderAbort = () => {
                            // Abort listeners run synchronously. Register unknown provider work
                            // before another admitted request can cross its dispatch boundary.
                            retainDrainingModelExecution();
                        };
                        providerSignal.addEventListener('abort', onProviderAbort);
                        let providerTimeout;
                        try {
                            const completion = await raceProviderExecution(async () => {
                                // This callback is the actual provider-dispatch boundary. Only
                                // now does the independently bounded provider turn begin.
                                assertNoDrainingModelExecution();
                                providerStarted = true;
                                resetRequestDeadline(modelRequestDeadline);
                                providerDeadlineAt = Date.now() + input.timeoutMs;
                                providerTimeout = setTimeout(markProviderTimedOut, input.timeoutMs);
                                const execution = Promise.resolve().then(async () => await simpleCompletion.completeWithPreparedSimpleCompletionModel({
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
                                        signal: providerSignal,
                                    },
                                }));
                                modelProviderExecution.current = execution;
                                void execution.then(() => {
                                    if (modelProviderExecution.current === execution) {
                                        modelProviderExecution.current = null;
                                    }
                                    if (modelTurn?.state === 'draining') {
                                        completeModelTurn(modelTurn);
                                    }
                                    if (drainingModelExecutions.get(controller) === execution) {
                                        drainingModelExecutions.delete(controller);
                                        activeControllers.delete(controller);
                                    }
                                }, () => {
                                    if (modelProviderExecution.current === execution) {
                                        modelProviderExecution.current = null;
                                    }
                                    if (modelTurn?.state === 'draining') {
                                        completeModelTurn(modelTurn);
                                    }
                                    if (drainingModelExecutions.get(controller) === execution) {
                                        drainingModelExecutions.delete(controller);
                                        activeControllers.delete(controller);
                                    }
                                });
                                return await execution;
                            }, providerSignal, () => providerDeadlineExpired() || expireElapsedDeadline());
                            if (completion.status === 'aborted') {
                                throw modelAbortFailure();
                            }
                            result = completion.value;
                        }
                        catch (error) {
                            if (providerStarted && providerSignal.aborted) {
                                retainDrainingModelExecution();
                                await new Promise((resolve) => {
                                    setTimeout(resolve, PROVIDER_ABORT_DRAIN_MS);
                                });
                            }
                            if (providerDeadlineExpired() || expireElapsedDeadline()) {
                                throw modelAbortFailure();
                            }
                            if (clientDisconnected || providerSignal.aborted) {
                                throw modelAbortFailure();
                            }
                            throw error;
                        }
                        finally {
                            if (providerTimeout !== undefined)
                                clearTimeout(providerTimeout);
                            providerSignal.removeEventListener('abort', onProviderAbort);
                        }
                        if (providerDeadlineExpired() || expireElapsedDeadline()) {
                            throw modelAbortFailure();
                        }
                        // The provider result crossed its absolute deadline check. Retire
                        // that deadline now so the separately bounded postflight may use the
                        // remaining aggregate envelope without being misclassified as late
                        // provider work.
                        providerDeadlineAt = null;
                        if (clientDisconnected || controller.signal.aborted) {
                            throw modelAbortFailure();
                        }
                        const postCompletionConfig = runtimeConfigGuard.readValidated();
                        if (!postCompletionConfig) {
                            throw new BridgeRequestError(503, 'OPENCLAW_MODEL_NOT_READY', OPENAI_ACCOUNT_TRANSPORT_ERROR);
                        }
                        const postCompletionFailure = staticReadinessFailure(api, postCompletionConfig, environment, agentDir, agentId);
                        if (postCompletionFailure) {
                            throw new BridgeRequestError(503, 'OPENCLAW_MODEL_NOT_READY', postCompletionFailure);
                        }
                        if (!await runModelStage(async () => await revalidateBoundCodexSearchProvider(api, postCompletionConfig, boundCodexProvider, controller.signal))) {
                            throw new BridgeRequestError(503, 'OPENCLAW_MODEL_NOT_READY', CODEX_SEARCH_ATTESTATION_ERROR);
                        }
                        const completedAccountBound = await runModelStage(async () => await hasBoundPreparedOpenAiAccount(prepared, accountOAuthIdentity, preparedAuthAccountInspector));
                        if (!isOpenAiAccountModel(prepared, postCompletionConfig, accountProfileId) || !completedAccountBound || !hasExactOpenAiAccountAuthState(agentAuthRuntime, postCompletionConfig, agentDir, accountProfileId, accountOAuthIdentity)) {
                            throw new BridgeRequestError(503, 'OPENCLAW_MODEL_NOT_READY', OPENAI_ACCOUNT_AUTH_ERROR);
                        }
                        if (!hasCanonicalOpenAiAccountModelTransport(prepared)) {
                            throw new BridgeRequestError(503, 'OPENCLAW_MODEL_NOT_READY', OPENAI_ACCOUNT_TRANSPORT_ERROR);
                        }
                        if (result.stopReason !== 'stop' ||
                            (result.errorMessage?.length ?? 0) > 0) {
                            throw new BridgeRequestError(502, 'OPENCLAW_MODEL_FAILED', 'The OpenClaw model did not complete successfully.');
                        }
                        const outputText = textFromCompletion(result.content);
                        const provider = prepared.selection.provider.trim();
                        const model = prepared.selection.modelId.trim();
                        if (!outputText || !provider || !model) {
                            throw new BridgeRequestError(502, 'INVALID_MODEL_RESULT', 'The OpenClaw model result was incomplete.');
                        }
                        if (providerDeadlineExpired() || expireElapsedDeadline()) {
                            throw modelAbortFailure();
                        }
                        if (clientDisconnected || controller.signal.aborted) {
                            throw modelAbortFailure();
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
                        }, maxResponseBytes);
                        return;
                    }
                    if (request.url === '/v1/web/search') {
                        const input = parseWebSearchRequest(body);
                        const searchAbortFailure = () => {
                            expireElapsedDeadline();
                            return timedOut
                                ? new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'Codex Hosted Search timed out.')
                                : new BridgeRequestError(408, 'OPENCLAW_ABORTED', 'Codex Hosted Search was cancelled.');
                        };
                        const runSearchStage = async (execute) => {
                            if (expireElapsedDeadline() || controller.signal.aborted) {
                                throw searchAbortFailure();
                            }
                            const outcome = await raceProviderExecution(execute, controller.signal, expireElapsedDeadline);
                            if (outcome.status === 'aborted' ||
                                expireElapsedDeadline() || controller.signal.aborted) {
                                throw searchAbortFailure();
                            }
                            return outcome.value;
                        };
                        const requestConfig = runtimeConfigGuard.readValidated();
                        if (!requestConfig) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', OPENAI_ACCOUNT_TRANSPORT_ERROR);
                        }
                        const requestFailure = staticReadinessFailure(api, requestConfig, environment, agentDir, agentId);
                        if (requestFailure) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', requestFailure);
                        }
                        if (!await runSearchStage(async () => await revalidateBoundCodexSearchProvider(api, requestConfig, boundCodexProvider, controller.signal))) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', CODEX_SEARCH_ATTESTATION_ERROR);
                        }
                        if (!await runSearchStage(async () => await hasOpenAiAccountSearchAuth(api, agentAuthRuntime, requestConfig, agentDir, accountProfileId, accountOAuthIdentity))) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', OPENAI_ACCOUNT_AUTH_ERROR);
                        }
                        const postAuthConfig = runtimeConfigGuard.readValidated();
                        if (!postAuthConfig) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', OPENAI_ACCOUNT_TRANSPORT_ERROR);
                        }
                        const postAuthFailure = staticReadinessFailure(api, postAuthConfig, environment, agentDir, agentId);
                        if (postAuthFailure) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', postAuthFailure);
                        }
                        if (!await runSearchStage(async () => await revalidateBoundCodexSearchProvider(api, postAuthConfig, boundCodexProvider, controller.signal))) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', CODEX_SEARCH_ATTESTATION_ERROR);
                        }
                        if (!hasExactOpenAiAccountAuthState(agentAuthRuntime, postAuthConfig, agentDir, accountProfileId, accountOAuthIdentity)) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', OPENAI_ACCOUNT_AUTH_ERROR);
                        }
                        const boundAuthStore = loadBoundOpenAiOAuthStore(agentAuthRuntime, postAuthConfig, agentDir, accountProfileId, accountOAuthIdentity);
                        if (!boundAuthStore) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', OPENAI_ACCOUNT_AUTH_ERROR);
                        }
                        let rawSearchResult;
                        try {
                            rawSearchResult = await runSearchStage(async () => await boundCodexProvider.attestation.executeSearch({
                                agentDir,
                                authProfileId: accountProfileId,
                                authProfileStore: boundAuthStore,
                                config: postAuthConfig,
                                query: input.query,
                                searchConfig: postAuthConfig.tools?.web?.search,
                                signal: controller.signal,
                            }));
                        }
                        catch (error) {
                            if (controller.signal.aborted) {
                                // The pinned Codex worker schedules a process-group SIGKILL one
                                // second after close. Keep this plugin-owned request alive long
                                // enough for that cleanup; this is not a provider-side billing
                                // cancellation acknowledgement.
                                await new Promise((resolve) => setTimeout(resolve, PROVIDER_ABORT_DRAIN_MS));
                            }
                            if (expireElapsedDeadline()) {
                                throw new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'Codex Hosted Search timed out.');
                            }
                            if (clientDisconnected || controller.signal.aborted) {
                                throw new BridgeRequestError(408, 'OPENCLAW_ABORTED', 'Codex Hosted Search was cancelled.');
                            }
                            throw error;
                        }
                        if (expireElapsedDeadline()) {
                            throw new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'Codex Hosted Search timed out.');
                        }
                        if (clientDisconnected || controller.signal.aborted) {
                            throw new BridgeRequestError(408, 'OPENCLAW_ABORTED', 'Codex Hosted Search was cancelled.');
                        }
                        const postSearchConfig = runtimeConfigGuard.readValidated();
                        if (!postSearchConfig) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', OPENAI_ACCOUNT_TRANSPORT_ERROR);
                        }
                        const postSearchFailure = staticReadinessFailure(api, postSearchConfig, environment, agentDir, agentId);
                        if (postSearchFailure) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', postSearchFailure);
                        }
                        if (!await runSearchStage(async () => await revalidateBoundCodexSearchProvider(api, postSearchConfig, boundCodexProvider, controller.signal))) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', CODEX_SEARCH_ATTESTATION_ERROR);
                        }
                        if (!await runSearchStage(async () => await hasOpenAiAccountSearchAuth(api, agentAuthRuntime, postSearchConfig, agentDir, accountProfileId, accountOAuthIdentity))) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', OPENAI_ACCOUNT_AUTH_ERROR);
                        }
                        if (!isDeepStrictEqual(snapshotOAuthCredentialIdentity(boundAuthStore, accountProfileId), accountOAuthIdentity)) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', OPENAI_ACCOUNT_AUTH_ERROR);
                        }
                        if (expireElapsedDeadline()) {
                            throw new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'Codex Hosted Search timed out.');
                        }
                        if (clientDisconnected || controller.signal.aborted) {
                            throw new BridgeRequestError(408, 'OPENCLAW_ABORTED', 'Codex Hosted Search was cancelled.');
                        }
                        const finalSearchConfig = runtimeConfigGuard.readValidated();
                        if (!finalSearchConfig) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', OPENAI_ACCOUNT_TRANSPORT_ERROR);
                        }
                        const finalSearchFailure = staticReadinessFailure(api, finalSearchConfig, environment, agentDir, agentId);
                        if (finalSearchFailure) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', finalSearchFailure);
                        }
                        if (!await runSearchStage(async () => await revalidateBoundCodexSearchProvider(api, finalSearchConfig, boundCodexProvider, controller.signal))) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', CODEX_SEARCH_ATTESTATION_ERROR);
                        }
                        if (!hasExactOpenAiAccountAuthState(agentAuthRuntime, finalSearchConfig, agentDir, accountProfileId, accountOAuthIdentity)) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', OPENAI_ACCOUNT_AUTH_ERROR);
                        }
                        if (expireElapsedDeadline()) {
                            throw new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'Codex Hosted Search timed out.');
                        }
                        if (clientDisconnected || controller.signal.aborted) {
                            throw new BridgeRequestError(408, 'OPENCLAW_ABORTED', 'Codex Hosted Search was cancelled.');
                        }
                        if (!isValidCodexSearchResult(rawSearchResult, input.query)) {
                            throw new BridgeRequestError(503, 'OPENCLAW_SEARCH_NOT_READY', CODEX_SEARCH_PROVIDER_ERROR);
                        }
                        if (expireElapsedDeadline()) {
                            throw new BridgeRequestError(504, 'OPENCLAW_TIMEOUT', 'Codex Hosted Search timed out.');
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
                        }, maxResponseBytes);
                        return;
                    }
                    throw new BridgeRequestError(404, 'NOT_FOUND', 'Unknown bridge endpoint.');
                }
                finally {
                    let retainControllerForDrainingModel = false;
                    const drainingExecution = modelProviderExecution.current;
                    if (drainingExecution) {
                        if (modelTurn) {
                            modelTurn.state = 'draining';
                        }
                        // A provider that ignores cancellation may outlive the bounded HTTP
                        // drain. Keep its concurrency slot until the underlying work really
                        // settles so a keyed or unkeyed request cannot amplify billed work.
                        drainingModelExecutions.set(controller, drainingExecution);
                        retainControllerForDrainingModel = true;
                    }
                    else if (modelTurn) {
                        completeModelTurn(modelTurn);
                    }
                    clearTimeout(timeout);
                    request.off('aborted', onAborted);
                    response.off('close', onClosed);
                    if (!retainControllerForDrainingModel) {
                        activeControllers.delete(controller);
                    }
                }
            })();
            const tracked = run.then(() => undefined, (error) => {
                const failure = bridgeFailure(error);
                sendJson(response, failure.status, {
                    error: {
                        code: failure.code,
                        message: failure.message,
                    },
                }, maxResponseBytes);
            }).finally(() => activeRuns.delete(tracked));
            activeRuns.add(tracked);
        });
        server.on('clientError', (_error, socket) => socket.destroy());
        const port = await listen(server, host);
        expectedHost = `${host}:${port}`;
        return {
            token,
            url: `http://${expectedHost}`,
            async close() {
                if (closing)
                    return;
                closing = true;
                for (const controller of activeControllers) {
                    controller.abort(new Error('WebChess bridge is closing'));
                }
                try {
                    await Promise.allSettled([...activeRuns]);
                    // Every detached status dependency has already received its bounded
                    // drain while its active run settled. Retire remaining tombstones only
                    // during final bridge shutdown; while the bridge is open they continue
                    // consuming finite concurrency slots until the dependency really ends.
                    for (const controller of drainingStatusExecutions.keys()) {
                        drainingStatusExecutions.delete(controller);
                        activeControllers.delete(controller);
                    }
                    // Model work that ignored cancellation retains a slot while this
                    // bridge accepts requests. Shutdown is already exclusive (`closing`),
                    // so retire those bookkeeping entries without waiting indefinitely.
                    for (const controller of drainingModelExecutions.keys()) {
                        drainingModelExecutions.delete(controller);
                        activeControllers.delete(controller);
                    }
                    await closeServer(server);
                }
                finally {
                    runtimeConfigGuard.restore();
                }
            },
        };
    }
    catch (error) {
        runtimeConfigGuard.restore();
        throw error;
    }
}
