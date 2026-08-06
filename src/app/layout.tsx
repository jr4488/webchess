import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { ClerkProvider } from '@clerk/nextjs'

import { isClerkConfigured } from '@/server/auth/config'
import { resolveSiteOrigin } from '@/server/site-origin'

import '../styles.css'
import '../theme-dark.css'

export const metadata: Metadata = {
  title: {
    default: 'WebChess',
    template: '%s · WebChess',
  },
  description:
    'A rule-governed deliberative layer that expands difficult questions, forces perspectives into conflict, attacks what survives, and records what happens next.',
  metadataBase: new URL(resolveSiteOrigin()),
  authors: [{ name: 'Jack Reynolds', url: 'https://anansiportia.com' }],
  creator: 'The WebChess Project',
  keywords: [
    'WebChess',
    'ANANSI protocol',
    'AI deliberation',
    'safe AI',
    'adversarial reasoning',
    'circular chess',
    'problem solving',
  ],
  openGraph: {
    siteName: 'WebChess',
    type: 'website',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const body = <>{children}</>
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  const clerkConfigured = isClerkConfigured()

  return (
    <html lang="en">
      <body>
        {clerkConfigured && publishableKey ? (
          <ClerkProvider dynamic publishableKey={publishableKey}>
            {body}
          </ClerkProvider>
        ) : body}
      </body>
    </html>
  )
}
