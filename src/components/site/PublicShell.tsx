import type { ReactNode } from 'react'

import legacyStyles from './PublicSite.module.css'
import { PublicEffects } from './PublicEffects'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

interface PublicShellProps {
  children: ReactNode
}

export function PublicShell({ children }: PublicShellProps) {
  return (
    <div className={`${legacyStyles.page} wc-site`}>
      <a className="wc-skip-link" href="#main-content">Skip to main content</a>
      <SiteHeader />
      <PublicEffects />
      <main className={`${legacyStyles.main} wc-main`} id="main-content">
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
