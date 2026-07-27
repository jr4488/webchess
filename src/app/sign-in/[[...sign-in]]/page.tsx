import { SignIn } from '@clerk/nextjs'
import Link from 'next/link'

import { isClerkConfigured } from '@/server/auth/config'
import {
  buildSignUpPath,
  resolveAuthReturnUrl,
} from '@/server/auth/return-url'
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

  return (
    <div className={styles.shell}>
      <Link className={styles.homeLink} href="/">
        WebChess
      </Link>
      <main className={styles.main}>
        {configured ? (
          <>
            <section className={styles.copy} aria-labelledby="sign-in-heading">
              <p className={styles.eyebrow}>Private workspace</p>
              <h1 id="sign-in-heading">Sign in to play.</h1>
              <p>
                Use the Google, verified-email, or enrolled-passkey option
                shown by Clerk. WebChess never asks you for an OpenAI API key.
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
              This environment has not been connected to Clerk. No game or
              model request can start until the site owner completes that
              private setup.
            </p>
            <Link href="/">Return to the public site</Link>
          </section>
        )}
      </main>
    </div>
  )
}
