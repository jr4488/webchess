import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { beginModelActivity } from '../lib/model-activity'
import { ModelActivityPanel } from './ModelActivityPanel'

describe('ModelActivityPanel', () => {
  it('shows truthful server progress without claiming a reasoning stream', () => {
    render(
      <ModelActivityPanel
        activity={beginModelActivity('division', Date.now())}
        modelLabel="gpt-5.6-sol"
        providerLabel="OpenAI API"
        summary="Preparing exactly 64 problem-specific facets."
        metrics={[{ label: 'Facets', value: '64 requested' }]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Model request' })).toBeInTheDocument()
    expect(screen.getByText('gpt-5.6-sol via OpenAI API')).toBeInTheDocument()
    expect(screen.getByText('64 requested')).toBeInTheDocument()
    expect(screen.getByText('Request in progress')).toBeInTheDocument()
    expect(screen.getByText(/private chain-of-thought and unvalidated drafts are not exposed/i))
      .toBeInTheDocument()
    expect(screen.queryByText(/request accepted|live reasoning|model thinking|heartbeat/i))
      .not.toBeInTheDocument()
  })

  it('renders an honest terminal error without a fabricated phase timeline', () => {
    render(
      <ModelActivityPanel
        activity={{
          ...beginModelActivity('answer', 1_000),
          status: 'error',
          lastUpdatedAt: 3_000,
        }}
        modelLabel="gpt-5.6-sol"
        providerLabel="OpenAI API"
        summary="No validated answer was returned."
      />,
    )

    expect(screen.getByText('Request ended')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Model request timeline' }))
      .not.toBeInTheDocument()
  })
})
