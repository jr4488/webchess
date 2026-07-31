import { spawn } from 'node:child_process';
import { access, cp, mkdtemp, rm, symlink, } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DEFAULT_PORT = 3210;
const STARTUP_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const RUNTIME_ENTRIES = [
    'CODE_OF_CONDUCT.md',
    'CONTRIBUTING.md',
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
export function buildNextLaunchSpec(root, options, environment = process.env, nextBinary = resolveNextBinary()) {
    const url = `http://127.0.0.1:${options.port}/openclaw`;
    const origin = `http://127.0.0.1:${options.port}`;
    const localEnvironment = { ...environment };
    for (const name of [
        'VERCEL',
        'VERCEL_ENV',
        'VERCEL_TARGET_ENV',
        'VERCEL_URL',
    ]) {
        delete localEnvironment[name];
    }
    Object.assign(localEnvironment, {
        CLERK_SECRET_KEY: '',
        DATABASE_URL: '',
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
        NEXT_PUBLIC_SITE_URL: origin,
        NODE_ENV: 'development',
        OPENAI_API_KEY: environment.OPENAI_API_KEY ?? '',
        WEBCHESS_OPENCLAW_ENABLED: 'true',
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
    fetch: globalThis.fetch,
    openBrowser: defaultOpenBrowser,
    removeRuntime: (root) => rm(root, { force: true, recursive: true }),
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    spawnServer: (command, args, options) => spawn(command, [...args], {
        ...options,
        shell: false,
    }),
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
                signal: AbortSignal.timeout(1_000),
            });
            if (response.ok)
                return;
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
export async function launchWebChess(options, dependencies = defaultDependencies) {
    const sourceRoot = resolveWebChessRoot();
    const nextBinary = resolveNextBinary();
    await access(nextBinary);
    const runtimeRoot = await dependencies.stageRuntime(sourceRoot, nextBinary);
    let server = null;
    try {
        const spec = buildNextLaunchSpec(runtimeRoot, options, process.env, nextBinary);
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
            await waitForServer(spec.url, spawnedServer, dependencies.fetch, dependencies.startupTimeoutMs);
            console.log(`WebChess is ready at ${spec.url}`);
            console.log('Game history stays in this browser. Model requests use your configured OpenClaw provider, which may be remote.');
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
        await dependencies.removeRuntime(runtimeRoot);
    }
}
