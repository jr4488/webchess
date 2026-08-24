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

  it('keeps a non-capture arc lower while still lifting it off the board', () => {
    const from = [0, 0.2, 0] as const
    const to = [4, 0.2, -2] as const

    const captureMidpoint = captureMotionPoint(from, to, 0.5, true)
    const moveMidpoint = captureMotionPoint(from, to, 0.5, false)

    expect(moveMidpoint[1]).toBeGreaterThan(from[1])
    expect(moveMidpoint[1]).toBeLessThan(captureMidpoint[1])
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

  it('does not add lateral drift to a zero-distance Portia traversal', () => {
    const point = [2, 0.62, -1] as const

    const midpoint = portiaTraversalPoint(point, point, 0.5)

    expect(midpoint[0]).toBe(point[0])
    expect(midpoint[1]).toBeGreaterThan(point[1])
    expect(midpoint[2]).toBe(point[2])
  })
})
