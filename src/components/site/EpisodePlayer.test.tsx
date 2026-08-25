import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EpisodePlayer } from './EpisodePlayer'

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: globalThis.matchMedia,
  })
  Object.defineProperty(SVGElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('public illustrative episode', () => {
  it('describes the full directional record without treating it as evidence', () => {
    render(<EpisodePlayer />)

    expect(screen.getByText(/Every move, pass, capture, piece value/)).toHaveTextContent(
      'replay-verifiable directional record',
    )
    expect(screen.getByText(/Code ranks cast-qualified directions/)).toHaveTextContent(
      'auditable criteria and amendments',
    )
    expect(screen.getByText(/Direction is not factual evidence/)).toBeVisible()
    expect(screen.getByRole('img')).toHaveAccessibleName(
      /complete circular trajectory, derived directional scrutiny/,
    )
  })
})
