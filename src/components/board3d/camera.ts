import type { Stage } from '../../types'

export const BOARD_3D_CAMERA_FOV = 48

export type Board3DCameraPosition = readonly [number, number, number]

const STAGE_CAMERA_POSITIONS: Readonly<Record<Stage, Board3DCameraPosition>> = {
  question: [0, 12.8, 13.9],
  mapping: [0, 13.2, 14.2],
  playing: [0, 12.5, 13.5],
  reading: [0, 12.8, 13.8],
}

const NEUTRAL_LOOK_AT: Board3DCameraPosition = [0, 0.2, 1.25]
const FOCUS_CONTRIBUTION = 0.06

export function boardCameraPosition(stage: Stage): Board3DCameraPosition {
  return STAGE_CAMERA_POSITIONS[stage]
}

export function boardCameraLookAt(
  focusPosition: Board3DCameraPosition | null,
  reducedMotion: boolean,
): Board3DCameraPosition {
  if (!focusPosition || reducedMotion) return NEUTRAL_LOOK_AT
  return [
    NEUTRAL_LOOK_AT[0] + focusPosition[0] * FOCUS_CONTRIBUTION,
    NEUTRAL_LOOK_AT[1],
    NEUTRAL_LOOK_AT[2] + focusPosition[2] * FOCUS_CONTRIBUTION,
  ]
}
