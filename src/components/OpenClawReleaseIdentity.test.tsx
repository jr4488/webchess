import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { OpenClawReleaseIdentityBanner } from './OpenClawReleaseIdentity'

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567'

describe('OpenClaw release identity banner', () => {
  it('visibly exposes the exact software release and full reviewed source commit', () => {
    render(<OpenClawReleaseIdentityBanner identity={{
      softwareVersion: '2.2.0-rc.1',
      sourceCommit: SOURCE_COMMIT,
    }} />)

    const identity = screen.getByLabelText('Local WebChess release identity')
    expect(identity).toHaveTextContent('webchess@2.2.0-rc.1')
    expect(identity).toHaveTextContent(`Source commit ${SOURCE_COMMIT}`)
  })

  it.each([
    null,
    {
      softwareVersion: '2.2.0-rc.1' as const,
      sourceCommit: null,
    },
    {
      softwareVersion: '2.2.0-rc.1' as const,
      sourceCommit: SOURCE_COMMIT.slice(0, 12),
    },
  ])('labels an unresolved or invalid source identity unavailable', (identity) => {
    render(<OpenClawReleaseIdentityBanner identity={identity} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Source commit unavailable',
    )
    expect(screen.queryByText(SOURCE_COMMIT)).not.toBeInTheDocument()
  })
})
