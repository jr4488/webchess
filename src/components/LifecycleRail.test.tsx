import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { LifecycleAggregate, LifecycleState } from '../lib/lifecycle/contracts'
import { LifecycleRail } from './LifecycleRail'

function aggregate(
  state: LifecycleState,
  retryCounts: { sameFieldRetryCount: number; fieldRegenerationCount: number } = {
    sameFieldRetryCount: 0,
    fieldRegenerationCount: 0,
  },
): LifecycleAggregate {
  return {
    state,
    ...retryCounts,
    gate: state === 'gate_passed'
      ? { passed: true }
      : state === 'gate_failed'
        ? { passed: false }
        : null,
  } as unknown as LifecycleAggregate
}

describe('LifecycleRail', () => {
  it('shows all eight named lifecycle stages and exposes the active step', () => {
    render(<LifecycleRail lifecycle={aggregate('charlotte_running')} />)

    for (const label of [
      'Anansi',
      'Chess',
      'Portia',
      'Gate',
      'Retry',
      'Charlotte',
      'Wilbur',
      'Web',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('Charlotte').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      /Charlotte: charlotte running/i,
    )
  })

  it('marks Retry as not needed after a Gate pass', () => {
    render(<LifecycleRail lifecycle={aggregate('gate_passed')} />)

    expect(screen.getByText('Retry').closest('li')).toHaveClass('is-skipped')
    expect(screen.getByText('not needed')).toBeInTheDocument()
  })

  it('keeps Retry in the completed thread when an ancestor used the budget', () => {
    render(<LifecycleRail lifecycle={aggregate('wilbur_observed', {
      sameFieldRetryCount: 1,
      fieldRegenerationCount: 0,
    })} />)

    expect(screen.getByText('Retry').closest('li')).toHaveClass('is-complete')
    expect(screen.queryByText('not needed')).not.toBeInTheDocument()
  })

  it('keeps a failed Gate visible rather than presenting it as completion', () => {
    render(<LifecycleRail lifecycle={aggregate('gate_failed')} />)

    expect(screen.getByText('Gate').closest('li')).toHaveClass('is-failed')
    expect(screen.getByText('Gate').closest('li')).toHaveTextContent('failed')
  })
})
