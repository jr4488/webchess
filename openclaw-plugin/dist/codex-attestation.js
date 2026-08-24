import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readFile, readdir, realpath, } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
const PINNED_CODEX_PLUGIN_NAME = '@openclaw/codex';
const PINNED_CODEX_PLUGIN_VERSION = '2026.7.1-1';
const PINNED_CODEX_PLUGIN_INTEGRITY = 'sha512-fRQITjqjC4Q/M6WmkR9XPWPuL+7vcvyVUWIDztB08X2G/mhzSwCYwQp4hugxAtuKmO3yx/7ULMK3nyeKsg5zGw==';
const PINNED_CODEX_PLUGIN_FILE_COUNT = 40;
const PINNED_CODEX_PLUGIN_TREE_SHA256 = 'acab7aeeb630e5ce713d6066a78264d2a905cfd3d036314ce2f9aeb304f5797f';
const PINNED_CODEX_PLUGIN_ENTRY_SHA256 = 'ade01b0285488ab9c9cb2c963c85210cf97720d7188b772ecf9ce423f82c7ca5';
const PINNED_OPENAI_CODEX_VERSION = '0.144.3';
const PINNED_OPENAI_CODEX_INTEGRITY = 'sha512-8Re3wp5CdYiM7nsF4StFa5js6IT11N7srhxfvwtol7ENHDht05C+HS4e1CTmYjqkhgsUzl2R1gB27iN2pdbVnA==';
const PINNED_OPENAI_CODEX_WRAPPER_SHA256 = '134063e133f0b4244fa3b251acf973d4fe4b4aeeacbdc135211bf480f59f1477';
const PINNED_SEARCH_RUNTIME = 'web-search-provider.runtime-BSlriav6.js';
const PINNED_SEARCH_RUNTIME_SHA256 = 'bca538ce49c71b6aaa85595568a7ec07219f1194489d2692c0c99443b2373e76';
const PINNED_SHARED_CLIENT_RUNTIME = 'shared-client-4ICy3U6d.js';
const PINNED_SHARED_CLIENT_RUNTIME_SHA256 = 'bff60f1bb2cb73ad44c7f9c9d779576a2ffd9836b22ecba0bd5b6046e7ce9103';
// The public researcher path is currently tested and supported on Linux x64.
// Other architectures fail closed until their exact native payload digest is
// reviewed and added alongside an end-to-end platform run.
const PLATFORM_EXECUTABLES = {
    'linux-x64': {
        integrity: 'sha512-xtDY5sWQPbYBj2lLWZJvc0jBre0XQ7ZmN4VbSEvazbQ2X7uHhm1D/0oZ7AI+SgC/VfZrUhvxRHd43/AmXSaAzA==',
        packageId: '@openai/codex-linux-x64',
        packageVersion: '0.144.3-linux-x64',
        relativeExecutable: 'vendor/x86_64-unknown-linux-musl/bin/codex',
        sha256: '37e6f5953f191b04f7b62cb07dae90f51d0947ad89f0355665b421fbde28700b',
    },
};
const OPENAI_CODEX_AUTH_CLAIM = 'https://api.openai.com/auth';
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
/**
 * Extract the account selected by the pinned OpenAI account transport using a
 * compatible fail-closed subset of its JWT decoder.
 *
 * The reviewed @openclaw/ai 2026.7.1-2 transport decodes (without locally
 * verifying) this claim from the OAuth access JWT and uses it as the
 * `chatgpt-account-id` request header. OpenAI still authenticates the signed
 * token; this local parser binds WebChess to the same account-routing value
 * before and after each provider boundary.
 */
