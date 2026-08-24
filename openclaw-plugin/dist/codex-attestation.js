import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readFile, readlink, readdir, realpath, } from 'node:fs/promises';
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
const PINNED_CODEX_COMPLETE_TREE_FILE_COUNT = 2_155;
const PINNED_CODEX_COMPLETE_TREE_SYMLINK_COUNT = 2;
const PINNED_CODEX_COMPLETE_TREE_SHA256 = '3308c95e1ee222be84c077164236114bd910e62bf6d602afb7b8d6609a5aab05';
const PINNED_OPENAI_CODEX_VERSION = '0.144.3';
const PINNED_OPENAI_CODEX_INTEGRITY = 'sha512-8Re3wp5CdYiM7nsF4StFa5js6IT11N7srhxfvwtol7ENHDht05C+HS4e1CTmYjqkhgsUzl2R1gB27iN2pdbVnA==';
const PINNED_OPENAI_CODEX_WRAPPER_SHA256 = '134063e133f0b4244fa3b251acf973d4fe4b4aeeacbdc135211bf480f59f1477';
const PINNED_SEARCH_RUNTIME = 'web-search-provider.runtime-BSlriav6.js';
const PINNED_SEARCH_RUNTIME_SHA256 = 'bca538ce49c71b6aaa85595568a7ec07219f1194489d2692c0c99443b2373e76';
const PINNED_SHARED_CLIENT_RUNTIME = 'shared-client-4ICy3U6d.js';
const PINNED_SHARED_CLIENT_RUNTIME_SHA256 = 'bff60f1bb2cb73ad44c7f9c9d779576a2ffd9836b22ecba0bd5b6046e7ce9103';
const PINNED_OPENCLAW_VERSION = '2026.7.1-2';
const PINNED_OPENCLAW_CLI_SHA256 = 'f643b005d6db233a0b45204e8d8e943256874ccc6897b8a6e0cf42a9b376a188';
const PINNED_OPENCLAW_ENTRY_SHA256 = '88418e5ae14225ab43aed3991218f1834064fae5068a11d8a8aa0efd893ea42c';
const PINNED_OPENCLAW_PACKAGE_FILE_COUNT = 31_938;
const PINNED_OPENCLAW_PACKAGE_SYMLINK_COUNT = 17;
const PINNED_OPENCLAW_PACKAGE_TREE_SHA256 = '2a88ee5fc27a5957865b87992eaf7a9305ab67bcaf5c5ba7aeede3bb8835f1ae';
const PINNED_OPENCLAW_SENTINEL_RUNTIME = 'sentinel-zNFsFsCB.js';
const PINNED_OPENCLAW_SENTINEL_IMPORT_CLOSURE = Object.freeze({
    'ansi-D1GK_odF.js': '8a1b7fa9ab24413102440a9e22cee2f0da808fbbd32849af3e23e1f7e16d8494',
    'argv-APLDYHWW.js': 'e12b19cbdf8cb54af168470f8916ab00917ef833e0d09e23b38e7558df81fd15',
    'home-dir-CJKEsOtx.js': '656ea8c4e0c8142be3902dde41b5b247c70d34f9460a7e5406b48ef30b4c59cf',
    'number-coercion-CJQ8TR--.js': 'd58226dd163a693e2adecb7db42c196987b3591c2959bdbb4fe3ed852dd01ce8',
    'openclaw-root-_Kkan8Lf.js': 'b38ffc9ed9d1de4b79213bf9aab474985ae62127ba5f148b14433d8cbb51b7b9',
    'parse-finite-number-Z7n6tXLk.js': 'b6a1f2b882930dd2efd69d048981e76107bacb97ce8f0a9cd24e0dcbf7411af7',
    'paths-BMBAvkNf.js': '099ff305aa7662710b2b0f1f925c99b203f30d283ab6b2ada34233a8188fab77',
    'record-coerce-DHZ4bFlT.js': '527fd444d23026ace9ad3c9ed664ad366e82c2ba41020a3cd2f2116a0100e89f',
    'redact-B9QQ4Wyz.js': 'd31364326b71b82ad6e20ccc93203591eb7848ff2b165e333437b32ae8f0b5b3',
    [PINNED_OPENCLAW_SENTINEL_RUNTIME]: 'a5e0c163a42ea5ce921941dc7dd0735a2a810bcd05c439eaaa561c2f667219bb',
    'string-coerce-DW4mBlAt.js': '41b0b673667f6e8f1a4b0674b4b940144e9f84ef9d20b1afc8196c11cbe2c320',
    'tcp-port-DPgvEEt3.js': 'dc593e43663553b72eaed8f7c95de33e754882fa6baf11c06b9d0727980e5297',
});
const PINNED_OPENCLAW_SENTINEL_JSON5_VERSION = '2.2.3';
const PINNED_OPENCLAW_SENTINEL_JSON5_FILE_COUNT = 20;
const PINNED_OPENCLAW_SENTINEL_JSON5_TREE_SHA256 = '9510bc00ee8ff303fcb2d772a029b2b1335830aba579932989264be280fb202f';
const OPENCLAW_SECRET_SENTINEL_PATTERN = /^oc-sent-v1-[0-9a-f]{24}$/u;
const CODEX_PLUGIN_SHASUM = '49c96d1e714d71b0032cca38ea60677a77e6e604';
const PLUGIN_INSPECT_STDOUT_LIMIT = 128 * 1024;
const PLUGIN_INSPECT_STDERR_LIMIT = 16 * 1024;
const PLUGIN_INSPECT_TIMEOUT_MS = 30_000;
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
const OPENAI_OAUTH_SUBJECT_HASH_DOMAIN = 'webchess-openai-oauth-subject-v1\0';
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
    return resolveOpenAiCodexAccessTokenIdentity(accessToken)?.accountId ?? null;
}
function trimmedNonEmptyString(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
/**
 * Match the stable-subject precedence reviewed in pinned OpenClaw 2026.7.1-2:
 * account-scoped user id, ChatGPT user id, legacy user id, then issuer+subject.
 * Only a domain-separated digest is retained in WebChess identity snapshots.
 */
export function resolveOpenAiCodexAccessTokenIdentity(accessToken) {
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
        if (typeof accountId !== 'string' || accountId.length === 0 ||
            accountId !== accountId.trim())
            return null;
        const stableSubject = trimmedNonEmptyString(auth.chatgpt_account_user_id) ?? trimmedNonEmptyString(auth.chatgpt_user_id) ??
            trimmedNonEmptyString(auth.user_id) ?? (() => {
            const issuer = trimmedNonEmptyString(payload.iss);
            const subject = trimmedNonEmptyString(payload.sub);
            return issuer && subject ? `${issuer}|${subject}` : subject;
        })();
        if (!stableSubject)
            return null;
        return {
            accountId,
            subjectSha256: createHash('sha256').update(OPENAI_OAUTH_SUBJECT_HASH_DOMAIN, 'utf8').update(stableSubject, 'utf8').digest('hex'),
        };
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
function containsOwnConfigInclude(value) {
    const pending = [value];
    while (pending.length > 0) {
        const current = pending.pop();
        if (Array.isArray(current)) {
            for (const nested of current)
                pending.push(nested);
            continue;
        }
        if (!isRecord(current))
            continue;
        if (Object.prototype.hasOwnProperty.call(current, '$include'))
            return true;
        for (const nested of Object.values(current))
            pending.push(nested);
    }
    return false;
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
export async function attestRegularFile(filename, expectedSha256, executable = false) {
    const initial = await hashAndSealRegularFile(filename, executable);
    if (!initial || initial.sha256 !== expectedSha256)
        return null;
    return {
        async revalidate() {
            const current = await hashAndSealRegularFile(filename, executable);
            return current?.sha256 === expectedSha256 &&
                sealMatches(current.seal, initial.seal);
        },
    };
}
export async function attestRegularExecutable(filename, expectedSha256) {
    return await attestRegularFile(filename, expectedSha256, true);
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
async function collectCompletePackageTreeEntries(root, directory, entries, allowedExternalSymlinks, externalSymlinksSeen) {
    try {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const filename = path.join(directory, entry.name);
            const relative = path.relative(root, filename).split(path.sep).join('/');
            const metadata = await lstat(filename);
            if (entry.isDirectory() && metadata.isDirectory()) {
                if (!await collectCompletePackageTreeEntries(root, filename, entries, allowedExternalSymlinks, externalSymlinksSeen))
                    return false;
                continue;
            }
            if (entry.isFile() && metadata.isFile()) {
                if (metadata.nlink !== 1)
                    return false;
                entries.push({
                    kind: 'file',
                    path: relative,
                    value: createHash('sha256')
                        .update(await readFile(filename))
                        .digest('hex'),
                });
                continue;
            }
            if (entry.isSymbolicLink() && metadata.isSymbolicLink()) {
                const target = await readlink(filename);
                if (!target)
                    return false;
                const resolvedTarget = await realpath(filename);
                const targetMetadata = await lstat(resolvedTarget);
                if (pathIsInside(root, resolvedTarget)) {
                    if (path.isAbsolute(target) || !targetMetadata.isFile())
                        return false;
                    entries.push({ kind: 'symlink', path: relative, value: target });
                    continue;
                }
                const allowed = allowedExternalSymlinks[relative];
                if (!allowed || !path.isAbsolute(target) ||
                    target !== allowed.target ||
                    resolvedTarget !== allowed.target ||
                    !targetMetadata.isDirectory() ||
                    externalSymlinksSeen.has(relative))
                    return false;
                externalSymlinksSeen.add(relative);
                entries.push({
                    kind: 'symlink',
                    path: relative,
                    value: `external:${allowed.identity}`,
                });
                continue;
            }
            return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
/** Digest every owned file and safe in-tree symlink, including node_modules. */
export async function digestCompletePackageTree(root, options = {}) {
    try {
        const canonicalRoot = await realpath(root);
        const rootMetadata = await lstat(root);
        if (canonicalRoot !== path.resolve(root) ||
            !rootMetadata.isDirectory() || rootMetadata.isSymbolicLink())
            return null;
        const entries = [];
        const allowedExternalSymlinks = options.allowedExternalSymlinks ?? {};
        const normalizedAllowedExternalSymlinks = {};
        for (const [relative, allowed] of Object.entries(allowedExternalSymlinks)) {
            if (!relative || relative.startsWith('/') || relative.includes('\\') ||
                relative.split('/').some((segment) => !segment || segment === '.' ||
                    segment === '..') || !allowed.identity ||
                allowed.identity.trim() !== allowed.identity ||
                !path.isAbsolute(allowed.target))
                return null;
            const target = await realpath(allowed.target);
            if (target !== allowed.target)
                return null;
            normalizedAllowedExternalSymlinks[relative] = { ...allowed, target };
        }
        const externalSymlinksSeen = new Set();
        if (!await collectCompletePackageTreeEntries(root, root, entries, normalizedAllowedExternalSymlinks, externalSymlinksSeen) || externalSymlinksSeen.size !==
            Object.keys(normalizedAllowedExternalSymlinks).length) {
            return null;
        }
        entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
        const tree = createHash('sha256');
        for (const entry of entries) {
            tree.update(JSON.stringify([entry.kind, entry.path, entry.value]), 'utf8');
            tree.update('\n', 'ascii');
        }
        return {
            fileCount: entries.filter((entry) => entry.kind === 'file').length,
            sha256: tree.digest('hex'),
            symlinkCount: entries.filter((entry) => entry.kind === 'symlink').length,
        };
    }
    catch {
        return null;
    }
}
export async function attestCompletePackageTree(root, expected, options = {}) {
    const initial = await digestCompletePackageTree(root, options);
    if (!isDeepStrictEqual(initial, expected))
        return null;
    return {
        async revalidate() {
            return isDeepStrictEqual(await digestCompletePackageTree(root, options), expected);
        },
    };
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
export function createPreparedAuthAccountInspector(resolvePreparedAuthSentinel, revalidate) {
    return {
        async resolveIdentity(preparedAuthValue) {
            if (typeof preparedAuthValue !== 'string' ||
                !await revalidate())
                return null;
            let accessToken = preparedAuthValue;
            try {
                if (OPENCLAW_SECRET_SENTINEL_PATTERN.test(preparedAuthValue)) {
                    accessToken = resolvePreparedAuthSentinel(preparedAuthValue) ?? '';
                }
            }
            catch {
                return null;
            }
            const identity = resolveOpenAiCodexAccessTokenIdentity(accessToken);
            return identity && await revalidate() ? identity : null;
        },
    };
}
export async function attestPinnedOpenClawPreparedAuthAccountInspector() {
    try {
        const requireFromPlugin = createRequire(import.meta.url);
        const entryPath = await realpath(requireFromPlugin.resolve('openclaw'));
        const packageRoot = path.dirname(path.dirname(entryPath));
        const packageJsonPath = await realpath(path.join(packageRoot, 'package.json'));
        if (!pathIsInside(packageRoot, entryPath))
            return null;
        const packageJson = await readJsonRecord(packageJsonPath);
        if (!exactPackageJson(packageJson, 'openclaw', PINNED_OPENCLAW_VERSION))
            return null;
        const runtimeAttestations = await Promise.all(Object.entries(PINNED_OPENCLAW_SENTINEL_IMPORT_CLOSURE).map(async ([filename, sha256]) => {
            const expectedPath = path.join(packageRoot, 'dist', filename);
            const runtimePath = await realpath(expectedPath);
            if (runtimePath !== expectedPath ||
                !pathIsInside(packageRoot, runtimePath))
                return null;
            return await attestRegularFile(runtimePath, sha256);
        }));
        if (runtimeAttestations.some((attestation) => !attestation))
            return null;
        const sentinelPath = path.join(packageRoot, 'dist', PINNED_OPENCLAW_SENTINEL_RUNTIME);
        const requireFromSentinel = createRequire(sentinelPath);
        const json5PackageJsonPath = await realpath(requireFromSentinel.resolve('json5/package.json'));
        const json5Root = path.dirname(json5PackageJsonPath);
        if (!pathIsInside(packageRoot, json5Root) ||
            !exactPackageJson(await readJsonRecord(json5PackageJsonPath), 'json5', PINNED_OPENCLAW_SENTINEL_JSON5_VERSION))
            return null;
        const json5Tree = await digestOwnedPackageTree(json5Root);
        if (json5Tree?.fileCount !==
            PINNED_OPENCLAW_SENTINEL_JSON5_FILE_COUNT ||
            json5Tree.sha256 !== PINNED_OPENCLAW_SENTINEL_JSON5_TREE_SHA256) {
            return null;
        }
        const revalidateImportClosure = async () => {
            const [filesIntact, currentJson5Tree] = await Promise.all([
                Promise.all(runtimeAttestations.map(async (attestation) => await attestation.revalidate())),
                digestOwnedPackageTree(json5Root),
            ]);
            return filesIntact.every(Boolean) &&
                currentJson5Tree?.fileCount ===
                    PINNED_OPENCLAW_SENTINEL_JSON5_FILE_COUNT &&
                currentJson5Tree.sha256 ===
                    PINNED_OPENCLAW_SENTINEL_JSON5_TREE_SHA256;
        };
        const runtime = await import(pathToFileURL(sentinelPath).href);
        if (!isRecord(runtime) || typeof runtime.i !== 'function' ||
            !await revalidateImportClosure())
            return null;
        const resolvePreparedAuthSentinel = runtime.i;
        return createPreparedAuthAccountInspector(resolvePreparedAuthSentinel, revalidateImportClosure);
    }
    catch {
        return null;
    }
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
/**
 * Resolve the one Codex plugin installed in OpenClaw's npm project store.
 *
 * Runtime web-provider enumeration deliberately cold-loads plugins and returns
 * shallow provider clones without committing that registry globally. This
 * state-store lookup is only a uniqueness and canonical-path cross-check; it
 * does not assert that OpenClaw selected, trusted, enabled, or imported the
 * package. The supported static/runtime inspect seam proves those properties.
 */
export async function resolveInstalledOfficialCodexPluginRecord(stateDir) {
    if (!stateDir || stateDir.trim() !== stateDir ||
        !path.isAbsolute(stateDir))
        return null;
    try {
        const stateRoot = await realpath(stateDir);
        if (stateRoot !== path.resolve(stateDir))
            return null;
        const projectsRoot = path.join(stateRoot, 'npm', 'projects');
        if (await realpath(projectsRoot) !== projectsRoot)
            return null;
        const pluginRoots = [];
        for (const entry of await readdir(projectsRoot, { withFileTypes: true })) {
            if (entry.isSymbolicLink())
                return null;
            if (!entry.isDirectory())
                continue;
            const projectRoot = path.join(projectsRoot, entry.name);
            if (await realpath(projectRoot) !== projectRoot)
                return null;
            const pluginRoot = path.join(projectRoot, 'node_modules', '@openclaw', 'codex');
            let pluginStat;
            try {
                pluginStat = await lstat(pluginRoot);
            }
            catch (error) {
                if (isRecord(error) && error.code === 'ENOENT')
                    continue;
                return null;
            }
            if (!pluginStat.isDirectory() || pluginStat.isSymbolicLink() ||
                await realpath(pluginRoot) !== pluginRoot)
                return null;
            pluginRoots.push(pluginRoot);
        }
        if (pluginRoots.length !== 1)
            return null;
        const [rootDir] = pluginRoots;
        if (!rootDir)
            return null;
        return {
            enabled: true,
            id: 'codex',
            origin: 'global',
            packageName: PINNED_CODEX_PLUGIN_NAME,
            rootDir,
            source: path.join(rootDir, 'dist', 'index.js'),
            status: 'loaded',
            trustedOfficialInstall: true,
            version: PINNED_CODEX_PLUGIN_VERSION,
            webSearchProviderIds: ['codex'],
        };
    }
    catch {
        return null;
    }
}
const EXPECTED_CODEX_CONTRACTS = Object.freeze({
    mediaUnderstandingProviders: ['codex'],
    migrationProviders: ['codex'],
    tools: ['codex_threads'],
    webSearchProviders: ['codex'],
});
const EXPECTED_STATIC_CODEX_CAPABILITIES = Object.freeze([
    { ids: ['codex'], kind: 'text-inference' },
    { ids: ['codex'], kind: 'media-understanding' },
    { ids: ['codex'], kind: 'web-search' },
]);
const EXPECTED_RUNTIME_CODEX_CAPABILITIES = Object.freeze([
    ...EXPECTED_STATIC_CODEX_CAPABILITIES,
    { ids: ['codex'], kind: 'agent-harness' },
]);
const CODEX_INSTALL_KEYS = Object.freeze([
    'installPath',
    'installedAt',
    'integrity',
    'resolvedAt',
    'resolvedName',
    'resolvedSpec',
    'resolvedVersion',
    'shasum',
    'source',
    'spec',
    'version',
]);
function isCanonicalIsoTimestamp(value) {
    if (typeof value !== 'string')
        return false;
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) &&
        new Date(milliseconds).toISOString() === value;
}
function recordFromInspection(value) {
    const record = {
        enabled: value.enabled,
        id: value.id,
        origin: value.origin,
        packageName: value.packageName,
        rootDir: value.rootDir,
        source: value.source,
        status: value.status,
        trustedOfficialInstall: value.trustedOfficialInstall,
        version: value.version,
        webSearchProviderIds: value.webSearchProviderIds,
    };
    return isOfficialCodexPluginRecord(record) ? record : null;
}
/** Validate the bounded JSON returned by the pinned supported inspect command. */
export function parseOfficialCodexRuntimeInspection(stdout, expectedRecord, runtime, expectedWorkspaceDir) {
    if (!stdout || Buffer.byteLength(stdout, 'utf8') >
        PLUGIN_INSPECT_STDOUT_LIMIT)
        return null;
    try {
        const value = JSON.parse(stdout);
        if (!isRecord(value) || !isRecord(value.plugin) ||
            !isRecord(value.install) || value.shape !== 'hybrid-capability' ||
            value.capabilityMode !== 'hybrid' ||
            value.capabilityCount !== (runtime ? 4 : 3) ||
            !isDeepStrictEqual(value.capabilities, runtime
                ? EXPECTED_RUNTIME_CODEX_CAPABILITIES
                : EXPECTED_STATIC_CODEX_CAPABILITIES) || !isDeepStrictEqual(value.diagnostics, []) ||
            !isDeepStrictEqual(value.compatibility, []) ||
            !isDeepStrictEqual(value.bundleCapabilities, []) ||
            !isRecord(value.policy) ||
            !isDeepStrictEqual(value.policy.allowedModels, []) ||
            value.policy.hasAllowedModelsConfig !== false ||
            (expectedWorkspaceDir !== undefined &&
                value.workspaceDir !== expectedWorkspaceDir))
            return null;
        const plugin = value.plugin;
        const record = recordFromInspection(plugin);
        if (!record || !isDeepStrictEqual(record, expectedRecord) ||
            plugin.imported !== runtime || plugin.activated !== true ||
            plugin.explicitlyEnabled !== true ||
            plugin.activationSource !== 'explicit' ||
            plugin.activationReason !== 'enabled in config' ||
            plugin.format !== 'openclaw' ||
            !isDeepStrictEqual(plugin.contracts, EXPECTED_CODEX_CONTRACTS) ||
            !isDeepStrictEqual(plugin.providerIds, ['codex']) ||
            !isDeepStrictEqual(plugin.agentHarnessIds, runtime ? ['codex'] : []) || !isDeepStrictEqual(plugin.toolNames, runtime ? ['codex_threads'] : []) || !isDeepStrictEqual(plugin.mediaUnderstandingProviderIds, ['codex']) || !isDeepStrictEqual(plugin.migrationProviderIds, ['codex']) ||
            !isDeepStrictEqual(plugin.syntheticAuthRefs, ['codex']))
            return null;
        const install = value.install;
        if (!isDeepStrictEqual(Object.keys(install).sort(), [...CODEX_INSTALL_KEYS].sort()) || install.source !== 'npm' ||
            install.spec !== `${PINNED_CODEX_PLUGIN_NAME}@${PINNED_CODEX_PLUGIN_VERSION}` ||
            install.installPath !== record.rootDir ||
            install.version !== PINNED_CODEX_PLUGIN_VERSION ||
            install.resolvedName !== PINNED_CODEX_PLUGIN_NAME ||
            install.resolvedVersion !== PINNED_CODEX_PLUGIN_VERSION ||
            install.resolvedSpec !==
                `${PINNED_CODEX_PLUGIN_NAME}@${PINNED_CODEX_PLUGIN_VERSION}` ||
            install.integrity !== PINNED_CODEX_PLUGIN_INTEGRITY ||
            install.shasum !== CODEX_PLUGIN_SHASUM ||
            !isCanonicalIsoTimestamp(install.resolvedAt) ||
            !isCanonicalIsoTimestamp(install.installedAt))
            return null;
        return record;
    }
    catch {
        return null;
    }
}
async function resolvePinnedInspectCommand(argvEntry = process.argv[1]) {
    if (!argvEntry)
        return null;
    try {
        const cliPath = await realpath(argvEntry);
        const packageRoot = path.dirname(cliPath);
        if (cliPath !== path.join(packageRoot, 'openclaw.mjs'))
            return null;
        const packageJsonPath = path.join(packageRoot, 'package.json');
        const entryPath = path.join(packageRoot, 'dist', 'entry.js');
        const packageTreeAttestation = await attestCompletePackageTree(packageRoot, {
            fileCount: PINNED_OPENCLAW_PACKAGE_FILE_COUNT,
            sha256: PINNED_OPENCLAW_PACKAGE_TREE_SHA256,
            symlinkCount: PINNED_OPENCLAW_PACKAGE_SYMLINK_COUNT,
        });
        if (!exactPackageJson(await readJsonRecord(packageJsonPath), 'openclaw', PINNED_OPENCLAW_VERSION) || await realpath(packageJsonPath) !== packageJsonPath ||
            await realpath(entryPath) !== entryPath ||
            !packageTreeAttestation)
            return null;
        const [cliAttestation, entryAttestation] = await Promise.all([
            attestRegularExecutable(cliPath, PINNED_OPENCLAW_CLI_SHA256),
            attestRegularFile(entryPath, PINNED_OPENCLAW_ENTRY_SHA256),
        ]);
        if (!cliAttestation || !entryAttestation)
            return null;
        return {
            cliPath,
            packageRoot,
            async revalidate() {
                try {
                    const [cliIntact, entryIntact, packageTreeIntact, currentPackageJson, currentPackageJsonPath, currentEntryPath] = await Promise.all([
                        cliAttestation.revalidate(),
                        entryAttestation.revalidate(),
                        packageTreeAttestation.revalidate(),
                        readJsonRecord(packageJsonPath),
                        realpath(packageJsonPath),
                        realpath(entryPath),
                    ]);
                    return cliIntact && entryIntact &&
                        currentPackageJsonPath === packageJsonPath &&
                        currentEntryPath === entryPath &&
                        exactPackageJson(currentPackageJson, 'openclaw', PINNED_OPENCLAW_VERSION) && packageTreeIntact;
                }
                catch {
                    return false;
                }
            },
        };
    }
    catch {
        return null;
    }
}
const REQUIRED_PINNED_INSPECT_EMPTY_ENVIRONMENT_NAMES = Object.freeze([
    'ALL_PROXY',
    'CODEX_API_KEY',
    'CODEX_CA_CERTIFICATE',
    'CODEX_SANDBOX',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NODE_EXTRA_CA_CERTS',
    'NODE_OPTIONS',
    'NODE_PATH',
    'OPENAI_API_BASE',
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_CUSTOM_HEADERS',
    'OPENCLAW_DEBUG_MODEL_PAYLOAD',
    'OPENCLAW_DEBUG_PROXY_ENABLED',
    'OPENCLAW_DEBUG_PROXY_URL',
    'OPENCLAW_LOAD_SHELL_ENV',
    'OPENCLAW_PROFILE',
]);
export function buildPinnedInspectEnvironment(environment, stateDir, workspaceDir, emptyEnvironmentNames) {
    const home = environment.HOME;
    if (!home || home.trim() !== home || !path.isAbsolute(home) ||
        !stateDir || stateDir.trim() !== stateDir || !path.isAbsolute(stateDir) ||
        path.resolve(stateDir) !== stateDir ||
        stateDir === path.join(path.resolve(home), '.openclaw') ||
        !workspaceDir || workspaceDir.trim() !== workspaceDir ||
        !path.isAbsolute(workspaceDir))
        return null;
    const configPath = path.join(stateDir, 'openclaw.json');
    if (environment.OPENCLAW_CONFIG_PATH !== undefined &&
        environment.OPENCLAW_CONFIG_PATH !== '' &&
        environment.OPENCLAW_CONFIG_PATH !== configPath)
        return null;
    const uniqueEmptyNames = new Set(emptyEnvironmentNames);
    if (!REQUIRED_PINNED_INSPECT_EMPTY_ENVIRONMENT_NAMES.every((name) => uniqueEmptyNames.has(name)) || [...uniqueEmptyNames].some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)))
        return null;
    const result = Object.fromEntries([...uniqueEmptyNames].map((name) => [name, '']));
    Object.assign(result, {
        HOME: home,
        LANG: 'C.UTF-8',
        NODE_DISABLE_COMPILE_CACHE: '1',
        NODE_ENV: 'production',
        OPENCLAW_NODE_OPTIONS_READY: '1',
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_STATE_DIR: stateDir,
        OPENCLAW_WORKSPACE_DIR: workspaceDir,
        PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    });
    return result;
}
export async function inspectDotenvFilesAreAbsent(stateDir, workspaceDir) {
    const dotenvPaths = new Set([
        path.join(stateDir, '.env'),
        path.join(workspaceDir, '.env'),
    ]);
    try {
        for (const dotenvPath of dotenvPaths) {
            try {
                await lstat(dotenvPath);
                return false;
            }
            catch (error) {
                if (!isRecord(error) || error.code !== 'ENOENT')
                    return false;
            }
        }
        return true;
    }
    catch {
        return false;
    }
}
export async function attestInspectConfigWithoutEnv(configPath) {
    const config = await readJsonRecord(configPath);
    const initial = await hashAndSealRegularFile(configPath);
    if (!config || Object.prototype.hasOwnProperty.call(config, 'env') ||
        containsOwnConfigInclude(config) ||
        !initial)
        return null;
    return {
        async revalidate() {
            const currentConfig = await readJsonRecord(configPath);
            const current = await hashAndSealRegularFile(configPath);
            return Boolean(currentConfig) &&
                !Object.prototype.hasOwnProperty.call(currentConfig, 'env') &&
                !containsOwnConfigInclude(currentConfig) &&
                current?.sha256 === initial.sha256 &&
                sealMatches(current.seal, initial.seal);
        },
    };
}
function runPinnedInspect(cliPath, runtime, environment, workspaceDir) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
            cliPath,
            'plugins',
            'inspect',
            'codex',
            ...(runtime ? ['--runtime'] : []),
            '--json',
        ], {
            detached: process.platform !== 'win32',
            cwd: workspaceDir,
            env: environment,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const stdout = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let exceeded = false;
        const terminate = () => {
            exceeded = true;
            try {
                if (process.platform !== 'win32' && child.pid) {
                    process.kill(-child.pid, 'SIGKILL');
                }
                else {
                    child.kill('SIGKILL');
                }
            }
            catch {
                // Failure is reported through the single sanitized rejection below.
            }
        };
        child.stdout.on('data', (chunk) => {
            stdoutBytes += chunk.byteLength;
            if (stdoutBytes > PLUGIN_INSPECT_STDOUT_LIMIT)
                terminate();
            else
                stdout.push(chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderrBytes += chunk.byteLength;
            if (stderrBytes > PLUGIN_INSPECT_STDERR_LIMIT)
                terminate();
        });
        const timeout = setTimeout(() => {
            terminate();
        }, PLUGIN_INSPECT_TIMEOUT_MS);
        child.once('error', () => {
            clearTimeout(timeout);
            reject(new Error('Pinned OpenClaw inspection failed.'));
        });
        child.once('close', (code) => {
            clearTimeout(timeout);
            if (exceeded || code !== 0 || stderrBytes !== 0) {
                reject(new Error('Pinned OpenClaw inspection failed.'));
                return;
            }
            resolve(Buffer.concat(stdout).toString('utf8'));
        });
    });
}
/**
 * Resolve the runtime-selected Codex plugin through OpenClaw's supported CLI.
 * Static inspection binds the selected install, package attestation seals its
 * bytes, and runtime inspection proves the same record actually imports and
 * exposes the reviewed capability set.
 */
export async function resolveRuntimeSelectedOfficialCodexPluginRecord(environment, stateDir, workspaceDir, emptyEnvironmentNames, argvEntry = process.argv[1]) {
    try {
        const installedRecord = await resolveInstalledOfficialCodexPluginRecord(stateDir);
        const command = await resolvePinnedInspectCommand(argvEntry);
        const inspectEnvironment = buildPinnedInspectEnvironment(environment, stateDir, workspaceDir, emptyEnvironmentNames);
        if (!installedRecord || !command || !inspectEnvironment)
            return null;
        if (await realpath(workspaceDir) !== workspaceDir ||
            !await inspectDotenvFilesAreAbsent(stateDir, workspaceDir))
            return null;
        const configAttestation = await attestInspectConfigWithoutEnv(inspectEnvironment.OPENCLAW_CONFIG_PATH);
        if (!configAttestation || !await configAttestation.revalidate())
            return null;
        const staticRecord = parseOfficialCodexRuntimeInspection(await runPinnedInspect(command.cliPath, false, inspectEnvironment, workspaceDir), installedRecord, false, workspaceDir);
        if (!staticRecord ||
            !await inspectDotenvFilesAreAbsent(stateDir, workspaceDir) ||
            !await configAttestation.revalidate())
            return null;
        const packageAttestation = await attestOfficialCodexPackage(staticRecord, process.platform, process.arch, command.packageRoot);
        if (!packageAttestation || !await packageAttestation.revalidate() ||
            !await inspectDotenvFilesAreAbsent(stateDir, workspaceDir) ||
            !await configAttestation.revalidate() ||
            !await command.revalidate())
            return null;
        const runtimeRecord = parseOfficialCodexRuntimeInspection(await runPinnedInspect(command.cliPath, true, inspectEnvironment, workspaceDir), staticRecord, true, workspaceDir);
        if (!runtimeRecord || !await packageAttestation.revalidate() ||
            !await command.revalidate() ||
            !await inspectDotenvFilesAreAbsent(stateDir, workspaceDir) ||
            !await configAttestation.revalidate())
            return null;
        return { ...runtimeRecord, openclawRootDir: command.packageRoot };
    }
    catch {
        return null;
    }
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
    const tokenIdentity = resolveOpenAiCodexAccessTokenIdentity(credential.access);
    if (!tokenIdentity)
        return null;
    const storedAccountId = credential.accountId;
    if (typeof storedAccountId !== 'string' || !storedAccountId ||
        storedAccountId !== storedAccountId.trim() ||
        storedAccountId !== tokenIdentity.accountId)
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
            accountId: tokenIdentity.accountId,
            oauthSubjectSha256: tokenIdentity.subjectSha256,
        });
    }
    catch {
        return null;
    }
}
function hasOAuthRefreshMaterial(credential) {
    return (typeof credential.refresh === 'string' &&
        credential.refresh.length > 0) ||
        (typeof credential.refreshToken === 'string' &&
            credential.refreshToken.length > 0);
}
/**
 * Own a singleton OAuth store whose credential may be replaced only by a
 * same-account token rotation. Credentials are frozen so refresh code must use
 * the reviewed whole-record assignment path, which the profiles proxy checks
 * synchronously before the new access token becomes observable.
 */
