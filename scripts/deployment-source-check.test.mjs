import { describe, expect, it, vi } from 'vitest'

import {
  ReleaseSourceError,
  verifyReleaseSource,
} from './deployment-source-check.mjs'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

function successfulGit(overrides = new Map()) {
  const responses = new Map([
    [
      'status --porcelain=v1 --untracked-files=all',
      '',
    ],
    [
      'symbolic-ref --quiet HEAD',
      'refs/heads/release/webchess\n',
    ],
    [
      'rev-parse --verify HEAD^{commit}',
      `${COMMIT}\n`,
    ],
    [
      'for-each-ref --format=%(upstream:remotename)%00%(upstream:remoteref) refs/heads/release/webchess',
      'origin\0refs/heads/release/webchess\n',
    ],
    [
      'remote get-url --all origin',
      'https://github.com/jr4488/webchess.git\n',
    ],
    [
      'ls-remote --exit-code --heads https://github.com/jr4488/webchess.git refs/heads/release/webchess',
      `${COMMIT}\trefs/heads/release/webchess\n`,
    ],
    ...overrides,
  ])

  return vi.fn(async (arguments_) => {
    const key = arguments_.join(' ')
    if (!responses.has(key)) {
      throw new Error(`Unexpected Git call: ${key}`)
    }
    return responses.get(key)
  })
}

describe('release source verification', () => {
  it('proves a clean HEAD matches its live configured remote branch', async () => {
    const git = successfulGit()

    await expect(verifyReleaseSource({ git })).resolves.toEqual({
      branch: 'release/webchess',
      commit: COMMIT,
      repository: 'https://github.com/jr4488/webchess.git',
    })
    expect(git).toHaveBeenCalledTimes(8)
  })

  it('refuses tracked or untracked workspace changes before network access', async () => {
    const git = successfulGit(
      new Map([
        [
          'status --porcelain=v1 --untracked-files=all',
          '?? untracked-secret.txt\n',
        ],
      ]),
    )

    await expect(
      verifyReleaseSource({ git }),
    ).rejects.toThrow(
      'tracked and untracked changes are forbidden',
    )
    expect(git).toHaveBeenCalledTimes(1)
  })

  it('refuses a detached branch or a branch without an upstream', async () => {
    const detachedGit = successfulGit(
      new Map([
        ['symbolic-ref --quiet HEAD', ''],
      ]),
    )
    await expect(
      verifyReleaseSource({ git: detachedGit }),
    ).rejects.toThrow('attached local branch')

    const noUpstreamGit = successfulGit(
      new Map([
        [
          'for-each-ref --format=%(upstream:remotename)%00%(upstream:remoteref) refs/heads/release/webchess',
          '\0\n',
        ],
      ]),
    )
    await expect(
      verifyReleaseSource({ git: noUpstreamGit }),
    ).rejects.toThrow('configured remote branch')
  })

  it('refuses a local commit that is not the live remote branch commit', async () => {
    const git = successfulGit(
      new Map([
        [
          'ls-remote --exit-code --heads https://github.com/jr4488/webchess.git refs/heads/release/webchess',
          `${'f'.repeat(40)}\trefs/heads/release/webchess\n`,
        ],
      ]),
    )

    await expect(
      verifyReleaseSource({ git }),
    ).rejects.toThrow(
      'HEAD does not match the live remote branch commit',
    )
  })

  it('refuses forks, mirrors, multiple URLs, and credential-bearing remotes', async () => {
    for (const remoteUrls of [
      'https://github.com/someone/webchess.git\n',
      'https://github.com/jr4488/webchess.git\nssh://mirror/webchess\n',
      'https://token@example.invalid/webchess.git\n',
    ]) {
      const git = successfulGit(
        new Map([
          ['remote get-url --all origin', remoteUrls],
        ]),
      )

      await expect(verifyReleaseSource({ git })).rejects.toThrow(
        'canonical WebChess repository',
      )
    }
  })

  it('uses sanitized, bounded errors', async () => {
    const error = await verifyReleaseSource({
      git: async () => 'not-a-clean-status\n',
    }).catch((caught) => caught)

    expect(error).toBeInstanceOf(ReleaseSourceError)
    expect(error.message).not.toContain('not-a-clean-status')
  })
})
