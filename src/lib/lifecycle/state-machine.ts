import type { LifecycleState } from './contracts'

const TRANSITIONS: Readonly<Record<LifecycleState, ReadonlySet<LifecycleState>>> = {
  anansi_pending: new Set(['anansi_running', 'abandoned']),
  anansi_running: new Set(['field_ready', 'abandoned']),
  field_ready: new Set(['chess_ready', 'abandoned']),
  chess_ready: new Set(['chess_playing', 'abandoned']),
  chess_playing: new Set(['chess_terminal', 'abandoned']),
  chess_terminal: new Set(['portia_pending', 'abandoned']),
  portia_pending: new Set(['portia_running', 'abandoned']),
  portia_running: new Set(['portia_complete', 'portia_pending', 'portia_unavailable', 'abandoned']),
  portia_unavailable: new Set(['abandoned']),
  portia_complete: new Set(['gate_passed', 'gate_failed', 'abandoned']),
  gate_passed: new Set(['charlotte_pending', 'abandoned']),
  gate_failed: new Set(['retry_ready', 'insufficient_basis', 'abandoned']),
  retry_ready: new Set(['retry_running', 'insufficient_basis', 'abandoned']),
  retry_running: new Set(['anansi_pending', 'chess_ready', 'insufficient_basis', 'abandoned']),
  charlotte_pending: new Set(['charlotte_running', 'abandoned']),
  charlotte_running: new Set(['charlotte_complete', 'charlotte_pending', 'charlotte_unavailable', 'abandoned']),
  charlotte_unavailable: new Set(['abandoned']),
  charlotte_complete: new Set(['wilbur_planning', 'abandoned']),
  wilbur_planning: new Set(['wilbur_in_progress', 'wilbur_observed', 'abandoned']),
  wilbur_in_progress: new Set(['wilbur_observed', 'abandoned']),
  wilbur_observed: new Set(['wilbur_in_progress', 'abandoned']),
  insufficient_basis: new Set(['abandoned']),
  abandoned: new Set(),
}

export class LifecycleTransitionError extends Error {
  constructor(
    readonly from: LifecycleState,
    readonly to: LifecycleState,
  ) {
    super(`Illegal WebChess lifecycle transition: ${from} -> ${to}.`)
    this.name = 'LifecycleTransitionError'
  }
}

export function canTransitionLifecycle(
  from: LifecycleState,
  to: LifecycleState,
): boolean {
  return from === to || TRANSITIONS[from].has(to)
}

export function assertLifecycleTransition(
  from: LifecycleState,
  to: LifecycleState,
): void {
  if (!canTransitionLifecycle(from, to)) {
    throw new LifecycleTransitionError(from, to)
  }
}

export function lifecycleTransitionsFrom(
  state: LifecycleState,
): readonly LifecycleState[] {
  return [...TRANSITIONS[state]]
}
