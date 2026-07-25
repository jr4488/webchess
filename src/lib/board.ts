import type { CellCoord } from '../types'

export type CellKey = `${number}:${number}`

export function cellKey(cell: CellCoord): CellKey {
  return `${cell.ring}:${cell.sector}`
}
