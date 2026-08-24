import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, cp, lstat, mkdir, mkdtemp, open, rm, symlink, } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWebChessBridge, } from './bridge.js';
const DEFAULT_PORT = 3210;
// A cold staged Next.js compile and OpenClaw provider/database health check can
// legitimately exceed one minute on a busy local machine. Keep each probe
// bounded while giving the foreground launcher enough time to become ready.
const STARTUP_TIMEOUT_MS = 120_000;
const READINESS_REQUEST_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const RUNTIME_IDENTITY_FORMAT = 'webchess-openclaw-runtime-identity/1';
const RUNTIME_IDENTITY_FILENAME = 'runtime-identity.json';
const MAX_RUNTIME_IDENTITY_BYTES = 4_096;
const LOCAL_OWNER_PATTERN = /^openclaw_[a-z0-9_-]{8,80}$/u;
const RUNTIME_ENTRIES = [
    'CODE_OF_CONDUCT.md',
    'CONTRIBUTING.md',
    'db',
    'docs',
    'INSTALL.md',
    'LICENSE',
    'next.config.ts',
    'package.json',
    'public',
    'README.md',
    'SECURITY.md',
    'src',
    'SUPPORT.md',
    'tsconfig.json',
];
function optionString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
export function parseLaunchOptions(raw) {
    const portText = optionString(raw.port) ?? String(DEFAULT_PORT);
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
        throw new Error('WebChess --port must be an integer from 1024 through 65535.');
    }
    return {
        openBrowser: raw.open !== false,
        port,
    };
}
export function resolveWebChessRoot(moduleUrl = import.meta.url) {
    return fileURLToPath(new URL('../../', moduleUrl));
}
export function resolveNextBinary(moduleUrl = import.meta.url) {
    return createRequire(moduleUrl).resolve('next/dist/bin/next');
}
export function nodeModulesRootForNextBinary(nextBinary) {
    return path.resolve(path.dirname(nextBinary), '../../..');
}
function dedicatedDatabaseUrl(environment) {
    const value = environment.WEBCHESS_OPENCLAW_DATABASE_URL?.trim();
    if (!value) {
        throw new Error('WEBCHESS_OPENCLAW_DATABASE_URL is required and must point to a dedicated loopback PostgreSQL database.');
    }
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new Error('WEBCHESS_OPENCLAW_DATABASE_URL is not a valid URL.');
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
        !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
        throw new Error('WEBCHESS_OPENCLAW_DATABASE_URL must use PostgreSQL on a loopback host.');
    }
    return value;
}
function validatedOwnerId(value, name) {
    const ownerId = value.trim();
    if (!LOCAL_OWNER_PATTERN.test(ownerId)) {
        throw new Error(`${name} must start with openclaw_ and contain only lowercase letters, numbers, underscores, or hyphens.`);
    }
    return ownerId;
}
function validatedSecret(value, name) {
    const secret = value.trim();
    if (Buffer.byteLength(secret, 'utf8') < 32) {
        throw new Error(`${name} must contain at least 32 bytes.`);
    }
    return secret;
}
function configuredRuntimeIdentity(environment) {
    const ownerId = environment.WEBCHESS_OPENCLAW_OWNER_ID;
    const hmacSecret = environment.WEBCHESS_HMAC_SECRET;
    const deletionHmacSecret = environment.WEBCHESS_DELETION_HMAC_SECRET;
    return {
        ...(ownerId?.trim()
            ? { ownerId: validatedOwnerId(ownerId, 'WEBCHESS_OPENCLAW_OWNER_ID') }
            : {}),
        ...(hmacSecret?.trim()
            ? { hmacSecret: validatedSecret(hmacSecret, 'WEBCHESS_HMAC_SECRET') }
            : {}),
        ...(deletionHmacSecret?.trim()
            ? {
                deletionHmacSecret: validatedSecret(deletionHmacSecret, 'WEBCHESS_DELETION_HMAC_SECRET'),
            }
            : {}),
    };
}
function runtimeStateRoot(environment) {
    const explicit = environment.WEBCHESS_OPENCLAW_STATE_DIR?.trim();
    if (explicit) {
        if (!path.isAbsolute(explicit) || explicit.includes('\0')) {
            throw new Error('WEBCHESS_OPENCLAW_STATE_DIR must be an absolute path.');
        }
        return path.resolve(explicit);
    }
    const configuredHome = environment.HOME?.trim() ||
        environment.USERPROFILE?.trim() || homedir();
    if (!configuredHome || !path.isAbsolute(configuredHome)) {
        throw new Error('A local home directory is required to persist the WebChess OpenClaw identity.');
    }
    if (process.platform === 'darwin') {
        return path.join(configuredHome, 'Library', 'Application Support', 'WebChess', 'OpenClaw');
    }
    if (process.platform === 'win32') {
        const localAppData = environment.LOCALAPPDATA?.trim() ||
            path.join(configuredHome, 'AppData', 'Local');
        if (!path.isAbsolute(localAppData)) {
            throw new Error('LOCALAPPDATA must be an absolute path.');
        }
        return path.join(localAppData, 'WebChess', 'OpenClaw');
    }
    const stateHome = environment.XDG_STATE_HOME?.trim() ||
        path.join(configuredHome, '.local', 'state');
    if (!path.isAbsolute(stateHome)) {
        throw new Error('XDG_STATE_HOME must be an absolute path.');
    }
    return path.join(stateHome, 'webchess', 'openclaw');
}
export function resolveRuntimeIdentityPath(environment = process.env) {
    return path.join(runtimeStateRoot(environment), RUNTIME_IDENTITY_FILENAME);
}
function randomRuntimeIdentity() {
    return {
        deletionHmacSecret: randomBytes(48).toString('base64url'),
        format: RUNTIME_IDENTITY_FORMAT,
        hmacSecret: randomBytes(48).toString('base64url'),
        ownerId: `openclaw_${randomBytes(16).toString('hex')}`,
    };
}
function parseStoredRuntimeIdentity(value) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        throw new Error('The persisted WebChess OpenClaw identity is invalid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('The persisted WebChess OpenClaw identity is invalid.');
    }
    const record = parsed;
    if (Object.keys(record).sort().join(',') !==
        'deletionHmacSecret,format,hmacSecret,ownerId' ||
        record.format !== RUNTIME_IDENTITY_FORMAT ||
        typeof record.ownerId !== 'string' ||
        typeof record.hmacSecret !== 'string' ||
        typeof record.deletionHmacSecret !== 'string') {
        throw new Error('The persisted WebChess OpenClaw identity is invalid.');
    }
    return {
        deletionHmacSecret: validatedSecret(record.deletionHmacSecret, 'Persisted deletion HMAC secret'),
        format: RUNTIME_IDENTITY_FORMAT,
        hmacSecret: validatedSecret(record.hmacSecret, 'Persisted HMAC secret'),
        ownerId: validatedOwnerId(record.ownerId, 'Persisted owner ID'),
    };
}
function isNodeError(error, code) {
    return error instanceof Error &&
        'code' in error &&
        error.code === code;
}
async function assertPrivateDirectory(directory) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error('The WebChess OpenClaw state path must be a private directory, not a symlink.');
    }
    if (process.platform !== 'win32' &&
        typeof process.getuid === 'function' &&
        info.uid !== process.getuid()) {
        throw new Error('The WebChess OpenClaw state directory has another owner.');
    }
    if (process.platform !== 'win32' && (info.mode & 0o777) !== 0o700) {
        throw new Error('The WebChess OpenClaw state directory must have mode 0700.');
    }
}
async function readStoredRuntimeIdentity(filename) {
    const beforeOpen = await lstat(filename);
    if (!beforeOpen.isFile() || beforeOpen.isSymbolicLink()) {
        throw new Error('The persisted WebChess OpenClaw identity must be a regular file, not a symlink.');
    }
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    const handle = await open(filename, flags);
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.size < 1 || info.size > MAX_RUNTIME_IDENTITY_BYTES) {
            throw new Error('The persisted WebChess OpenClaw identity has an invalid size or type.');
        }
        if (process.platform !== 'win32') {
            if ((info.mode & 0o777) !== 0o600) {
                throw new Error('The persisted WebChess OpenClaw identity must have mode 0600.');
            }
            if (typeof process.getuid === 'function' &&
                info.uid !== process.getuid()) {
                throw new Error('The persisted WebChess OpenClaw identity has another owner.');
            }
        }
        return parseStoredRuntimeIdentity(await handle.readFile('utf8'));
    }
    finally {
        await handle.close();
    }
}
async function createStoredRuntimeIdentity(filename) {
    const identity = randomRuntimeIdentity();
    const flags = fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_WRONLY |
        (fsConstants.O_NOFOLLOW ?? 0);
    const handle = await open(filename, flags, 0o600);
    try {
        await handle.writeFile(`${JSON.stringify(identity)}\n`, 'utf8');
        await handle.sync();
        await handle.chmod(0o600);
    }
    finally {
        await handle.close();
    }
    return identity;
}
export async function loadOrCreateRuntimeIdentity(environment = process.env) {
    const configured = configuredRuntimeIdentity(environment);
    if (configured.ownerId &&
        configured.hmacSecret &&
        configured.deletionHmacSecret) {
        return configured;
    }
    const filename = resolveRuntimeIdentityPath(environment);
    const directory = path.dirname(filename);
    await mkdir(directory, { mode: 0o700, recursive: true });
    await assertPrivateDirectory(directory);
    let stored;
    try {
        stored = await readStoredRuntimeIdentity(filename);
    }
    catch (error) {
        if (!isNodeError(error, 'ENOENT'))
            throw error;
        try {
            stored = await createStoredRuntimeIdentity(filename);
        }
        catch (createError) {
            if (!isNodeError(createError, 'EEXIST'))
                throw createError;
            stored = await readStoredRuntimeIdentity(filename);
        }
    }
    return {
        deletionHmacSecret: configured.deletionHmacSecret ?? stored.deletionHmacSecret,
        hmacSecret: configured.hmacSecret ?? stored.hmacSecret,
        ownerId: configured.ownerId ?? stored.ownerId,
    };
}
async function stageWebChessRuntime(sourceRoot, nextBinary) {
    const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'webchess-openclaw-runtime-'));
    try {
        await Promise.all(RUNTIME_ENTRIES.map((entry) => cp(path.join(sourceRoot, entry), path.join(runtimeRoot, entry), { recursive: true })));
        await symlink(nodeModulesRootForNextBinary(nextBinary), path.join(runtimeRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
        return runtimeRoot;
    }
    catch (error) {
        await rm(runtimeRoot, { force: true, recursive: true });
        throw error;
    }
}
export function buildNextLaunchSpec(root, options, environment = process.env, nextBinary = resolveNextBinary(), identity, bridge) {
    if (!bridge) {
        throw new Error('The authenticated OpenClaw runtime bridge is required.');
    }
    const runtimeIdentity = identity ?? (() => {
        const configured = configuredRuntimeIdentity(environment);
        if (!configured.ownerId ||
            !configured.hmacSecret ||
            !configured.deletionHmacSecret) {
            throw new Error('The persisted WebChess OpenClaw identity must be loaded before building the launch environment.');
        }
        return configured;
    })();
    const url = `http://127.0.0.1:${options.port}/openclaw`;
    const origin = `http://127.0.0.1:${options.port}`;
    const localDatabaseUrl = dedicatedDatabaseUrl(environment);
    const localEnvironment = {
        NODE_ENV: 'development',
    };
    for (const name of [
        'COLORTERM',
        'LANG',
        'LC_ALL',
        'PATH',
        'TEMP',
        'TERM',
        'TMP',
        'TMPDIR',
        'TZ',
    ]) {
        if (environment[name] !== undefined) {
            localEnvironment[name] = environment[name];
        }
    }
    Object.assign(localEnvironment, {
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_SITE_URL: origin,
        NODE_ENV: 'development',
        WEBCHESS_DAILY_GAME_LIMIT: environment.WEBCHESS_DAILY_GAME_LIMIT ?? '1000',
        WEBCHESS_DAILY_GLOBAL_MODEL_REQUEST_LIMIT: environment.WEBCHESS_DAILY_GLOBAL_MODEL_REQUEST_LIMIT ?? '10000',
        WEBCHESS_DAILY_MODEL_REQUEST_LIMIT: environment.WEBCHESS_DAILY_MODEL_REQUEST_LIMIT ?? '10000',
        WEBCHESS_DELETION_HMAC_SECRET: runtimeIdentity.deletionHmacSecret,
        WEBCHESS_HMAC_SECRET: runtimeIdentity.hmacSecret,
        WEBCHESS_HOURLY_GAME_START_LIMIT: environment.WEBCHESS_HOURLY_GAME_START_LIMIT ?? '1000',
        WEBCHESS_HOURLY_IP_GAME_START_LIMIT: environment.WEBCHESS_HOURLY_IP_GAME_START_LIMIT ?? '1000',
        WEBCHESS_HOURLY_IP_MODEL_REQUEST_LIMIT: environment.WEBCHESS_HOURLY_IP_MODEL_REQUEST_LIMIT ?? '1000',
        WEBCHESS_HOURLY_MODEL_REQUEST_LIMIT: environment.WEBCHESS_HOURLY_MODEL_REQUEST_LIMIT ?? '1000',
        WEBCHESS_OPENCLAW_DATABASE_URL: localDatabaseUrl,
        WEBCHESS_OPENCLAW_ENABLED: 'true',
        WEBCHESS_OPENCLAW_BRIDGE_TOKEN: bridge.token,
        WEBCHESS_OPENCLAW_BRIDGE_URL: bridge.url,
        WEBCHESS_OPENCLAW_OWNER_ID: runtimeIdentity.ownerId,
        WEBCHESS_OPENCLAW_TIMEOUT_MS: environment.WEBCHESS_OPENCLAW_TIMEOUT_MS ?? '150000',
        WEBCHESS_OPENCLAW_TRANSPORT: 'local',
    });
    return {
        args: [
            nextBinary,
            'dev',
            '--webpack',
            '--hostname',
            '127.0.0.1',
            '--port',
            String(options.port),
        ],
        command: process.execPath,
        cwd: root,
        detached: process.platform !== 'win32',
        env: localEnvironment,
        readinessUrl: `${origin}/api/openclaw/status`,
        url,
    };
}
function defaultOpenBrowser(url) {
    const command = process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
            ? 'cmd.exe'
            : 'xdg-open';
    const args = process.platform === 'win32'
        ? ['/c', 'start', '', url]
        : [url];
    const child = spawn(command, args, {
        detached: true,
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
    });
    child.once('error', () => {
        // The URL was already printed; a missing platform opener is non-fatal.
    });
    child.unref();
}
const defaultDependencies = {
    environment: process.env,
    fetch: globalThis.fetch,
    openBrowser: defaultOpenBrowser,
    removeRuntime: (root) => rm(root, { force: true, recursive: true }),
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    spawnServer: (command, args, options) => spawn(command, [...args], {
        ...options,
        shell: false,
    }),
    startBridge: startWebChessBridge,
    stageRuntime: stageWebChessRuntime,
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
};
function signalServerTree(server, signal) {
    if (hasServerExited(server))
        return;
    if (process.platform !== 'win32' && server.pid) {
        try {
            process.kill(-server.pid, signal);
            return;
        }
        catch {
            // Fall back to the direct child below.
        }
    }
    server.kill(signal);
}
function hasServerExited(server) {
    return server.exitCode !== null || server.signalCode !== null;
}
async function waitForServer(url, server, fetcher, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (hasServerExited(server)) {
            throw new Error('The local WebChess process exited before it became ready.');
        }
        try {
            const response = await fetcher(url, {
                cache: 'no-store',
                signal: AbortSignal.timeout(Math.min(READINESS_REQUEST_TIMEOUT_MS, Math.max(1, deadline - Date.now()))),
            });
            if (response.ok) {
                const status = await response.json();
                if (status.available === true &&
                    status.database?.available === true &&
                    status.database.majorVersion === 17 &&
                    status.model?.configurationReady === true &&
                    status.lifecycle === 'webchess-2.0') {
                    return;
                }
            }
        }
        catch {
            // The local server is still compiling or starting.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`The local WebChess process did not become ready within ${String(Math.ceil(timeoutMs / 1_000))} seconds.`);
}
function waitForExit(server) {
    if (hasServerExited(server)) {
        return Promise.resolve({
            code: server.exitCode,
            signal: server.signalCode,
        });
    }
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.once('exit', (code, signal) => resolve({ code, signal }));
    });
}
async function waitForExitWithin(server, timeoutMs) {
    if (hasServerExited(server))
        return true;
    return new Promise((resolve) => {
        const finish = (exited) => {
            clearTimeout(timer);
            server.off('error', onError);
            server.off('exit', onExit);
            resolve(exited);
        };
        const onError = () => finish(hasServerExited(server));
        const onExit = () => finish(true);
        const timer = setTimeout(() => finish(false), timeoutMs);
        server.once('error', onError);
        server.once('exit', onExit);
    });
}
export async function terminateServerAndWait(server, timeoutMs = SHUTDOWN_TIMEOUT_MS) {
    if (hasServerExited(server))
        return;
    signalServerTree(server, 'SIGTERM');
    if (await waitForExitWithin(server, timeoutMs))
        return;
    signalServerTree(server, 'SIGKILL');
    if (await waitForExitWithin(server, timeoutMs))
        return;
    throw new Error('The local WebChess process could not be stopped; its temporary working directory was preserved.');
}
export async function launchWebChess(options, dependencies = defaultDependencies, api) {
    if (!api) {
        throw new Error('WebChess must be launched from the OpenClaw plugin runtime.');
    }
    const sourceRoot = resolveWebChessRoot();
    const nextBinary = resolveNextBinary();
    await access(nextBinary);
    const identity = await loadOrCreateRuntimeIdentity(dependencies.environment);
    const runtimeRoot = await dependencies.stageRuntime(sourceRoot, nextBinary);
    let server = null;
    let bridge = null;
    try {
        bridge = await dependencies.startBridge(api, runtimeRoot);
        const spec = buildNextLaunchSpec(runtimeRoot, options, dependencies.environment, nextBinary, identity, bridge);
        const spawnedServer = dependencies.spawnServer(spec.command, spec.args, {
            cwd: spec.cwd,
            detached: spec.detached,
            env: spec.env,
            stdio: 'inherit',
        });
        server = spawnedServer;
        let stopping = false;
        let forceKillTimer = null;
        const stop = () => {
            if (stopping)
                return;
            stopping = true;
            signalServerTree(spawnedServer, 'SIGTERM');
            forceKillTimer = setTimeout(() => {
                signalServerTree(spawnedServer, 'SIGKILL');
            }, dependencies.shutdownTimeoutMs);
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
        try {
            await waitForServer(spec.readinessUrl, spawnedServer, dependencies.fetch, dependencies.startupTimeoutMs);
            console.log(`WebChess is ready at ${spec.url}`);
            console.log('Game history and WebChess 2.0 lifecycle data stay in the dedicated local PostgreSQL database. Model requests use your configured OpenClaw provider, which may be remote.');
            if (options.openBrowser)
                dependencies.openBrowser(spec.url);
            const result = await waitForExit(spawnedServer);
            if (!stopping && result.code !== 0) {
                throw new Error(`The local WebChess process exited with code ${String(result.code)}.`);
            }
        }
        finally {
            process.removeListener('SIGINT', stop);
            process.removeListener('SIGTERM', stop);
            if (forceKillTimer)
                clearTimeout(forceKillTimer);
        }
    }
    finally {
        if (server && !hasServerExited(server)) {
            await terminateServerAndWait(server, dependencies.shutdownTimeoutMs);
        }
        if (bridge)
            await bridge.close();
        await dependencies.removeRuntime(runtimeRoot);
    }
}
