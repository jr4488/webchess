import type { Metadata } from 'next'
import Link from 'next/link'

import { AccountDashboard } from '@/components/account/AccountDashboard'
import { requirePageUser } from '@/server/auth'

import styles from './account.module.css'

export const metadata: Metadata = {
  title: 'Account',
  description:
    'Manage your WebChess identity, security methods, usage, exports, and saved data.',
}

export default async function AccountPage() {
  const principal = await requirePageUser('/account')

  return (
    <main className={styles.page} id="account-main">
      <div className={styles.shell}>
        <nav className={styles.breadcrumbs} aria-label="Account navigation">
          <Link href="/">WebChess</Link>
          <span aria-hidden="true">/</span>
          <Link href="/play">Play</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Account</span>
        </nav>

        <header className={styles.intro}>
          <p className={styles.eyebrow}>Your WebChess account</p>
          <h1>Usage, data, and sign-in security</h1>
          <p>
            Review your current allowance, download your WebChess data, and
            manage the identities and passkeys that protect your account.
          </p>
        </header>

        <AccountDashboard identityMode={principal.source} />
      </div>
    </main>
  )
}
