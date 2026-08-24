import { describe, expect, it } from 'vitest'

import {
  BOARD_3D_INNER_RADIUS,
  BOARD_3D_OUTER_RADIUS,
  boardCellIndex,
  boardCellPosition,
  createBoardCellShape,
  createWebGeometry,
} from './geometry'

describe('3D board geometry', () => {
  it('maps all radial coordinates to stable board indices and positions', () => {
    expect(boardCellIndex({ ring: 0, sector: 0 })).toBe(0)
    expect(boardCellIndex({ ring: 7, sector: 7 })).toBe(63)

    const north = boardCellPosition({ ring: 0, sector: 0 })
    const east = boardCellPosition({ ring: 0, sector: 2 })
    expect(north[0]).toBeCloseTo(0)
    expect(north[2]).toBeLessThan(-BOARD_3D_INNER_RADIUS)
    expect(east[0]).toBeGreaterThan(BOARD_3D_INNER_RADIUS)
    expect(east[2]).toBeCloseTo(0)
  })

  it('creates closed annular cell shapes inside the board radius', () => {
    const shape = createBoardCellShape({ ring: 7, sector: 3 })
    const points = shape.getPoints()
    expect(points.length).toBeGreaterThan(10)
    for (const point of points) {
      expect(Math.hypot(point.x, point.y)).toBeLessThan(BOARD_3D_OUTER_RADIUS)
    }
  })

  it('builds the radial and concentric luminous web as line pairs', () => {
    const geometry = createWebGeometry()
    const positions = geometry.getAttribute('position')
    expect(positions.count).toBeGreaterThan(1_000)
    expect(positions.count % 2).toBe(0)
  })
})
