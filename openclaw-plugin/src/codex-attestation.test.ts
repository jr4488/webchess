// @vitest-environment node

import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  attestCompletePackageTree,
  attestInspectConfigWithoutEnv,
  attestRegularExecutable,
  buildPinnedInspectEnvironment,
  createPreparedAuthAccountInspector,
  digestCompletePackageTree,
  digestOwnedPackageTree,
  guardOAuthProfileStoreAccountBinding,
  inspectDotenvFilesAreAbsent,
  isOfficialCodexPluginRecord,
  parseOfficialCodexRuntimeInspection,
  resolveOpenAiCodexAccessTokenAccountId,
  resolveOpenAiCodexAccessTokenIdentity,
  resolveInstalledOfficialCodexPluginRecord,
  snapshotOAuthCredentialIdentity,
  type CodexPluginRecordForAttestation,
} from './codex-attestation.js'

const roots: string[] = []
const OPENAI_CODEX_AUTH_CLAIM = 'https://api.openai.com/auth'
const CODEX_PLUGIN_INTEGRITY =
  'sha512-fRQITjqjC4Q/M6WmkR9XPWPuL+7vcvyVUWIDztB08X2G/mhzSwCYwQp4hugxAtuKmO3yx/7ULMK3nyeKsg5zGw=='
const CODEX_PLUGIN_SPEC = '@openclaw/codex@2026.7.1-1'
const INSPECT_WORKSPACE = '/official/openclaw-workspace'

function officialCodexInspectionRecord(): CodexPluginRecordForAttestation {
  const rootDir = '/official/@openclaw/codex'
  return {
    enabled: true,
    id: 'codex',
    origin: 'global',
    packageName: '@openclaw/codex',
    rootDir,
    source: `${rootDir}/dist/index.js`,
    status: 'loaded',
    trustedOfficialInstall: true,
    version: '2026.7.1-1',
    webSearchProviderIds: ['codex'],
  }
}

function officialCodexInspection(runtime: boolean) {
  const record = officialCodexInspectionRecord()
  return {
    bundleCapabilities: [],
    capabilities: [
      { ids: ['codex'], kind: 'text-inference' },
      { ids: ['codex'], kind: 'media-understanding' },
      { ids: ['codex'], kind: 'web-search' },
      ...(runtime ? [{ ids: ['codex'], kind: 'agent-harness' }] : []),
    ],
    capabilityCount: runtime ? 4 : 3,
    capabilityMode: 'hybrid',
    compatibility: [],
    diagnostics: [],
    install: {
      installPath: record.rootDir,
      installedAt: '2026-08-24T01:02:03.000Z',
      integrity: CODEX_PLUGIN_INTEGRITY,
      resolvedAt: '2026-08-24T01:02:03.000Z',
      resolvedName: '@openclaw/codex',
      resolvedSpec: CODEX_PLUGIN_SPEC,
      resolvedVersion: '2026.7.1-1',
      shasum: '49c96d1e714d71b0032cca38ea60677a77e6e604',
      source: 'npm',
      spec: CODEX_PLUGIN_SPEC,
      version: '2026.7.1-1',
    },
    plugin: {
      ...record,
      activated: true,
      activationReason: 'enabled in config',
      activationSource: 'explicit',
      agentHarnessIds: runtime ? ['codex'] : [],
      contracts: {
        mediaUnderstandingProviders: ['codex'],
        migrationProviders: ['codex'],
        tools: ['codex_threads'],
        webSearchProviders: ['codex'],
      },
      explicitlyEnabled: true,
      format: 'openclaw',
      imported: runtime,
      mediaUnderstandingProviderIds: ['codex'],
      migrationProviderIds: ['codex'],
      providerIds: ['codex'],
      syntheticAuthRefs: ['codex'],
      toolNames: runtime ? ['codex_threads'] : [],
    },
    policy: {
      allowedModels: [],
      hasAllowedModelsConfig: false,
    },
    shape: 'hybrid-capability',
    workspaceDir: INSPECT_WORKSPACE,
  }
}

