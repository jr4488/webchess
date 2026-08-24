import { SignIn } from '@clerk/nextjs'
import Link from 'next/link'

import { isClerkConfigured } from '@/server/auth/config'
import { isLocalHostedSignInAvailable } from '@/server/auth/local-session'
import {
  buildSignUpPath,
  resolveAuthReturnUrl,
} from '@/server/auth/return-url'
import { requestFromCurrentHeaders } from '@/server/auth/session'
import { resolveSiteOrigin } from '@/server/site-origin'

import styles from '../auth.module.css'

export const dynamic = 'force-dynamic'

interface SignInPageProps {
  searchParams: Promise<{
    redirect_url?: string | string[]
    return_url?: string | string[]
  }>
}

export default async function SignInPage({
  searchParams,
}: SignInPageProps) {
  const resolvedSearchParams = await searchParams
  const returnUrl = resolveAuthReturnUrl(
    resolvedSearchParams.return_url,
    resolvedSearchParams.redirect_url,
    resolveSiteOrigin(),
  )
  const configured = isClerkConfigured()
  let localHosted = false
  if (!configured) {
    const localRequest = await requestFromCurrentHeaders()
    localHosted = localRequest
      ? isLocalHostedSignInAvailable(localRequest)
      : false
  }

  return (
    <div className={styles.shell}>
      <Link className={styles.homeLink} href="/">
        WebChess
      </Link>
      <main className={styles.main}>
        {configured ? (
          <>
            <section className={styles.copy} aria-labelledby="sign-in-heading">
              <p className={styles.eyebrow}>Retained account data</p>
              <h1 id="sign-in-heading">Sign in for account controls.</h1>
              <p>
                Use the Google, verified-email, or enrolled-passkey option
                shown by Clerk to inspect, export, or delete retained account
                data. Hosted gameplay is retired; run WebChess through the
                local OpenClaw installation instead.
              </p>
            </section>
            <div className={styles.clerk}>
              <SignIn
                path="/sign-in"
                routing="path"
                signUpUrl={buildSignUpPath(returnUrl)}
                forceRedirectUrl={returnUrl}
              />
            </div>
          </>
        ) : localHosted ? (
          <section
            className={styles.unavailable}
            aria-labelledby="sign-in-heading"
          >
            <p className={styles.eyebrow}>This machine</p>
            <h1 id="sign-in-heading">Open local data controls.</h1>
            <p>
              Clerk is not configured here. This loopback WebChess uses a
              signed local session only for retained account-data controls.
              It cannot start gameplay; use the packed OpenClaw installation
              for a game.
            </p>
            <form
              className={styles.localForm}
              action="/api/auth/local/sign-in"
              method="post"
            >
              <input type="hidden" name="return_url" value={returnUrl} />
              <button className={styles.localAction} type="submit">
                Open local data controls
              </button>
            </form>
          </section>
        ) : (
          <section
            className={styles.unavailable}
            aria-labelledby="sign-in-unavailable-heading"
          >
            <p className={styles.eyebrow}>Setup required</p>
            <h1 id="sign-in-unavailable-heading">
              Sign-in is not available here yet.
            </h1>
            <p>
              This environment has not been connected to Clerk, so retained
              account-data controls are unavailable here. Gameplay is never
              enabled by Clerk; use the local OpenClaw installation.
            </p>
            <Link href="/install">Open the installation guide</Link>
          </section>
        )}
      </main>
    </div>
  )
}
