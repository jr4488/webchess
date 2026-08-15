'use client'

import { UserProfile, useClerk, useUser } from '@clerk/nextjs'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import styles from './AccountDashboard.module.css'

const DELETE_CONFIRMATION = 'DELETE MY WEBCHESS DATA'
const USER_PROFILE_APPEARANCE = {
  elements: {
    rootBox: styles.profileRoot,
    cardBox: styles.profileCard,
  },
} as const

type IdentityMode = 'clerk' | 'local-e2e' | 'local-openclaw' | 'local-hosted'

interface AccountDashboardProps {
  identityMode: IdentityMode
}

interface QuotaValue {
  used: number
  reserved: number
  limit: number
  remaining: number
}

interface Usage {
  period: {
    startsAt: string
    endsAt: string
  }
  modelOperations: QuotaValue
  gameStarts: QuotaValue
  activeModelRequests: number
}

interface UsageResponse {
  usage: Usage
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isQuotaValue(value: unknown): value is QuotaValue {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<QuotaValue>
  return (
    isFiniteNonNegativeNumber(candidate.used) &&
    isFiniteNonNegativeNumber(candidate.reserved) &&
    isFiniteNonNegativeNumber(candidate.limit) &&
    isFiniteNonNegativeNumber(candidate.remaining)
  )
}

function isUsageResponse(value: unknown): value is UsageResponse {
  if (!value || typeof value !== 'object') {
    return false
  }

  const usage = (value as Partial<UsageResponse>).usage
  if (!usage || typeof usage !== 'object') {
    return false
  }

  const period = usage.period
  return (
    !!period &&
    typeof period.startsAt === 'string' &&
    typeof period.endsAt === 'string' &&
    isQuotaValue(usage.modelOperations) &&
    isQuotaValue(usage.gameStarts) &&
    isFiniteNonNegativeNumber(usage.activeModelRequests)
  )
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function QuotaMeter({
  label,
  quota,
}: Readonly<{ label: string; quota: QuotaValue }>) {
  const maximum = Math.max(1, quota.limit)
  const current = Math.min(quota.used + quota.reserved, maximum)

  return (
    <div className={styles.quota}>
      <div className={styles.quotaHeading}>
        <h3>{label}</h3>
        <p>
          <strong>{quota.remaining}</strong> remaining
        </p>
      </div>
      <progress
        aria-label={`${label}: ${quota.used} used and ${quota.reserved} reserved of ${quota.limit}`}
        max={maximum}
        value={current}
      />
      <p className={styles.quotaDetail}>
        {quota.used} used
        {quota.reserved > 0 ? `, ${quota.reserved} in progress` : ''} of{' '}
        {quota.limit} in this period
      </p>
    </div>
  )
}

function UsageSummary() {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const requestRef = useRef<AbortController | null>(null)

  const loadUsage = useCallback(async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller

    try {
      const response = await fetch('/api/account/usage', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? 'Your session has ended. Sign in again to review usage.'
            : 'Usage is temporarily unavailable.',
        )
      }

      const payload: unknown = await response.json()
      if (!isUsageResponse(payload)) {
        throw new Error('The usage service returned an unexpected response.')
      }
      if (
        controller.signal.aborted ||
        requestRef.current !== controller
      ) {
        return
      }

      setUsage(payload.usage)
      setError(null)
    } catch (requestError) {
      if (
        controller.signal.aborted ||
        requestRef.current !== controller ||
        (requestError instanceof DOMException && requestError.name === 'AbortError')
      ) {
        return
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Usage is temporarily unavailable.',
      )
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
      }
      if (!controller.signal.aborted) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) void loadUsage()
    })
    return () => {
      active = false
      requestRef.current?.abort()
      requestRef.current = null
    }
  }, [loadUsage])

  const retryUsage = () => {
    setLoading(true)
    setError(null)
    void loadUsage()
  }

  return (
    <section className={styles.card} aria-labelledby="usage-title">
      <div className={styles.cardHeading}>
        <div>
          <p className={styles.sectionNumber}>01</p>
          <h2 id="usage-title">Current usage</h2>
        </div>
        {usage ? (
          <p className={styles.period}>
            Resets{' '}
            <time dateTime={usage.period.endsAt}>
              {formatDateTime(usage.period.endsAt)}
            </time>
          </p>
        ) : null}
      </div>

      {loading ? (
        <p className={styles.status} role="status">
          Loading your allowance…
        </p>
      ) : null}

      {error ? (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          <button type="button" onClick={retryUsage}>
            Try again
          </button>
        </div>
      ) : null}

      {usage && !loading ? (
        <>
          <div className={styles.quotas}>
            <QuotaMeter label="Model operations" quota={usage.modelOperations} />
            <QuotaMeter label="New games" quota={usage.gameStarts} />
          </div>
          <p className={styles.activity}>
            Active model requests: <strong>{usage.activeModelRequests}</strong>
          </p>
        </>
      ) : null}
    </section>
  )
}

