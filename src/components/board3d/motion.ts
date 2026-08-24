export type MotionPoint = readonly [number, number, number]

function clampProgress(progress: number) {
  return Math.max(0, Math.min(1, progress))
}

function easeOutCubic(progress: number) {
  const remaining = 1 - progress
  return 1 - remaining * remaining * remaining
}

export function captureMotionPoint(
  from: MotionPoint,
  to: MotionPoint,
  progress: number,
  isCapture: boolean,
): MotionPoint {
  const bounded = clampProgress(progress)
  if (bounded === 0) return from
  if (bounded === 1) return to
  const eased = easeOutCubic(bounded)
  const lift = Math.sin(Math.PI * bounded) * (isCapture ? 1.08 : 0.58)

  return [
    from[0] + (to[0] - from[0]) * eased,
    from[1] + (to[1] - from[1]) * eased + lift,
    from[2] + (to[2] - from[2]) * eased,
  ]
}

export function portiaTraversalPoint(
  from: MotionPoint,
  to: MotionPoint,
  progress: number,
): MotionPoint {
  const bounded = clampProgress(progress)
  if (bounded === 0) return from
  if (bounded === 1) return to
  const eased = bounded * bounded * (3 - 2 * bounded)
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  const distance = Math.hypot(dx, dz)
  const sideways = Math.sin(Math.PI * eased) * Math.min(0.52, distance * 0.08)
  const perpendicularX = distance === 0 ? 0 : -dz / distance
  const perpendicularZ = distance === 0 ? 0 : dx / distance
  const lift = Math.sin(Math.PI * eased) * Math.min(1.12, 0.58 + distance * 0.08)

  return [
    from[0] + dx * eased + perpendicularX * sideways,
    from[1] + (to[1] - from[1]) * eased + lift,
    from[2] + dz * eased + perpendicularZ * sideways,
  ]
}
