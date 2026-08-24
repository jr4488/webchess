// @vitest-environment node

import { createHash } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  attestRegularExecutable,
  digestOwnedPackageTree,
  isOfficialCodexPluginRecord,
  snapshotOAuthCredentialIdentity,
} from './codex-attestation.js'

const roots: string[] = []

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

  it('permits token refresh but detects OAuth account identity drift', () => {
    const profileId = 'openai:account'
    const store = {
      order: { openai: [profileId] },
      profiles: {
        [profileId]: {
          access: 'initial-access',
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
    store.profiles[profileId].access = 'refreshed-access'
    store.profiles[profileId].expires = 2
    store.profiles[profileId].refresh = 'refreshed-refresh'

    expect(snapshotOAuthCredentialIdentity(store, profileId)).toEqual(initial)

    store.profiles[profileId].accountId = 'account-two'
    expect(snapshotOAuthCredentialIdentity(store, profileId)).not.toEqual(
      initial,
    )
  })
})
