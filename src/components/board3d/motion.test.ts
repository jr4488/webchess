import { describe, expect, it } from 'vitest'

import { captureMotionPoint, portiaTraversalPoint } from './motion'

describe('three-dimensional board motion', () => {
  it('moves a capture through a readable arc and settles exactly on its target', () => {
    const from = [0, 0.2, 0] as const
    const to = [4, 0.2, -2] as const

    expect(captureMotionPoint(from, to, 0, true)).toEqual(from)
    expect(captureMotionPoint(from, to, 0.5, true)[1]).toBeGreaterThan(1)
    expect(captureMotionPoint(from, to, 1, true)).toEqual(to)
  })

  it('gives Portia a lifted curved traversal while preserving exact endpoints', () => {
    const from = [-3, 0.62, 1] as const
    const to = [3, 0.62, -2] as const

    expect(portiaTraversalPoint(from, to, 0)).toEqual(from)
    const midpoint = portiaTraversalPoint(from, to, 0.5)
    expect(midpoint[1]).toBeGreaterThan(1.4)
    expect(midpoint[0]).not.toBeCloseTo(0, 3)
    expect(portiaTraversalPoint(from, to, 1)).toEqual(to)
  })
})
