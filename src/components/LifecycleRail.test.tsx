import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  GateRecommendation,
  LifecycleAggregate,
  LifecycleState,
} from '../lib/lifecycle/contracts'
import { LifecycleRail } from './LifecycleRail'

afterEach(() => {
  vi.unstubAllGlobals()
})

function aggregate(
  state: LifecycleState,
  retryCounts: { sameFieldRetryCount: number; fieldRegenerationCount: number } = {
    sameFieldRetryCount: 0,
    fieldRegenerationCount: 0,
  },
  recommendation: GateRecommendation = 'retry_game',
): LifecycleAggregate {
  return {
    state,
    ...retryCounts,
    gate: state === 'gate_passed'
      ? { passed: true }
      : state === 'gate_failed' || state === 'insufficient_basis'
        ? { passed: false, recommendedNextTransition: recommendation }
        : null,
  } as unknown as LifecycleAggregate
}

describe('LifecycleRail', () => {
  it('keeps Portia active when a saved stop still has a bounded repair path', () => {
    const lifecycle = {
      ...aggregate('insufficient_basis', {
        sameFieldRetryCount: 0,
        fieldRegenerationCount: 0,
      }, 'insufficient_basis'),
      portia: { promptDecision: 'deny' },
    } as LifecycleAggregate

    render(<LifecycleRail lifecycle={lifecycle} />)

    const rail = screen.getByRole('region', { name: 'WebChess lifecycle progress' })
    expect(rail).toHaveAttribute('data-lifecycle-terminal', 'false')
    expect(screen.getByText('Portia').closest('li')).toHaveClass('is-active')
    expect(screen.getByRole('status')).toHaveTextContent(
      /one bounded field rebuild remains before Answer/i,
    )
  })

  it('shows the corrected seven-stage lifecycle and exposes the active step', () => {
    const { container } = render(
      <LifecycleRail lifecycle={aggregate('charlotte_running')} gameStatus="answered" />,
    )

    for (const label of [
      'Anansi',
      'Chess',
      'Portia',
      'Answer',
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
    expect(container.querySelectorAll('.lifecycle-step')).toHaveLength(7)
    expect(screen.queryByText('Gate')).not.toBeInTheDocument()
    expect(screen.queryByText('Retry')).not.toBeInTheDocument()
  })

  it.each([
    [
      'ready',
      'completed' as const,
      'ready to generate',
      /approved board prompt is ready.*generation has not started/i,
    ],
    [
      'generating',
      'answering' as const,
      'generation in progress',
      /board-derived answer generation is in progress/i,
    ],
    [
      'failed and retryable',
      'answer_failed' as const,
      'generation failed',
      /board-derived answer generation failed and is ready to retry/i,
    ],
  ])('keeps Answer active while the permitted board answer is %s', (
    _label,
    gameStatus,
    detail,
    announcement,
  ) => {
    render(
      <LifecycleRail lifecycle={aggregate('gate_passed')} gameStatus={gameStatus} />,
    )

    const answer = screen.getByText('Answer').closest('li')
    expect(answer).toHaveClass('is-active')
    expect(answer).toHaveAttribute('aria-current', 'step')
    expect(answer).toHaveTextContent(detail)
    expect(screen.getByText('Charlotte').closest('li')).toHaveClass('is-waiting')
    expect(screen.getByRole('status')).toHaveTextContent(announcement)
  })

  it('advances from Answer to Charlotte only after the board answer exists', () => {
    render(
      <LifecycleRail lifecycle={aggregate('gate_passed')} gameStatus="answered" />,
    )

    expect(screen.getByText('Answer').closest('li')).toHaveClass('is-complete')
    expect(screen.getByText('Charlotte').closest('li')).toHaveClass('is-active')
    expect(screen.getByText('Charlotte').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      /Charlotte: the generated Board Answer is ready for Charlotte\u2019s final review/i,
    )
  })

  it.each([
    ['smoothly', false, 'smooth' as const],
    ['without motion', true, 'auto' as const],
  ])('brings a newly active step into a narrow rail %s', (
    _label,
    reducedMotion,
    behavior,
  ) => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: reducedMotion }))
    const { rerender } = render(
      <LifecycleRail lifecycle={aggregate('anansi_pending')} />,
    )
    const rail = screen.getByRole('region', { name: 'WebChess lifecycle progress' })
    const charlotte = screen.getByText('Charlotte').closest('li')
    if (!charlotte) throw new Error('Charlotte lifecycle step was not rendered.')
    const scrollTo = vi.fn()

    Object.defineProperties(rail, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 680 },
      scrollTo: { configurable: true, value: scrollTo },
    })
    Object.defineProperties(charlotte, {
      clientWidth: { configurable: true, value: 80 },
      offsetLeft: { configurable: true, value: 500 },
    })

    rerender(
      <LifecycleRail lifecycle={aggregate('charlotte_running')} gameStatus="answered" />,
    )

    expect(scrollTo).toHaveBeenCalledWith({ left: 380, behavior })
  })

  it.each([
    ['a persisted terminal state', 'insufficient_basis' as const, 'retry_game' as const],
    ['an insufficient Gate recommendation', 'gate_failed' as const, 'insufficient_basis' as const],
  ])('settles at Portia with no generated answer for %s', (_label, state, recommendation) => {
    const { container } = render(
      <LifecycleRail lifecycle={aggregate(state, {
        sameFieldRetryCount: 3,
        fieldRegenerationCount: 2,
      }, recommendation)} />,
    )

    const rail = screen.getByRole('region', { name: 'WebChess lifecycle progress' })
    const portia = screen.getByText('Portia').closest('li')
    const answer = screen.getByText('Answer').closest('li')
    const spider = container.querySelector<HTMLElement>('.lifecycle-spider')
    const prey = container.querySelector<HTMLElement>('.lifecycle-prey')

    expect(rail).toHaveAttribute('data-lifecycle-terminal', 'true')
    expect(portia).toHaveClass('is-terminal')
    expect(portia).toHaveAttribute('aria-current', 'step')
    expect(portia).toHaveTextContent('bounded stop')
    expect(answer).toHaveClass('is-waiting')
    expect(spider?.style.getPropertyValue('--lifecycle-position')).toBe(
      prey?.style.getPropertyValue('--lifecycle-position'),
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      /ended after Portia.*insufficient basis.*No answer was generated/i,
    )
  })

  it('terminates at Portia when prompt validation is operationally unavailable', () => {
    const { container } = render(
      <LifecycleRail lifecycle={aggregate('portia_unavailable')} />,
    )

    const rail = screen.getByRole('region', { name: 'WebChess lifecycle progress' })
    const portia = screen.getByText('Portia').closest('li')
    const answer = screen.getByText('Answer').closest('li')
    const charlotte = screen.getByText('Charlotte').closest('li')
    const spider = container.querySelector<HTMLElement>('.lifecycle-spider')
    const prey = container.querySelector<HTMLElement>('.lifecycle-prey')

    expect(rail).toHaveAttribute('data-lifecycle-terminal', 'true')
    expect(portia).toHaveClass('is-terminal')
    expect(portia).toHaveAttribute('aria-current', 'step')
    expect(portia).toHaveTextContent('validation unavailable')
    expect(answer).toHaveClass('is-waiting')
    expect(answer).not.toHaveClass('is-complete')
    expect(charlotte).toHaveClass('is-waiting')
    expect(charlotte).not.toHaveClass('is-complete')
    expect(spider?.style.getPropertyValue('--lifecycle-position')).toBe(
      prey?.style.getPropertyValue('--lifecycle-position'),
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      /stopped at Portia.*prompt validation was unavailable.*bounded provider-attempt budget.*No answer was generated/i,
    )
  })

  it('settles at Charlotte while preserving the completed board Answer', () => {
    const { container } = render(
      <LifecycleRail
        lifecycle={aggregate('charlotte_unavailable')}
        gameStatus="answered"
      />,
    )

    const rail = screen.getByRole('region', { name: 'WebChess lifecycle progress' })
    const answer = screen.getByText('Answer').closest('li')
    const charlotte = screen.getByText('Charlotte').closest('li')
    const wilbur = screen.getByText('Wilbur').closest('li')
    const web = screen.getByText('Web').closest('li')
    const spider = container.querySelector<HTMLElement>('.lifecycle-spider')
    const prey = container.querySelector<HTMLElement>('.lifecycle-prey')

    expect(rail).toHaveAttribute('data-lifecycle-terminal', 'true')
    expect(answer).toHaveClass('is-complete')
    expect(answer).toHaveTextContent('generated from the board')
    expect(charlotte).toHaveClass('is-terminal')
    expect(charlotte).toHaveAttribute('aria-current', 'step')
    expect(charlotte).toHaveTextContent('qualification unavailable')
    expect(wilbur).toHaveClass('is-waiting')
    expect(web).toHaveClass('is-waiting')
    expect(spider?.style.getPropertyValue('--lifecycle-position')).toBe(
      prey?.style.getPropertyValue('--lifecycle-position'),
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      /stopped at Charlotte.*audience qualification was unavailable.*board-derived Answer remains available.*not Charlotte-qualified.*Wilbur and Web are waiting/i,
    )
  })
})
