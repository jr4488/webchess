import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import type { CellCoord, Stage } from '../../types'
import {
  BOARD_3D_CAMERA_FOV,
  boardCameraLookAt,
  boardCameraPosition,
} from './camera'
import { boardCellPosition } from './geometry'

const STAGES: readonly Stage[] = ['question', 'mapping', 'playing', 'reading']
const CELLS: readonly CellCoord[] = Array.from({ length: 64 }, (_, index) => ({
  ring: Math.floor(index / 8),
  sector: index % 8,
}))
const EDGE_FOCUS_POSITIONS = Array.from({ length: 8 }, (_, sector) => (
  boardCellPosition({ ring: 7, sector })
))

describe('three-dimensional board camera', () => {
  it('uses a clearly side-elevated view while preserving compass orientation', () => {
    for (const stage of STAGES) {
      const [x, y, z] = boardCameraPosition(stage)
      const [lookX, lookY, lookZ] = boardCameraLookAt(null, false)
      const elevation = Math.atan2(y - lookY, Math.hypot(x - lookX, z - lookZ)) * 180 / Math.PI

      expect(elevation).toBeGreaterThan(40)
      expect(elevation).toBeLessThan(50)
      expect(x).toBe(0)
      expect(z).toBeGreaterThan(0)
    }
  })

  it('projects north up, east right, south down, and west left', () => {
    const camera = new PerspectiveCamera(BOARD_3D_CAMERA_FOV, 1.35, 0.1, 48)
    camera.position.set(...boardCameraPosition('playing'))
    camera.lookAt(...boardCameraLookAt(null, false))
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()

    const north = new Vector3(...boardCellPosition({ ring: 7, sector: 0 })).project(camera)
    const east = new Vector3(...boardCellPosition({ ring: 7, sector: 2 })).project(camera)
    const south = new Vector3(...boardCellPosition({ ring: 7, sector: 4 })).project(camera)
    const west = new Vector3(...boardCellPosition({ ring: 7, sector: 6 })).project(camera)

    expect(north.y).toBeGreaterThan(0)
    expect(east.x).toBeGreaterThan(0)
    expect(south.y).toBeLessThan(0)
    expect(west.x).toBeLessThan(0)
  })

  it('keeps reduced-motion focus fixed on the neutral composition', () => {
    const edge = boardCellPosition({ ring: 7, sector: 2 })

    expect(boardCameraLookAt(edge, true)).toEqual(boardCameraLookAt(null, true))
    expect(boardCameraLookAt(edge, false)).not.toEqual(boardCameraLookAt(null, false))
  })

  it.each([
    ['desktop', 1.35],
    ['phone', 1.087],
  ] as const)('keeps all 64 cell centers usable in the %s composition', (_, aspect) => {
    for (const stage of STAGES) {
      const camera = new PerspectiveCamera(BOARD_3D_CAMERA_FOV, aspect, 0.1, 48)
      camera.position.set(...boardCameraPosition(stage))
      camera.updateProjectionMatrix()

      for (const focusPosition of [null, ...EDGE_FOCUS_POSITIONS]) {
        camera.lookAt(...boardCameraLookAt(focusPosition, false))
        camera.updateMatrixWorld()

        for (const cell of CELLS) {
          for (const height of [0, 1.2]) {
            const projected = new Vector3(...boardCellPosition(cell, height)).project(camera)
            expect(Math.abs(projected.x)).toBeLessThan(0.9)
            expect(Math.abs(projected.y)).toBeLessThan(0.9)
            expect(projected.z).toBeGreaterThan(-1)
            expect(projected.z).toBeLessThan(1)
          }
        }
      }
    }
  })
})