export function resolveOpenAiCodexAccessTokenAccountId(accessToken) {
    if (typeof accessToken !== 'string')
        return null;
    const token = accessToken.trim();
    const parts = token.split('.');
    if (parts.length !== 3)
        return null;
    try {
        const decoded = Buffer.from(parts[1] ?? '', 'base64url').toString('utf8');
        const payload = JSON.parse(decoded);
        if (!isRecord(payload))
            return null;
        const auth = payload[OPENAI_CODEX_AUTH_CLAIM];
        if (!isRecord(auth))
            return null;
        const accountId = auth.chatgpt_account_id;
        return typeof accountId === 'string' && accountId.length > 0 &&
            accountId === accountId.trim()
            ? accountId
            : null;
    }
    catch {
        return null;
    }
}
async function readJsonRecord(filename) {
    try {
        const value = JSON.parse(await readFile(filename, 'utf8'));
        return isRecord(value) ? value : null;
    }
    catch {
        return null;
    }
}
async function hashAndSealRegularFile(filename, executable = false) {
    let handle;
    try {
        const beforePath = await lstat(filename);
        if (!beforePath.isFile() || beforePath.isSymbolicLink() ||
            beforePath.nlink !== 1) {
            return null;
        }
        handle = await open(filename, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
        const before = await handle.stat();
        if (!before.isFile() || before.nlink !== 1 ||
            before.dev !== beforePath.dev || before.ino !== beforePath.ino ||
            (executable && (before.mode & 0o111) === 0))
            return null;
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        while (true) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
            if (bytesRead === 0)
                break;
            hash.update(buffer.subarray(0, bytesRead));
            position += bytesRead;
        }
        const after = await handle.stat();
        const afterPath = await lstat(filename);
        if (!afterPath.isFile() || afterPath.isSymbolicLink() ||
            afterPath.nlink !== 1 ||
            after.dev !== before.dev || after.ino !== before.ino ||
            after.mode !== before.mode || after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs ||
            afterPath.dev !== before.dev || afterPath.ino !== before.ino ||
            afterPath.mode !== before.mode || afterPath.size !== before.size ||
            afterPath.mtimeMs !== before.mtimeMs ||
            afterPath.ctimeMs !== before.ctimeMs)
            return null;
        return { sha256: hash.digest('hex'), seal: {
                ctimeMs: before.ctimeMs,
                dev: before.dev,
                ino: before.ino,
                mode: before.mode,
                mtimeMs: before.mtimeMs,
                nlink: before.nlink,
                path: filename,
                size: before.size,
            } };
    }
    catch {
        return null;
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
function sealMatches(current, expected) {
    return current.ctimeMs === expected.ctimeMs &&
        current.dev === expected.dev &&
        current.ino === expected.ino &&
        current.mode === expected.mode &&
        current.mtimeMs === expected.mtimeMs &&
        current.nlink === expected.nlink &&
        current.size === expected.size;
}
export async function attestRegularExecutable(filename, expectedSha256) {
    const initial = await hashAndSealRegularFile(filename, true);
    if (!initial || initial.sha256 !== expectedSha256)
        return null;
    return {
        async revalidate() {
            const current = await hashAndSealRegularFile(filename, true);
            return current?.sha256 === expectedSha256 &&
                sealMatches(current.seal, initial.seal);
        },
    };
}
async function listOwnedPackageFiles(root, directory = root) {
    try {
        const files = [];
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (directory === root && entry.name === 'node_modules')
                continue;
            const filename = path.join(directory, entry.name);
            if (entry.isSymbolicLink())
                return null;
            if (entry.isDirectory()) {
                const nested = await listOwnedPackageFiles(root, filename);
                if (!nested)
                    return null;
                files.push(...nested);
                continue;
            }
            if (!entry.isFile())
                return null;
            const metadata = await lstat(filename);
            if (!metadata.isFile() || metadata.nlink !== 1)
                return null;
            files.push(path.relative(root, filename).split(path.sep).join('/'));
        }
        return files;
    }
    catch {
        return null;
    }
}
export async function digestOwnedPackageTree(root) {
    const files = await listOwnedPackageFiles(root);
    if (!files)
        return null;
    files.sort();
    const tree = createHash('sha256');
    try {
        for (const relative of files) {
            const contents = await readFile(path.join(root, relative));
            tree.update(relative, 'utf8');
            tree.update(Buffer.from([0]));
            tree.update(createHash('sha256').update(contents).digest('hex'), 'ascii');
            tree.update('\n', 'ascii');
        }
    }
    catch {
        return null;
    }
    return { fileCount: files.length, sha256: tree.digest('hex') };
}
function packageEntry(lock, packagePath) {
    const packages = lock.packages;
    if (!isRecord(packages))
        return null;
    const entry = packages[packagePath];
    return isRecord(entry) ? entry : null;
}
function hasPinnedLockEntry(lock, packagePath, version, integrity, name) {
    const entry = packageEntry(lock, packagePath);
    return Boolean(entry) &&
        entry.version === version &&
        entry.integrity === integrity &&
        (name === undefined || entry.name === name);
}
function exactPackageJson(value, name, version) {
    return Boolean(value) && value.name === name && value.version === version;
}
function pathIsInside(parent, child) {
    const relative = path.relative(parent, child);
    return relative.length > 0 &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative);
}
async function resolvePinnedPackagePath(requireFromPlugin, packageId) {
    try {
        return await realpath(requireFromPlugin.resolve(`${packageId}/package.json`));
    }
    catch {
        return null;
    }
}
export function isOfficialCodexPluginRecord(record) {
    return record.id === 'codex' &&
        record.enabled === true &&
        record.status === 'loaded' &&
        record.origin === 'global' &&
        record.packageName === PINNED_CODEX_PLUGIN_NAME &&
        record.version === PINNED_CODEX_PLUGIN_VERSION &&
        record.trustedOfficialInstall === true &&
        Array.isArray(record.webSearchProviderIds) &&
        record.webSearchProviderIds.length === 1 &&
        record.webSearchProviderIds[0] === 'codex';
}
function isSingletonOAuthStore(store, profileId) {
    const profiles = store.profiles;
    if (!isRecord(profiles) || Object.keys(profiles).length !== 1)
        return false;
    const credential = profiles[profileId];
    if (!isRecord(credential) || credential.type !== 'oauth' ||
        credential.provider !== 'openai')
        return false;
    const order = store.order;
    if (!isRecord(order))
        return false;
    const openAiOrder = order.openai;
    return Array.isArray(openAiOrder) && openAiOrder.length === 1 &&
        openAiOrder[0] === profileId;
}
export function snapshotOAuthCredentialIdentity(store, profileId) {
    if (!isSingletonOAuthStore(store, profileId))
        return null;
    const profiles = store.profiles;
    const credential = profiles[profileId];
    const tokenAccountId = resolveOpenAiCodexAccessTokenAccountId(credential.access);
    if (!tokenAccountId)
        return null;
    const storedAccountId = credential.accountId;
    if (typeof storedAccountId !== 'string' || !storedAccountId ||
        storedAccountId !== storedAccountId.trim() ||
        storedAccountId !== tokenAccountId)
        return null;
    const mutableTokenFields = new Set([
        'access',
        'accessToken',
        'expires',
        'expiresAt',
        'expiry',
        'refresh',
        'refreshToken',
    ]);
    try {
        return structuredClone({
            ...Object.fromEntries(Object.entries(credential).filter(([key]) => !mutableTokenFields.has(key))),
            accountId: tokenAccountId,
        });
    }
    catch {
        return null;
    }
}
/**
 * Own a singleton OAuth store whose credential may be replaced only by a
 * same-account token rotation. Credentials are frozen so refresh code must use
 * the reviewed whole-record assignment path, which the profiles proxy checks
 * synchronously before the new access token becomes observable.
 */
