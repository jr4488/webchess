import type { ReactNode } from 'react'

import styles from './PublicSite.module.css'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

interface PublicShellProps {
  children: ReactNode
}

export function PublicShell({ children }: PublicShellProps) {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main-content">
        Skip to main content
      </a>
      <SiteHeader />
      <main className={styles.main} id="main-content">
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
