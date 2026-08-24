import { BufferGeometry, Float32BufferAttribute, Shape } from 'three'

import type { CellCoord } from '../../types'

export const BOARD_3D_INNER_RADIUS = 1.18
export const BOARD_3D_OUTER_RADIUS = 5.72
export const BOARD_3D_RING_COUNT = 8
export const BOARD_3D_SECTOR_COUNT = 8
export const BOARD_3D_RING_WIDTH = (
  BOARD_3D_OUTER_RADIUS - BOARD_3D_INNER_RADIUS
) / BOARD_3D_RING_COUNT

const SECTOR_RADIANS = (Math.PI * 2) / BOARD_3D_SECTOR_COUNT
const CELL_ANGLE_GAP = 0.018
const CELL_RING_GAP = 0.035

export function boardCellIndex(cell: CellCoord): number {
  return cell.ring * BOARD_3D_SECTOR_COUNT + cell.sector
}

export function boardCellPosition(
  cell: CellCoord,
  height = 0,
): [number, number, number] {
  const radius = BOARD_3D_INNER_RADIUS + (cell.ring + 0.5) * BOARD_3D_RING_WIDTH
  const angle = cell.sector * SECTOR_RADIANS
  return [Math.sin(angle) * radius, height, -Math.cos(angle) * radius]
}

function shapePoint(radius: number, angle: number): [number, number] {
  // The shape is created in XY and rotated onto Three's XZ floor. Positive
  // shape-Y therefore maps to negative world-Z, keeping sector zero at north.
  return [Math.sin(angle) * radius, Math.cos(angle) * radius]
}

export function createBoardCellShape(cell: CellCoord): Shape {
  const innerRadius = (
    BOARD_3D_INNER_RADIUS + cell.ring * BOARD_3D_RING_WIDTH + CELL_RING_GAP
  )
  const outerRadius = (
    BOARD_3D_INNER_RADIUS + (cell.ring + 1) * BOARD_3D_RING_WIDTH - CELL_RING_GAP
  )
  const centerAngle = cell.sector * SECTOR_RADIANS
  const startAngle = centerAngle - SECTOR_RADIANS / 2 + CELL_ANGLE_GAP
  const endAngle = centerAngle + SECTOR_RADIANS / 2 - CELL_ANGLE_GAP
  const segments = 7
  const shape = new Shape()

  const [outerStartX, outerStartY] = shapePoint(outerRadius, startAngle)
  shape.moveTo(outerStartX, outerStartY)

  for (let step = 1; step <= segments; step += 1) {
    const angle = startAngle + ((endAngle - startAngle) * step) / segments
    const [x, y] = shapePoint(outerRadius, angle)
    shape.lineTo(x, y)
  }

  for (let step = segments; step >= 0; step -= 1) {
    const angle = startAngle + ((endAngle - startAngle) * step) / segments
    const [x, y] = shapePoint(innerRadius, angle)
    shape.lineTo(x, y)
  }

  shape.closePath()
  return shape
}

export function createWebGeometry(): BufferGeometry {
  const vertices: number[] = []
  const radialStart = 0.46

  for (let sector = 0; sector < BOARD_3D_SECTOR_COUNT; sector += 1) {
    const angle = sector * SECTOR_RADIANS
    vertices.push(
      Math.sin(angle) * radialStart, 0.02, -Math.cos(angle) * radialStart,
      Math.sin(angle) * (BOARD_3D_OUTER_RADIUS + 0.38), 0.02,
      -Math.cos(angle) * (BOARD_3D_OUTER_RADIUS + 0.38),
    )
  }

  for (let ring = 0; ring <= BOARD_3D_RING_COUNT; ring += 1) {
    const radius = BOARD_3D_INNER_RADIUS + ring * BOARD_3D_RING_WIDTH
    const segments = 64
    for (let segment = 0; segment < segments; segment += 1) {
      const start = (segment / segments) * Math.PI * 2
      const end = ((segment + 1) / segments) * Math.PI * 2
      vertices.push(
        Math.sin(start) * radius, 0.02, -Math.cos(start) * radius,
        Math.sin(end) * radius, 0.02, -Math.cos(end) * radius,
      )
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  return geometry
}
