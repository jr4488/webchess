import { SignUp } from '@clerk/nextjs'
import Link from 'next/link'

import { isClerkConfigured } from '@/server/auth/config'
import { isLocalHostedSignInAvailable } from '@/server/auth/local-session'
import {
  buildSignInPath,
  resolveAuthReturnUrl,
} from '@/server/auth/return-url'
import { requestFromCurrentHeaders } from '@/server/auth/session'
import { resolveSiteOrigin } from '@/server/site-origin'

import styles from '../../sign-in/auth.module.css'

export const dynamic = 'force-dynamic'

interface SignUpPageProps {
  searchParams: Promise<{
    redirect_url?: string | string[]
    return_url?: string | string[]
  }>
}

export default async function SignUpPage({
  searchParams,
}: SignUpPageProps) {
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
            <section className={styles.copy} aria-labelledby="sign-up-heading">
              <p className={styles.eyebrow}>Retained account data</p>
              <h1 id="sign-up-heading">Create an account for data controls.</h1>
              <p>
                Create your account with one of the verified methods Clerk
                shows. This does not enable hosted gameplay; run WebChess
                through the local OpenClaw installation instead.
              </p>
            </section>
            <div className={styles.clerk}>
              <SignUp
                path="/sign-up"
                routing="path"
                signInUrl={buildSignInPath(returnUrl)}
                forceRedirectUrl={returnUrl}
              />
            </div>
          </>
        ) : localHosted ? (
          <section
            className={styles.unavailable}
            aria-labelledby="sign-up-heading"
          >
            <p className={styles.eyebrow}>This machine</p>
            <h1 id="sign-up-heading">Open local data controls.</h1>
            <p>
              A separate hosted account is not used on this loopback
              installation. The signed local session exposes retained
              account-data controls only and cannot start gameplay.
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
            aria-labelledby="sign-up-unavailable-heading"
          >
            <p className={styles.eyebrow}>Setup required</p>
            <h1 id="sign-up-unavailable-heading">
              Account creation is not available here yet.
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