function oauthAccessJwt(
  accountId: string,
  rotation: string,
  subject: string | null = 'user-one',
  subjectClaims: Record<string, unknown> = {},
  payloadClaims: Record<string, unknown> = {},
): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return [
    encode({ alg: 'RS256', typ: 'JWT' }),
    encode({
      [OPENAI_CODEX_AUTH_CLAIM]: {
        chatgpt_account_id: accountId,
        ...(subject === null ? {} : { chatgpt_account_user_id: subject }),
        ...subjectClaims,
      },
      jti: rotation,
      ...payloadClaims,
    }),
    // Synthetic signature bytes are sufficient because the reviewed local
    // decoder extracts routing metadata; OpenAI validates real token signatures.
    Buffer.from(`signature-${rotation}`, 'utf8').toString('base64url'),
  ].join('.')
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'webchess-codex-attestation-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) =>
    await rm(root, { force: true, recursive: true })))
})

describe('official Codex package attestation primitives', () => {
  it('rejects a changed alternate executable even at the same path', async () => {
    const root = await temporaryRoot()
    const executable = path.join(root, 'codex')
    const reviewed = '#!/bin/sh\nexit 0\n'
    await writeFile(executable, reviewed, { mode: 0o755 })
    await chmod(executable, 0o755)
    const expected = createHash('sha256').update(reviewed).digest('hex')
    const attestation = await attestRegularExecutable(executable, expected)

    expect(attestation).not.toBeNull()
    expect(await attestation!.revalidate()).toBe(true)

    await writeFile(executable, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    expect(await attestation!.revalidate()).toBe(false)
  })

  it('rejects hard-linked package files from the owned tree digest', async () => {
    const root = await temporaryRoot()
    const owned = path.join(root, 'owned.js')
    await writeFile(owned, 'reviewed\n')
    await import('node:fs/promises').then(async ({ link }) =>
      await link(owned, path.join(root, 'alternate.js')))

    expect(await digestOwnedPackageTree(root)).toBeNull()
  })

  it('invalidates a complete runtime tree when a dependency changes', async () => {
    const root = await temporaryRoot()
    const dependencyRoot = path.join(root, 'node_modules', 'commander')
    const binRoot = path.join(root, 'node_modules', '.bin')
    await mkdir(dependencyRoot, { recursive: true })
    await mkdir(binRoot, { recursive: true })
    await writeFile(path.join(root, 'openclaw.mjs'), 'import "commander"\n')
    await writeFile(path.join(dependencyRoot, 'index.js'), 'export const id = 1\n')
    await symlink('../commander/index.js', path.join(binRoot, 'commander'))
    const expected = await digestCompletePackageTree(root)
    expect(expected).not.toBeNull()
    expect(expected).toMatchObject({ fileCount: 2, symlinkCount: 1 })
    const attestation = await attestCompletePackageTree(root, expected!)
    expect(attestation).not.toBeNull()
    expect(await attestation!.revalidate()).toBe(true)

    await writeFile(path.join(dependencyRoot, 'index.js'), 'export const id = 2\n')

    expect(await attestation!.revalidate()).toBe(false)
  })

  it('allows only the exact declared external package-root symlink', async () => {
    const container = await temporaryRoot()
    const pluginRoot = path.join(container, 'plugin')
    const openclawRoot = path.join(container, 'openclaw')
    const openclawAlias = path.join(container, 'openclaw-alias')
    const lookalikeRoot = path.join(container, 'lookalike')
    await mkdir(path.join(pluginRoot, 'node_modules'), { recursive: true })
    await mkdir(openclawRoot)
    await mkdir(lookalikeRoot)
    await symlink(openclawRoot, openclawAlias)
    const peerLink = path.join(pluginRoot, 'node_modules', 'openclaw')
    await symlink(openclawRoot, peerLink)
    const options = {
      allowedExternalSymlinks: {
        'node_modules/openclaw': {
          identity: 'pinned-openclaw-root',
          target: openclawRoot,
        },
      },
    }
    expect(await digestCompletePackageTree(pluginRoot, options)).not.toBeNull()

    await rm(peerLink)
    await symlink(openclawAlias, peerLink)

    expect(await digestCompletePackageTree(pluginRoot, options)).toBeNull()

    await rm(peerLink)
    await symlink(lookalikeRoot, peerLink)

    expect(await digestCompletePackageTree(pluginRoot, options)).toBeNull()
  })

  it('requires a nondefault state and explicitly empties inspect controls', () => {
    const home = '/home/researcher'
    const stateDir = '/var/lib/webchess-openclaw'
    const workspaceDir = '/var/lib/webchess-workspace'
    const emptyEnvironmentNames = [
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
    ]
    const environment = buildPinnedInspectEnvironment(
      { HOME: home, NODE_ENV: 'test' },
      stateDir,
      workspaceDir,
      emptyEnvironmentNames,
    )

    expect(environment).toMatchObject({
      ALL_PROXY: '',
      CODEX_API_KEY: '',
      HOME: home,
      HTTPS_PROXY: '',
      OPENAI_API_KEY: '',
      OPENCLAW_CONFIG_PATH: `${stateDir}/openclaw.json`,
      OPENCLAW_LOAD_SHELL_ENV: '',
      OPENCLAW_PROFILE: '',
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_WORKSPACE_DIR: workspaceDir,
    })
    expect(buildPinnedInspectEnvironment(
      { HOME: home, NODE_ENV: 'test' },
      `${home}/.openclaw`,
      workspaceDir,
      emptyEnvironmentNames,
    )).toBeNull()
  })

  it('rejects dotenv files and config env changes around inspection', async () => {
    const root = await temporaryRoot()
    const stateDir = path.join(root, 'state')
    const workspaceDir = path.join(root, 'workspace')
    const configPath = path.join(stateDir, 'openclaw.json')
    await mkdir(stateDir)
    await mkdir(workspaceDir)
    await writeFile(configPath, JSON.stringify({ plugins: {} }))
    expect(await inspectDotenvFilesAreAbsent(
      stateDir,
      workspaceDir,
    )).toBe(true)
    const configAttestation = await attestInspectConfigWithoutEnv(configPath)
    expect(configAttestation).not.toBeNull()

    await writeFile(path.join(workspaceDir, '.env'), 'OPENAI_API_KEY=blocked\n')
    expect(await inspectDotenvFilesAreAbsent(
      stateDir,
      workspaceDir,
    )).toBe(false)
    await rm(path.join(workspaceDir, '.env'))
    await writeFile(path.join(stateDir, '.env'), 'OPENAI_API_KEY=blocked\n')
    expect(await inspectDotenvFilesAreAbsent(
      stateDir,
      workspaceDir,
    )).toBe(false)
    await rm(path.join(stateDir, '.env'))
    await writeFile(configPath, JSON.stringify({
      env: { shellEnv: { enabled: true } },
    }))

    expect(await configAttestation!.revalidate()).toBe(false)
  })

  it('rejects a root include before a mutable child can contribute env', async () => {
    const root = await temporaryRoot()
    const configPath = path.join(root, 'openclaw.json')
    const includedPath = path.join(root, 'included.json5')
    await writeFile(includedPath, JSON.stringify({ plugins: {} }))
    await writeFile(configPath, JSON.stringify({
      $include: 'included.json5',
      plugins: {},
    }))

    expect(await attestInspectConfigWithoutEnv(configPath)).toBeNull()

    await writeFile(includedPath, JSON.stringify({
      env: { shellEnv: { enabled: true } },
    }))
    expect(await attestInspectConfigWithoutEnv(configPath)).toBeNull()

    await writeFile(configPath, JSON.stringify({
      plugins: { $include: 'included.json5' },
    }))
    expect(await attestInspectConfigWithoutEnv(configPath)).toBeNull()

    await writeFile(configPath, JSON.stringify({
      plugins: [{ $include: 'included.json5' }],
    }))
    expect(await attestInspectConfigWithoutEnv(configPath)).toBeNull()
  })

  it('requires exact official registry provenance, version, and trust', () => {
    const record = {
      enabled: true,
      id: 'codex',
      origin: 'global',
      packageName: '@openclaw/codex',
      source: '/official/@openclaw/codex/dist/index.js',
      status: 'loaded',
      trustedOfficialInstall: true,
      version: '2026.7.1-1',
      webSearchProviderIds: ['codex'],
    }
    expect(isOfficialCodexPluginRecord(record)).toBe(true)
    expect(isOfficialCodexPluginRecord({
      ...record,
      origin: 'workspace',
    })).toBe(false)
    expect(isOfficialCodexPluginRecord({
      ...record,
      version: '2026.7.1-1-lookalike',
    })).toBe(false)
  })

  it('resolves exactly one direct Codex npm-project install', async () => {
    const stateDir = await temporaryRoot()
    const rootDir = path.join(
      stateDir,
      'npm',
      'projects',
      'openclaw-codex-fixture',
      'node_modules',
      '@openclaw',
      'codex',
    )
    await mkdir(rootDir, { recursive: true })

    expect(await resolveInstalledOfficialCodexPluginRecord(stateDir)).toEqual({
      enabled: true,
      id: 'codex',
      origin: 'global',
      packageName: '@openclaw/codex',
      rootDir,
      source: path.join(rootDir, 'dist', 'index.js'),
      status: 'loaded',
      trustedOfficialInstall: true,
      version: '2026.7.1-1',
      webSearchProviderIds: ['codex'],
    })
  })

  it('rejects duplicate or linked Codex npm-project installs', async () => {
    const stateDir = await temporaryRoot()
    const projectsDir = path.join(stateDir, 'npm', 'projects')
    const firstRoot = path.join(
      projectsDir,
      'first',
      'node_modules',
      '@openclaw',
      'codex',
    )
    const secondRoot = path.join(
      projectsDir,
      'second',
      'node_modules',
      '@openclaw',
      'codex',
    )
    await mkdir(firstRoot, { recursive: true })
    await mkdir(secondRoot, { recursive: true })
    expect(await resolveInstalledOfficialCodexPluginRecord(stateDir)).toBeNull()

    await rm(path.join(projectsDir, 'second'), { force: true, recursive: true })
    await symlink(path.join(projectsDir, 'first'), path.join(projectsDir, 'linked'))
    expect(await resolveInstalledOfficialCodexPluginRecord(stateDir)).toBeNull()
  })

  it('accepts exact static and runtime Codex inspection records', () => {
    const expected = officialCodexInspectionRecord()

    expect(parseOfficialCodexRuntimeInspection(
      JSON.stringify(officialCodexInspection(false)),
      expected,
      false,
      INSPECT_WORKSPACE,
    )).toEqual(expected)
    expect(parseOfficialCodexRuntimeInspection(
      JSON.stringify(officialCodexInspection(true)),
      expected,
      true,
      INSPECT_WORKSPACE,
    )).toEqual(expected)
  })

  it('rejects imported-state, install, capability, and workspace drift', () => {
    const expected = officialCodexInspectionRecord()
    const wrongImportedState = officialCodexInspection(false)
    wrongImportedState.plugin.imported = true
    const wrongRoot = officialCodexInspection(false)
    wrongRoot.plugin.rootDir = '/lookalike/@openclaw/codex'
    const wrongIntegrity = officialCodexInspection(false)
    wrongIntegrity.install.integrity = `sha512-${'A'.repeat(88)}`
    const extraInstallField = officialCodexInspection(false)
    Object.assign(extraInstallField.install, { registry: 'other' })
    const wrongCapabilities = officialCodexInspection(false)
    wrongCapabilities.capabilities.push({
      ids: ['lookalike'],
      kind: 'web-search',
    })
    const wrongWorkspace = officialCodexInspection(false)
    wrongWorkspace.workspaceDir = '/different/workspace'

    for (const inspection of [
      wrongImportedState,
      wrongRoot,
      wrongIntegrity,
      extraInstallField,
      wrongCapabilities,
      wrongWorkspace,
    ]) {
      expect(parseOfficialCodexRuntimeInspection(
        JSON.stringify(inspection),
        expected,
        false,
        INSPECT_WORKSPACE,
      )).toBeNull()
    }
  })

  it('matches the pinned account-id claim and fails closed more strictly', () => {
    expect(resolveOpenAiCodexAccessTokenAccountId(
      oauthAccessJwt('account-one', 'initial'),
    )).toBe('account-one')
    expect(resolveOpenAiCodexAccessTokenAccountId('not-a-jwt')).toBeNull()
    expect(resolveOpenAiCodexAccessTokenAccountId(
      oauthAccessJwt('', 'missing-account'),
    )).toBeNull()
    expect(resolveOpenAiCodexAccessTokenIdentity(
      oauthAccessJwt('account-one', 'missing-subject', null),
    )).toBeNull()
  })

  it('matches pinned stable-subject precedence including sub-only fallback', () => {
    const preferred = resolveOpenAiCodexAccessTokenIdentity(oauthAccessJwt(
      'account-one',
      'preferred',
      'stable-user',
      { chatgpt_user_id: 'lower-precedence-user', user_id: 'legacy-user' },
      { iss: 'issuer', sub: 'oidc-user' },
    ))
    const chatgptUser = resolveOpenAiCodexAccessTokenIdentity(oauthAccessJwt(
      'account-one',
      'chatgpt-user',
      null,
      { chatgpt_user_id: 'stable-user' },
    ))
    const legacyUser = resolveOpenAiCodexAccessTokenIdentity(oauthAccessJwt(
      'account-one',
      'legacy-user',
      null,
      { user_id: 'stable-user' },
    ))
    const issuerSubject = resolveOpenAiCodexAccessTokenIdentity(oauthAccessJwt(
      'account-one',
      'issuer-subject',
      'issuer|stable-user',
    ))
    const issuerFallback = resolveOpenAiCodexAccessTokenIdentity(oauthAccessJwt(
      'account-one',
      'issuer-fallback',
      null,
      {},
      { iss: 'issuer', sub: 'stable-user' },
    ))
    const subOnly = resolveOpenAiCodexAccessTokenIdentity(oauthAccessJwt(
      'account-one',
      'sub-only',
      null,
      {},
      { sub: 'stable-user' },
    ))

    expect(chatgptUser).toEqual(preferred)
    expect(legacyUser).toEqual(preferred)
    expect(issuerFallback).toEqual(issuerSubject)
    expect(subOnly).toEqual(preferred)
  })

  it('resolves the pinned sentinel shape without exposing the access token', async () => {
    const sentinel = `oc-sent-v1-${'a'.repeat(24)}`
    const token = oauthAccessJwt('account-one', 'sentinel-backed')
    const resolveSentinel = vi.fn((value: string) =>
      value === sentinel ? token : undefined)
    const inspector = createPreparedAuthAccountInspector(
      resolveSentinel,
      vi.fn(async () => true),
    )

    expect(await inspector.resolveIdentity(sentinel)).toEqual(
      resolveOpenAiCodexAccessTokenIdentity(token),
    )
    expect(await inspector.resolveIdentity(
      `oc-sent-v1-${'b'.repeat(24)}`,
    )).toBeNull()
    expect(resolveSentinel).toHaveBeenCalledWith(sentinel)
  })

  it('permits same-account token refresh but detects token account drift', () => {
    const profileId = 'openai:account'
    const store = {
      order: { openai: [profileId] },
      profiles: {
        [profileId]: {
          access: oauthAccessJwt('account-one', 'initial'),
          accountId: 'account-one',
          email: 'researcher@example.invalid',
          expires: 1,
          provider: 'openai',
          refresh: 'initial-refresh',
          type: 'oauth',
        },
      },
      version: 1,
    }
    const initial = snapshotOAuthCredentialIdentity(store, profileId)
    store.profiles[profileId].access = oauthAccessJwt(
      'account-one',
      'refreshed',
    )
    store.profiles[profileId].expires = 2
    store.profiles[profileId].refresh = 'refreshed-refresh'

    expect(snapshotOAuthCredentialIdentity(store, profileId)).toEqual(initial)

    store.profiles[profileId].access = oauthAccessJwt(
      'account-one',
      'different-user',
      'user-two',
    )
    expect(snapshotOAuthCredentialIdentity(store, profileId)).not.toEqual(
      initial,
    )

    store.profiles[profileId].access = oauthAccessJwt(
      'account-two',
      'different-account',
    )
    expect(snapshotOAuthCredentialIdentity(store, profileId)).toBeNull()
  })

  it('rejects missing, blank, or claim-mismatched stored account metadata', () => {
    const profileId = 'openai:account'
    const store = {
      order: { openai: [profileId] },
      profiles: {
        [profileId]: {
          access: oauthAccessJwt('derived-account', 'initial'),
          email: 'researcher@example.invalid',
          provider: 'openai',
          type: 'oauth',
        },
      },
      version: 1,
    }
    expect(snapshotOAuthCredentialIdentity(store, profileId)).toBeNull()

    const storedProfile = store.profiles[profileId] as
      typeof store.profiles[typeof profileId] & { accountId?: string }
    storedProfile.accountId = ' '
    expect(snapshotOAuthCredentialIdentity(store, profileId)).toBeNull()

    storedProfile.accountId = 'different-account'
    expect(snapshotOAuthCredentialIdentity(store, profileId)).toBeNull()
  })

  it('allows guarded same-account token rotation during a search', () => {
    const profileId = 'openai:account'
    const source = {
      order: { openai: [profileId] },
      profiles: {
        [profileId]: {
          access: oauthAccessJwt('account-one', 'initial'),
          accountId: 'account-one',
          provider: 'openai',
          type: 'oauth',
        },
      },
      version: 1,
    }
    const identity = snapshotOAuthCredentialIdentity(source, profileId)!
    const guarded = guardOAuthProfileStoreAccountBinding(
      source,
      profileId,
      identity,
    )!
    const profiles = guarded.store.profiles as
      Record<string, Record<string, unknown>>
    const providerQuery = vi.fn(() => 'grounded result')

    const refreshThenQuery = () => {
      profiles[profileId] = {
        ...profiles[profileId],
        access: oauthAccessJwt('account-one', 'refreshed'),
        expires: 2,
      }
      return providerQuery()
    }

    expect(refreshThenQuery()).toBe('grounded result')
    expect(providerQuery).toHaveBeenCalledTimes(1)
    expect(guarded.isIntact()).toBe(true)
  })

  it('refuses refresh material in an isolated search store', () => {
    const profileId = 'openai:account'
    const source = {
      order: { openai: [profileId] },
      profiles: {
        [profileId]: {
          access: oauthAccessJwt('account-one', 'initial'),
          accountId: 'account-one',
          provider: 'openai',
          refresh: 'must-remain-authoritative',
          type: 'oauth',
        },
      },
      version: 1,
    }
    const identity = snapshotOAuthCredentialIdentity(source, profileId)!

    expect(guardOAuthProfileStoreAccountBinding(
      source,
      profileId,
      identity,
    )).toBeNull()
  })

  it('blocks a client token rebind synchronously before query dispatch', () => {
    const profileId = 'openai:account'
    const source = {
      order: { openai: [profileId] },
      profiles: {
        [profileId]: {
          access: oauthAccessJwt('account-one', 'initial'),
          accountId: 'account-one',
          provider: 'openai',
          type: 'oauth',
        },
      },
      version: 1,
    }
    const identity = snapshotOAuthCredentialIdentity(source, profileId)!
    const guarded = guardOAuthProfileStoreAccountBinding(
      source,
      profileId,
      identity,
    )!
    const profiles = guarded.store.profiles as
      Record<string, Record<string, unknown>>
    const providerQuery = vi.fn()
    const startClientThenQuery = () => {
      profiles[profileId] = {
        ...profiles[profileId],
        access: oauthAccessJwt('account-two', 'client-startup-rebind'),
      }
      providerQuery()
    }

    expect(startClientThenQuery).toThrow(/OAuth binding changed/u)
    expect(providerQuery).not.toHaveBeenCalled()
    expect(guarded.isIntact()).toBe(false)
  })

  it('blocks a same-account different-user rebind before query dispatch', () => {
    const profileId = 'openai:account'
    const source = {
      order: { openai: [profileId] },
      profiles: {
        [profileId]: {
          access: oauthAccessJwt('account-one', 'initial', 'user-one'),
          accountId: 'account-one',
          provider: 'openai',
          type: 'oauth',
        },
      },
      version: 1,
    }
    const identity = snapshotOAuthCredentialIdentity(source, profileId)!
    const guarded = guardOAuthProfileStoreAccountBinding(
      source,
      profileId,
      identity,
    )!
    const profiles = guarded.store.profiles as
      Record<string, Record<string, unknown>>
    const providerQuery = vi.fn()

    expect(() => {
      profiles[profileId] = {
        ...profiles[profileId],
        access: oauthAccessJwt(
          'account-one',
          'different-user',
          'user-two',
        ),
      }
      providerQuery()
    }).toThrow(/OAuth binding changed/u)
    expect(providerQuery).not.toHaveBeenCalled()
    expect(guarded.isIntact()).toBe(false)
  })
})
