import type { ReactNode } from 'react'

import { PublicEffects } from './PublicEffects'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

interface PublicShellProps {
  children: ReactNode
}

export function PublicShell({ children }: PublicShellProps) {
  return (
    <div className="wc-site">
      <a className="wc-skip-link" href="#main-content">Skip to main content</a>
      <SiteHeader />
      <PublicEffects />
      <main className="wc-main" id="main-content">
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