export function guardOAuthProfileStoreAccountBinding(sourceStore, profileId, expectedIdentity) {
    if (!isDeepStrictEqual(snapshotOAuthCredentialIdentity(sourceStore, profileId), expectedIdentity))
        return null;
    try {
        const sourceProfiles = sourceStore.profiles;
        const initialCredential = sourceProfiles[profileId];
        if (!isRecord(initialCredential))
            return null;
        const baseStore = structuredClone(sourceStore);
        const frozenCredential = Object.freeze(structuredClone(initialCredential));
        const profileTarget = { [profileId]: frozenCredential };
        let bindingViolation = false;
        const rejectMutation = () => {
            bindingViolation = true;
            throw new Error('Official Codex OAuth binding changed in flight.');
        };
        const profiles = new Proxy(profileTarget, {
            defineProperty: rejectMutation,
            deleteProperty: rejectMutation,
            set(target, property, value) {
                if (property !== profileId || !isRecord(value))
                    rejectMutation();
                const candidateStore = {
                    ...baseStore,
                    profiles: { [profileId]: value },
                };
                if (!isDeepStrictEqual(snapshotOAuthCredentialIdentity(candidateStore, profileId), expectedIdentity))
                    rejectMutation();
                let nextCredential;
                try {
                    nextCredential = Object.freeze(structuredClone(value));
                }
                catch {
                    return rejectMutation();
                }
                return Reflect.set(target, property, nextCredential, target);
            },
            setPrototypeOf: rejectMutation,
        });
        const guardedStore = Object.freeze({
            ...baseStore,
            profiles,
        });
        return {
            isIntact: () => !bindingViolation && isDeepStrictEqual(snapshotOAuthCredentialIdentity(guardedStore, profileId), expectedIdentity),
            store: guardedStore,
        };
    }
    catch {
        return null;
    }
}
function codexPluginConfig(config) {
    const plugins = config.plugins;
    if (!isRecord(plugins) || !isRecord(plugins.entries) ||
        !isRecord(plugins.entries.codex))
        return null;
    const pluginConfig = plugins.entries.codex.config;
    return isRecord(pluginConfig) ? pluginConfig : null;
}
function expectedPrivateStartClearEnv(config) {
    const pluginConfig = codexPluginConfig(config);
    if (!pluginConfig || !isRecord(pluginConfig.appServer) ||
        !Array.isArray(pluginConfig.appServer.clearEnv) ||
        !pluginConfig.appServer.clearEnv.every((name) => typeof name === 'string' && name.trim() === name && Boolean(name))) {
        return null;
    }
    return [
        ...pluginConfig.appServer.clearEnv,
        'OPENCLAW_CODEX_APP_SERVER_ARGS',
    ];
}
/**
 * Attest the exact installed Codex search plugin and the native executable it
 * will resolve. This is intentionally local/offline: npm integrity strings are
 * pinned here and checked against both lock layers, while extracted source and
 * executable bytes are checked against reviewed SHA-256 values.
 */