export function guardOAuthProfileStoreAccountBinding(sourceStore, profileId, expectedIdentity) {
    const sourceProfiles = sourceStore.profiles;
    const sourceCredential = isRecord(sourceProfiles)
        ? sourceProfiles[profileId]
        : null;
    // Search receives an isolated, access-only credential. A disposable scoped
    // refresh could consume a single-use authoritative refresh token and discard
    // its replacement; refuse any such material before the pinned client runs.
    if (!isRecord(sourceCredential) ||
        hasOAuthRefreshMaterial(sourceCredential))
        return null;
    if (!isDeepStrictEqual(snapshotOAuthCredentialIdentity(sourceStore, profileId), expectedIdentity))
        return null;
    try {
        const initialCredential = sourceCredential;
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
                if (property !== profileId || !isRecord(value) ||
                    hasOAuthRefreshMaterial(value))
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
export async function attestOfficialCodexPackage(record, platform = process.platform, architecture = process.arch, openclawRootDir = record.openclawRootDir) {
    if (!isOfficialCodexPluginRecord(record) || !record.rootDir ||
        !openclawRootDir || !path.isAbsolute(openclawRootDir))
        return null;
    const platformExpectation = PLATFORM_EXECUTABLES[`${platform}-${architecture}`];
    if (!platformExpectation)
        return null;
    try {
        const pluginRoot = await realpath(record.rootDir);
        const openclawRoot = await realpath(openclawRootDir);
        if (path.resolve(record.rootDir) !== pluginRoot ||
            path.resolve(openclawRootDir) !== openclawRoot)
            return null;
        const expectedEntry = path.join(pluginRoot, 'dist', 'index.js');
        const pluginEntry = await realpath(record.source);
        if (pluginEntry !== expectedEntry ||
            !pathIsInside(pluginRoot, pluginEntry))
            return null;
        const pluginPackageJsonPath = path.join(pluginRoot, 'package.json');
        const shrinkwrapPath = path.join(pluginRoot, 'npm-shrinkwrap.json');
        const openclawPackageJsonPath = path.join(openclawRoot, 'package.json');
        const completeTreeOptions = {
            allowedExternalSymlinks: {
                'node_modules/openclaw': {
                    identity: 'pinned-openclaw-root',
                    target: openclawRoot,
                },
            },
        };
        const [pluginPackageJson, shrinkwrap, tree, entryFile, completeTreeAttestation, openclawPackageJson, openclawTreeAttestation] = await Promise.all([
            readJsonRecord(pluginPackageJsonPath),
            readJsonRecord(shrinkwrapPath),
            digestOwnedPackageTree(pluginRoot),
            hashAndSealRegularFile(pluginEntry),
            attestCompletePackageTree(pluginRoot, {
                fileCount: PINNED_CODEX_COMPLETE_TREE_FILE_COUNT,
                sha256: PINNED_CODEX_COMPLETE_TREE_SHA256,
                symlinkCount: PINNED_CODEX_COMPLETE_TREE_SYMLINK_COUNT,
            }, completeTreeOptions),
            readJsonRecord(openclawPackageJsonPath),
            attestCompletePackageTree(openclawRoot, {
                fileCount: PINNED_OPENCLAW_PACKAGE_FILE_COUNT,
                sha256: PINNED_OPENCLAW_PACKAGE_TREE_SHA256,
                symlinkCount: PINNED_OPENCLAW_PACKAGE_SYMLINK_COUNT,
            }),
        ]);
        if (!exactPackageJson(pluginPackageJson, PINNED_CODEX_PLUGIN_NAME, PINNED_CODEX_PLUGIN_VERSION) || !shrinkwrap ||
            shrinkwrap.name !== PINNED_CODEX_PLUGIN_NAME ||
            shrinkwrap.version !== PINNED_CODEX_PLUGIN_VERSION ||
            tree?.fileCount !== PINNED_CODEX_PLUGIN_FILE_COUNT ||
            tree.sha256 !== PINNED_CODEX_PLUGIN_TREE_SHA256 ||
            entryFile?.sha256 !== PINNED_CODEX_PLUGIN_ENTRY_SHA256 ||
            !completeTreeAttestation || !exactPackageJson(openclawPackageJson, 'openclaw', PINNED_OPENCLAW_VERSION) || !openclawTreeAttestation)
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
                const [completeTreeIntact, openclawTreeIntact, currentOpenClawPackage, currentOpenClawPeer] = await Promise.all([
                    completeTreeAttestation.revalidate(),
                    openclawTreeAttestation.revalidate(),
                    readJsonRecord(openclawPackageJsonPath),
                    realpath(path.join(pluginRoot, 'node_modules', 'openclaw')),
                ]);
                return completeTreeIntact && openclawTreeIntact &&
                    currentOpenClawPeer === openclawRoot &&
                    exactPackageJson(currentOpenClawPackage, 'openclaw', PINNED_OPENCLAW_VERSION) && currentTree?.fileCount === PINNED_CODEX_PLUGIN_FILE_COUNT &&
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
