import styles from './OpenClawReleaseIdentity.module.css'

const FULL_SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u

export interface OpenClawReleaseIdentity {
  readonly softwareVersion: '2.2.0-rc.1'
  readonly sourceCommit: string | null
}

export function OpenClawReleaseIdentityBanner({
  identity,
}: {
  identity: OpenClawReleaseIdentity | null
}) {
  const sourceCommit = identity?.sourceCommit ?? null
  const sourceAvailable = sourceCommit !== null &&
    FULL_SOURCE_COMMIT_PATTERN.test(sourceCommit)

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
    </aside>
  )
}
