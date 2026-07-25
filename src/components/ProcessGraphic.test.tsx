import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProcessGraphic } from './ProcessGraphic'

const METRICS = [
  { label: 'Facets', value: 64 },
  { label: 'Board', value: 'Working' },
]

describe('ProcessGraphic', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows truthful elapsed time for indeterminate model work', async () => {
    vi.useFakeTimers()
    const { container } = render(
      <ProcessGraphic
        mode="analyzing"
        headline="Sol is finding candidate facets"
        active
        metrics={METRICS}
      />,
    )

    expect(screen.getByLabelText(/sol is finding candidate facets/i)).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelectorAll('.process-graphic__nodes > span')).toHaveLength(64)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByText('0s')).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(screen.getByText('2s')).toBeInTheDocument()
  })

  it('renders real casting progress across the 64-node graphic', () => {
    const { container } = render(
      <ProcessGraphic
        mode="casting"
        headline="Casting the board"
        active
        metrics={METRICS}
        progress={23}
        max={64}
        progressLabel="Board cells cast"
      />,
    )

    expect(screen.getByRole('progressbar', { name: /board cells cast/i })).toHaveAttribute('aria-valuenow', '23')
    expect(container.querySelectorAll('.process-graphic__nodes > span.is-filled')).toHaveLength(23)
    expect(screen.getByText('23/64')).toBeInTheDocument()
  })

  it('gives repeated conflicts increasing visual heat without pretending the game is complete', () => {
    const { container } = render(
      <ProcessGraphic
        mode="autoplay"
        headline="Choosing the next move"
        active
        metrics={METRICS}
        progress={7}
        max={7}
        progressLabel="Captured signal depth"
        progressText="14 signals"
        progressValueText="14 signals gathered; 7 marks reflection depth but does not end the game."
        activeIndices={[4, 4, 4, 18]}
      />,
    )

    expect(screen.getByText('14 signals')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      '14 signals gathered; 7 marks reflection depth but does not end the game.',
    )
    expect(container.querySelector('[data-heat="3"]')).toBeInTheDocument()
    expect(container.querySelector('[data-heat="1"]')).toBeInTheDocument()
  })
})
