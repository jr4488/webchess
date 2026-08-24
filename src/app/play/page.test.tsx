import { describe, expect, it, vi } from 'vitest'

const navigationMocks = vi.hoisted(() => ({
  permanentRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('next/navigation', () => ({
  permanentRedirect: navigationMocks.permanentRedirect,
}))

import PlayPage from './page'

describe('retired hosted play route', () => {
  it('permanently redirects readers to the supported local installation path', () => {
    expect(() => PlayPage()).toThrow('NEXT_REDIRECT')
    expect(navigationMocks.permanentRedirect).toHaveBeenCalledOnce()
    expect(navigationMocks.permanentRedirect).toHaveBeenCalledWith('/install')
  })
})
