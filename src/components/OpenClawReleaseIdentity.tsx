import styles from './OpenClawReleaseIdentity.module.css'

import type { CurrentMethodVersionTuple } from '../lib/lifecycle/method-versions.mjs'

const FULL_SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u

export interface OpenClawReleaseIdentity {
  readonly softwareVersion: '2.2.0-rc.1'
  readonly sourceCommit: string | null
  readonly methodVersions: CurrentMethodVersionTuple
}

export function OpenClawReleaseIdentityBanner({
  identity,
}: {
  identity: OpenClawReleaseIdentity | null
}) {
  const sourceCommit = identity?.sourceCommit ?? null
  const sourceAvailable = sourceCommit !== null &&
    FULL_SOURCE_COMMIT_PATTERN.test(sourceCommit)
  const methodVersionLabel = identity
    ? [
        identity.methodVersions.lifecycle,
        identity.methodVersions.divisionPrompt,
        identity.methodVersions.portiaPrompt,
        identity.methodVersions.portiaReview,
        identity.methodVersions.gateAlgorithm,
        identity.methodVersions.answerPrompt,
        identity.methodVersions.charlottePrompt,
      ].join(' · ')
    : null

  return (
    <aside
      className={styles.identity}
      aria-label="Local WebChess release identity"
    >
      <strong className={styles.software}>
        {identity
          ? `webchess@${identity.softwareVersion}`
          : 'WebChess software identity unavailable'}
      </strong>
      <span className={styles.source}>
        {sourceAvailable ? (
          <>
            Source commit <code>{sourceCommit}</code>
          </>
        ) : (
          <strong role="status">Source commit unavailable</strong>
        )}
      </span>
      {identity ? (
        <span className={styles.source}>
          Method tuple{' '}
          <code>{methodVersionLabel}</code>
        </span>
      ) : null}
    </aside>
  )
}