function DataExport() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const downloadExport = async () => {
    if (busy) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      const response = await fetch('/api/account/export', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })

      if (!response.ok) {
        throw await responseError(
          response,
          'WebChess could not prepare your data export.',
        )
      }

      const disposition = response.headers.get('content-disposition') ?? ''
      const matchedFileName = disposition.match(
        /filename="(webchess-export-\d{4}-\d{2}-\d{2}\.json)"/i,
      )?.[1]
      const fileName = matchedFileName ?? 'webchess-export.json'
      const objectUrl = URL.createObjectURL(await response.blob())
      const downloadLink = document.createElement('a')

      downloadLink.href = objectUrl
      downloadLink.download = fileName
      downloadLink.hidden = true
      document.body.append(downloadLink)
      try {
        downloadLink.click()
      } finally {
        downloadLink.remove()
        // Chromium may not consume a synthetic download immediately.
        // Retain the bounded export briefly so a busy browser cannot lose it.
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
      }
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : 'WebChess could not prepare your data export.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.card} aria-labelledby="export-title">
      <div className={styles.cardHeading}>
        <div>
          <p className={styles.sectionNumber}>02</p>
          <h2 id="export-title">Export your data</h2>
        </div>
      </div>
      <p className={styles.bodyCopy}>
        Download a JSON copy of the WebChess information associated with your
        signed-in account. The export is produced on demand and requires your
        active session.
      </p>
      <p className={styles.exportNotice}>
        This synchronous, single-file export is subject to a server-configured
        size limit capped at 100 MB. It is not paginated or prepared in the
        background, so an oversized export is refused. If that happens, see{' '}
        <Link href="/support">Support</Link> for the GitHub Discussions path.
        Support does not promise a custom data handoff or response time.
      </p>
      <button
        className={styles.secondaryAction}
        type="button"
        disabled={busy}
        onClick={() => void downloadExport()}
      >
        {busy ? 'Preparing export…' : 'Download WebChess data'}
      </button>
      {error ? (
        <p className={styles.deleteError} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function LocalIdentityNotice({
  identityMode,
}: Readonly<{ identityMode: IdentityMode }>) {
  const openClaw = identityMode === 'local-openclaw'
  const localHosted = identityMode === 'local-hosted'
  return (
    <section className={styles.card} aria-labelledby="fixture-title">
      <div className={styles.cardHeading}>
        <div>
          <p className={styles.sectionNumber}>03</p>
          <h2 id="fixture-title">
            {openClaw
              ? 'Local OpenClaw identity'
              : localHosted
                ? 'Local machine identity'
                : 'Local test identity'}
          </h2>
        </div>
        {localHosted ? (
          <form action="/api/auth/local/sign-out" method="post">
            <button className={styles.textAction} type="submit">
              Sign out
            </button>
          </form>
        ) : null}
      </div>
      <p className={styles.bodyCopy}>
        {openClaw
          ? 'This installation keeps its WebChess data in the dedicated local OpenClaw database. Hosted profile, passkey, sign-out, and account-deletion controls are not used in this mode.'
          : localHosted
            ? 'This loopback session is a signed local principal for this computer. Clerk profile, passkey, and hosted account-deletion controls are unused until Clerk keys are configured.'
            : 'This session uses WebChess\'s test-only local identity. Clerk profile, passkey, sign-out, and account-deletion controls are available only when Clerk is configured.'}
      </p>
    </section>
  )
}

function ClerkIdentityControls() {
  const { signOut } = useClerk()

  return (
    <section className={styles.card} aria-labelledby="identity-title">
      <div className={styles.cardHeading}>
        <div>
          <p className={styles.sectionNumber}>03</p>
          <h2 id="identity-title">Identity and security</h2>
        </div>
        <button
          className={styles.textAction}
          type="button"
          onClick={() => void signOut({ redirectUrl: '/' })}
        >
          Sign out
        </button>
      </div>
      <p className={styles.bodyCopy}>
        Use Clerk&apos;s security panel to manage Google or email identities,
        review active devices, and add or remove passkeys when those methods are
        enabled for WebChess.
      </p>
      <div className={styles.profileFrame}>
        <UserProfile
          path="/account"
          routing="path"
          appearance={USER_PROFILE_APPEARANCE}
        />
      </div>
    </section>
  )
}

function errorMessageFromPayload(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') {
    return fallback
  }

  const candidate = payload as { error?: unknown; message?: unknown }
  if (typeof candidate.message === 'string' && candidate.message.length <= 240) {
    return candidate.message
  }
  if (typeof candidate.error === 'string' && candidate.error.length <= 240) {
    return candidate.error
  }
  return fallback
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  try {
    const payload: unknown = await response.json()
    return new Error(errorMessageFromPayload(payload, fallback))
  } catch {
    return new Error(fallback)
  }
}

function DeleteAccount() {
  const { isLoaded, isSignedIn, user } = useUser()
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [dataDeleted, setDataDeleted] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  const canDelete =
    isLoaded &&
    isSignedIn &&
    !!user &&
    !busy &&
    (dataDeleted || confirmation === DELETE_CONFIRMATION)

  const deleteAccount = async () => {
    if (!canDelete || !user) {
      return
    }

    setBusy(true)
    setIsError(false)
    setMessage(
      dataDeleted
        ? 'Retrying Clerk identity deletion…'
        : 'Deleting your WebChess data…',
    )

    try {
      if (!dataDeleted) {
        const response = await fetch('/api/account', {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Idempotency-Key': window.crypto.randomUUID(),
          },
          body: JSON.stringify({ confirmation: DELETE_CONFIRMATION }),
        })

        if (!response.ok) {
          throw await responseError(
            response,
            'WebChess could not delete your saved data.',
          )
        }

        setDataDeleted(true)
        setMessage('Your WebChess data is deleted. Deleting your Clerk identity…')
      }

      try {
        await user.delete()
        window.location.assign('/?account=deleted')
      } catch {
        setIsError(true)
        setMessage(
          'Your WebChess data is deleted, but Clerk did not delete your sign-in identity. A minimal disabled-account marker remains so this identity cannot return with reset limits. You can retry Clerk deletion here after self-deletion is enabled.',
        )
      }
    } catch (deleteError) {
      setIsError(true)
      setMessage(
        deleteError instanceof Error
          ? deleteError.message
          : 'WebChess could not delete your account data.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`${styles.card} ${styles.dangerCard}`} aria-labelledby="delete-title">
      <div className={styles.cardHeading}>
        <div>
          <p className={styles.sectionNumber}>04</p>
          <h2 id="delete-title">Delete account</h2>
        </div>
      </div>
      <p className={styles.bodyCopy}>
        This permanently removes your saved games, answers, and detailed usage
        records. Until Clerk confirms identity deletion, WebChess retains only
        a disabled-account marker that prevents this identity from returning
        with reset limits. This cannot be undone.
      </p>

      {!dataDeleted ? (
        <label className={styles.confirmation}>
          <span>
            Type <strong>{DELETE_CONFIRMATION}</strong> to continue.
          </span>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={busy}
          />
        </label>
      ) : null}

      <button
        className={styles.dangerAction}
        type="button"
        disabled={!canDelete}
        onClick={() => void deleteAccount()}
      >
        {busy
          ? 'Deleting…'
          : dataDeleted
            ? 'Retry Clerk identity deletion'
            : 'Permanently delete my account'}
      </button>

      {message ? (
        <p
          className={isError ? styles.deleteError : styles.deleteStatus}
          role={isError ? 'alert' : 'status'}
        >
          {message}
        </p>
      ) : null}
    </section>
  )
}

export function AccountDashboard({ identityMode }: AccountDashboardProps) {
  return (
    <div className={styles.dashboard}>
      <UsageSummary />
      <DataExport />
      {identityMode === 'clerk' ? (
        <>
          <ClerkIdentityControls />
          <DeleteAccount />
        </>
      ) : (
        <LocalIdentityNotice identityMode={identityMode} />
      )}
    </div>
  )
}
