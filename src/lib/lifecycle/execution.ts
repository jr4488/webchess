import type { LifecycleAggregate, LifecycleVersions } from './contracts'
import { CURRENT_LIFECYCLE_VERSIONS } from './versions'

/**
 * Historical lifecycle rows remain parseable for inspection and export, but
 * only one exact contract tuple is executable by the current application.
 */
export function hasCurrentLifecycleExecutionVersions(
  versions: LifecycleVersions,
): boolean {
  return hasCurrentLifecycleBaseVersions(versions) &&
    versions.trajectoryDirectionalRecord ===
      CURRENT_LIFECYCLE_VERSIONS.trajectoryDirectionalRecord
}

/**
 * Exact current tuple before the terminal trajectory record is atomically
 * bound. A freshly completed game may legitimately retain a null trajectory
 * version during the single interrupted chess-playing -> terminal CAS.
 */
export function hasCurrentLifecycleBaseVersions(
  versions: LifecycleVersions,
): boolean {
  return versions.software === CURRENT_LIFECYCLE_VERSIONS.software &&
    versions.lifecycle === CURRENT_LIFECYCLE_VERSIONS.lifecycle &&
    versions.portiaPrompt === CURRENT_LIFECYCLE_VERSIONS.portiaPrompt &&
    versions.portiaContract === CURRENT_LIFECYCLE_VERSIONS.portiaContract &&
    versions.gateAlgorithm === CURRENT_LIFECYCLE_VERSIONS.gateAlgorithm &&
    versions.retryPolicy === CURRENT_LIFECYCLE_VERSIONS.retryPolicy &&
    versions.charlottePrompt === CURRENT_LIFECYCLE_VERSIONS.charlottePrompt &&
    versions.charlotteContract === CURRENT_LIFECYCLE_VERSIONS.charlotteContract &&
    versions.wilburRecord === CURRENT_LIFECYCLE_VERSIONS.wilburRecord &&
    versions.event === CURRENT_LIFECYCLE_VERSIONS.lifecycleEvent
}

/**
 * Client-side action gate. The server independently replays and verifies the
 * complete record before permitting any lifecycle mutation or provider call.
 */
export function isCurrentLifecycleExecutable(
  lifecycle: LifecycleAggregate,
): boolean {
  return hasCurrentLifecycleExecutionVersions(lifecycle.versions) &&
    lifecycle.trajectoryDirectionalRecordStatus === 'bound' &&
    lifecycle.trajectoryDirectionalRecord?.version ===
      CURRENT_LIFECYCLE_VERSIONS.trajectoryDirectionalRecord
}
