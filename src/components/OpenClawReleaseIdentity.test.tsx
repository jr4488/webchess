import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CURRENT_METHOD_VERSION_TUPLE } from '../lib/lifecycle/method-versions.mjs'
import { OpenClawReleaseIdentityBanner } from './OpenClawReleaseIdentity'

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567'

describe('OpenClaw release identity banner', () => {
  it('visibly exposes the exact software release and full reviewed source commit', () => {
    render(<OpenClawReleaseIdentityBanner identity={{
      softwareVersion: '2.2.0-rc.1',
      sourceCommit: SOURCE_COMMIT,
      methodVersions: CURRENT_METHOD_VERSION_TUPLE,
    }} />)

    const identity = screen.getByLabelText('Local WebChess release identity')
    expect(identity).toHaveTextContent('webchess@2.2.0-rc.1')
    expect(identity).toHaveTextContent(`Source commit ${SOURCE_COMMIT}`)
    expect(identity).toHaveTextContent(
      Object.values(CURRENT_METHOD_VERSION_TUPLE).join(' · '),
    )
  })

  it.each([
    null,
    {
      softwareVersion: '2.2.0-rc.1' as const,
      sourceCommit: null,
      methodVersions: CURRENT_METHOD_VERSION_TUPLE,
    },
    {
      softwareVersion: '2.2.0-rc.1' as const,
      sourceCommit: SOURCE_COMMIT.slice(0, 12),
      methodVersions: CURRENT_METHOD_VERSION_TUPLE,
    },
  ])('labels an unresolved or invalid source identity unavailable', (identity) => {
    render(<OpenClawReleaseIdentityBanner identity={identity} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Source commit unavailable',
    )
    expect(screen.queryByText(SOURCE_COMMIT)).not.toBeInTheDocument()
  })
})
