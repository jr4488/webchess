// @vitest-environment node

import { createHash } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  attestRegularExecutable,
  digestOwnedPackageTree,
  guardOAuthProfileStoreAccountBinding,
  isOfficialCodexPluginRecord,
  resolveOpenAiCodexAccessTokenAccountId,
  snapshotOAuthCredentialIdentity,
} from './codex-attestation.js'

const roots: string[] = []
const OPENAI_CODEX_AUTH_CLAIM = 'https://api.openai.com/auth'

function oauthAccessJwt(accountId: string, rotation: string): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return [
    encode({ alg: 'RS256', typ: 'JWT' }),
    encode({
      [OPENAI_CODEX_AUTH_CLAIM]: { chatgpt_account_id: accountId },
      jti: rotation,
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

  it('matches the pinned account-id claim and fails closed more strictly', () => {
    expect(resolveOpenAiCodexAccessTokenAccountId(
      oauthAccessJwt('account-one', 'initial'),
    )).toBe('account-one')
    expect(resolveOpenAiCodexAccessTokenAccountId('not-a-jwt')).toBeNull()
    expect(resolveOpenAiCodexAccessTokenAccountId(
      oauthAccessJwt('', 'missing-account'),
    )).toBeNull()
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

    store.profiles[profileId].accountId = ' '
    expect(snapshotOAuthCredentialIdentity(store, profileId)).toBeNull()

    store.profiles[profileId].accountId = 'different-account'
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
})