export async function attestOfficialCodexPackage(record, platform = process.platform, architecture = process.arch) {
    if (!isOfficialCodexPluginRecord(record) || !record.rootDir)
        return null;
    const platformExpectation = PLATFORM_EXECUTABLES[`${platform}-${architecture}`];
    if (!platformExpectation)
        return null;
    try {
        const pluginRoot = await realpath(record.rootDir);
        if (path.resolve(record.rootDir) !== pluginRoot)
            return null;
        const expectedEntry = path.join(pluginRoot, 'dist', 'index.js');
        const pluginEntry = await realpath(record.source);
        if (pluginEntry !== expectedEntry ||
            !pathIsInside(pluginRoot, pluginEntry))
            return null;
        const pluginPackageJsonPath = path.join(pluginRoot, 'package.json');
        const shrinkwrapPath = path.join(pluginRoot, 'npm-shrinkwrap.json');
        const [pluginPackageJson, shrinkwrap, tree, entryFile] = await Promise.all([
            readJsonRecord(pluginPackageJsonPath),
            readJsonRecord(shrinkwrapPath),
            digestOwnedPackageTree(pluginRoot),
            hashAndSealRegularFile(pluginEntry),
        ]);
        if (!exactPackageJson(pluginPackageJson, PINNED_CODEX_PLUGIN_NAME, PINNED_CODEX_PLUGIN_VERSION) || !shrinkwrap ||
            shrinkwrap.name !== PINNED_CODEX_PLUGIN_NAME ||
            shrinkwrap.version !== PINNED_CODEX_PLUGIN_VERSION ||
            tree?.fileCount !== PINNED_CODEX_PLUGIN_FILE_COUNT ||
            tree.sha256 !== PINNED_CODEX_PLUGIN_TREE_SHA256 ||
            entryFile?.sha256 !== PINNED_CODEX_PLUGIN_ENTRY_SHA256)
            return null;
        const projectRoot = path.resolve(pluginRoot, '..', '..', '..');
        const projectLock = await readJsonRecord(path.join(projectRoot, 'package-lock.json'));
        if (!projectLock || !hasPinnedLockEntry(projectLock, 'node_modules/@openclaw/codex', PINNED_CODEX_PLUGIN_VERSION, PINNED_CODEX_PLUGIN_INTEGRITY))
            return null;
        if (!hasPinnedLockEntry(shrinkwrap, 'node_modules/@openai/codex', PINNED_OPENAI_CODEX_VERSION, PINNED_OPENAI_CODEX_INTEGRITY) || !hasPinnedLockEntry(shrinkwrap, `node_modules/${platformExpectation.packageId}`, platformExpectation.packageVersion, platformExpectation.integrity, '@openai/codex'))
            return null;
        const requireFromPlugin = createRequire(pluginPackageJsonPath);
        const wrapperPackageJsonPath = await resolvePinnedPackagePath(requireFromPlugin, '@openai/codex');
        const platformPackageJsonPath = await resolvePinnedPackagePath(requireFromPlugin, platformExpectation.packageId);
        if (!wrapperPackageJsonPath || !platformPackageJsonPath ||
            !pathIsInside(pluginRoot, wrapperPackageJsonPath) ||
            !pathIsInside(pluginRoot, platformPackageJsonPath))
            return null;
        const wrapperRoot = path.dirname(wrapperPackageJsonPath);
        const platformRoot = path.dirname(platformPackageJsonPath);
        const wrapperPath = path.join(wrapperRoot, 'bin', 'codex.js');
        const searchRuntimePath = path.join(pluginRoot, 'dist', PINNED_SEARCH_RUNTIME);
        const sharedClientRuntimePath = path.join(pluginRoot, 'dist', PINNED_SHARED_CLIENT_RUNTIME);
        const nestedBinPath = path.join(pluginRoot, 'node_modules', '.bin', 'codex');
        const executablePath = path.join(platformRoot, platformExpectation.relativeExecutable);
        const [resolvedWrapper, resolvedNestedBin, resolvedExecutable] = await Promise.all([
            realpath(wrapperPath),
            realpath(nestedBinPath),
            realpath(executablePath),
        ]);
        if (resolvedWrapper !== wrapperPath ||
            resolvedNestedBin !== wrapperPath ||
            resolvedExecutable !== executablePath)
            return null;
        const [wrapperPackageJson, platformPackageJson, wrapperFile, executableFile, searchRuntimeFile, sharedClientRuntimeFile] = await Promise.all([
            readJsonRecord(wrapperPackageJsonPath),
            readJsonRecord(platformPackageJsonPath),
            hashAndSealRegularFile(wrapperPath, true),
            hashAndSealRegularFile(executablePath, true),
            hashAndSealRegularFile(searchRuntimePath),
            hashAndSealRegularFile(sharedClientRuntimePath),
        ]);
        if (!exactPackageJson(wrapperPackageJson, '@openai/codex', PINNED_OPENAI_CODEX_VERSION) || !exactPackageJson(platformPackageJson, '@openai/codex', platformExpectation.packageVersion) || wrapperFile?.sha256 !== PINNED_OPENAI_CODEX_WRAPPER_SHA256 ||
            executableFile?.sha256 !== platformExpectation.sha256 ||
            searchRuntimeFile?.sha256 !== PINNED_SEARCH_RUNTIME_SHA256 ||
            sharedClientRuntimeFile?.sha256 !== PINNED_SHARED_CLIENT_RUNTIME_SHA256 ||
            !entryFile || !wrapperFile || !executableFile || !searchRuntimeFile ||
            !sharedClientRuntimeFile)
            return null;
        const revalidate = async () => {
            try {
                const [currentTree, currentEntry, currentWrapper, currentExecutable, currentSearchRuntime, currentSharedClientRuntime, currentWrapperPackage, currentPlatformPackage, currentProjectLock, currentPluginRoot, currentPluginEntry, currentNestedBin, currentExecutablePath, currentSearchRuntimePath, currentSharedClientRuntimePath] = await Promise.all([
                    digestOwnedPackageTree(pluginRoot),
                    hashAndSealRegularFile(pluginEntry),
                    hashAndSealRegularFile(wrapperPath, true),
                    hashAndSealRegularFile(executablePath, true),
                    hashAndSealRegularFile(searchRuntimePath),
                    hashAndSealRegularFile(sharedClientRuntimePath),
                    readJsonRecord(wrapperPackageJsonPath),
                    readJsonRecord(platformPackageJsonPath),
                    readJsonRecord(path.join(projectRoot, 'package-lock.json')),
                    realpath(record.rootDir ?? ''),
                    realpath(record.source),
                    realpath(nestedBinPath),
                    realpath(executablePath),
                    realpath(searchRuntimePath),
                    realpath(sharedClientRuntimePath),
                ]);
                return currentTree?.fileCount === PINNED_CODEX_PLUGIN_FILE_COUNT &&
                    currentTree.sha256 === PINNED_CODEX_PLUGIN_TREE_SHA256 &&
                    currentEntry?.sha256 === PINNED_CODEX_PLUGIN_ENTRY_SHA256 &&
                    currentWrapper?.sha256 === PINNED_OPENAI_CODEX_WRAPPER_SHA256 &&
                    currentExecutable?.sha256 === platformExpectation.sha256 &&
                    currentSearchRuntime?.sha256 === PINNED_SEARCH_RUNTIME_SHA256 &&
                    currentSharedClientRuntime?.sha256 ===
                        PINNED_SHARED_CLIENT_RUNTIME_SHA256 &&
                    sealMatches(currentEntry.seal, entryFile.seal) &&
                    sealMatches(currentWrapper.seal, wrapperFile.seal) &&
                    sealMatches(currentExecutable.seal, executableFile.seal) &&
                    sealMatches(currentSearchRuntime.seal, searchRuntimeFile.seal) &&
                    sealMatches(currentSharedClientRuntime.seal, sharedClientRuntimeFile.seal) &&
                    currentPluginRoot === pluginRoot &&
                    currentPluginEntry === pluginEntry &&
                    currentNestedBin === wrapperPath &&
                    currentExecutablePath === executablePath &&
                    currentSearchRuntimePath === searchRuntimePath &&
                    currentSharedClientRuntimePath === sharedClientRuntimePath &&
                    currentProjectLock !== null && hasPinnedLockEntry(currentProjectLock, 'node_modules/@openclaw/codex', PINNED_CODEX_PLUGIN_VERSION, PINNED_CODEX_PLUGIN_INTEGRITY) &&
                    exactPackageJson(currentWrapperPackage, '@openai/codex', PINNED_OPENAI_CODEX_VERSION) && exactPackageJson(currentPlatformPackage, '@openai/codex', platformExpectation.packageVersion);
            }
            catch {
                return false;
            }
        };
        return {
            async executeSearch(params) {
                if (!await revalidate() ||
                    !isSingletonOAuthStore(params.authProfileStore, params.authProfileId)) {
                    throw new Error('Official Codex search attestation failed.');
                }
                const initialOAuthIdentity = snapshotOAuthCredentialIdentity(params.authProfileStore, params.authProfileId);
                if (!initialOAuthIdentity) {
                    throw new Error('Official Codex OAuth identity is unavailable.');
                }
                const guardedOAuthStore = guardOAuthProfileStoreAccountBinding(params.authProfileStore, params.authProfileId, initialOAuthIdentity);
                if (!guardedOAuthStore) {
                    throw new Error('Official Codex OAuth binding is unavailable.');
                }
                const clearEnv = expectedPrivateStartClearEnv(params.config);
                const pluginConfig = codexPluginConfig(params.config);
                if (!clearEnv || !pluginConfig) {
                    throw new Error('Official Codex search isolation failed.');
                }
                const searchRuntime = await import(pathToFileURL(searchRuntimePath).href);
                const sharedClientRuntime = await import(pathToFileURL(sharedClientRuntimePath).href);
                // ESM does not expose the bytes backing a module namespace. Re-hash the
                // exact package and both imported runtime paths after module loading,
                // before any OAuth store is passed to imported code. No await occurs
                // between this check and capturing/calling the reviewed exports.
                if (!await revalidate()) {
                    throw new Error('Official Codex runtime changed while loading.');
                }
                const execute = searchRuntime.executeCodexWebSearchProviderTool;
                const createClient = sharedClientRuntime.i;
                if (typeof execute !== 'function' || typeof createClient !== 'function') {
                    throw new Error('Official Codex search runtime is unavailable.');
                }
                const ownedClient = {
                    current: null,
                };
                const closeOwnedClient = () => {
                    try {
                        ownedClient.current?.close();
                    }
                    catch {
                        // The bounded worker owns process-group teardown. Never expose
                        // close diagnostics or replace the primary failure.
                    }
                };
                params.signal.addEventListener('abort', closeOwnedClient);
                const noFailure = Symbol('no-official-codex-search-failure');
                let executionFailure = noFailure;
                let result;
                try {
                    result = await execute({
                        agentDir: params.agentDir,
                        config: params.config,
                        searchConfig: params.searchConfig,
                    }, { query: params.query }, { signal: params.signal }, {
                        pluginConfig,
                        clientFactory: async (rawOptions) => {
                            if (!isRecord(rawOptions) ||
                                (rawOptions.authProfileId !== undefined &&
                                    rawOptions.authProfileId !== params.authProfileId) ||
                                !isRecord(rawOptions.startOptions)) {
                                throw new Error('Official Codex auth binding failed.');
                            }
                            const startOptions = rawOptions.startOptions;
                            if (startOptions.transport !== 'stdio' ||
                                !Array.isArray(startOptions.args) ||
                                !isDeepStrictEqual(startOptions.args, [
                                    'app-server',
                                    '--listen',
                                    'stdio://',
                                ]) ||
                                !Array.isArray(startOptions.clearEnv) ||
                                !isDeepStrictEqual(startOptions.clearEnv, clearEnv) ||
                                !isRecord(startOptions.env) ||
                                Object.keys(startOptions.env).some((name) => name !== 'CODEX_HOME')) {
                                throw new Error('Official Codex process isolation failed.');
                            }
                            let rejectStartupAbort = () => undefined;
                            const startupAbort = new Promise((_resolve, reject) => {
                                rejectStartupAbort = reject;
                            });
                            const abortStartup = () => {
                                rejectStartupAbort(new Error('Official Codex client startup aborted.'));
                            };
                            if (params.signal.aborted)
                                abortStartup();
                            else
                                params.signal.addEventListener('abort', abortStartup, {
                                    once: true,
                                });
                            const clientStartup = Promise.resolve().then(async () => {
                                if (params.signal.aborted) {
                                    throw new Error('Official Codex client startup aborted.');
                                }
                                return await createClient({
                                    ...rawOptions,
                                    agentDir: params.agentDir,
                                    authProfileId: params.authProfileId,
                                    authProfileStore: guardedOAuthStore.store,
                                    config: params.config,
                                    onStartedClient: (startedClient) => {
                                        if (isRecord(startedClient) &&
                                            typeof startedClient.close === 'function') {
                                            ownedClient.current = startedClient;
                                            if (params.signal.aborted)
                                                closeOwnedClient();
                                        }
                                    },
                                    startOptions: {
                                        ...startOptions,
                                        command: executablePath,
                                        commandSource: 'resolved-managed',
                                        managedFallbackCommandPaths: [],
                                    },
                                });
                            });
                            let client;
                            try {
                                client = await Promise.race([clientStartup, startupAbort]);
                            }
                            finally {
                                params.signal.removeEventListener('abort', abortStartup);
                            }
                            if (!isRecord(client) || typeof client.close !== 'function') {
                                throw new Error('Official Codex client startup failed.');
                            }
                            ownedClient.current = client;
                            if (!guardedOAuthStore.isIntact()) {
                                closeOwnedClient();
                                throw new Error('Official Codex OAuth binding changed during client startup.');
                            }
                            return client;
                        },
                    });
                }
                catch (error) {
                    executionFailure = error;
                }
                finally {
                    params.signal.removeEventListener('abort', closeOwnedClient);
                    closeOwnedClient();
                }
                if (!guardedOAuthStore.isIntact()) {
                    throw new Error('Official Codex OAuth binding changed in flight.');
                }
                if (executionFailure !== noFailure)
                    throw executionFailure;
                return result;
            },
            revalidate,
        };
    }
    catch {
        return null;
    }
}
