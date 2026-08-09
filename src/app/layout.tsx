import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { ClerkProvider } from '@clerk/nextjs'
import { Cormorant_Garamond, IBM_Plex_Mono, Public_Sans } from 'next/font/google'

import { isClerkConfigured } from '@/server/auth/config'
import { resolveSiteOrigin } from '@/server/site-origin'

import '../styles.css'
import '../theme-dark.css'
import '../canonical-site.css'
import '../canonical-site-a11y.css'

const publicSans = Public_Sans({
  subsets: ['latin'],
  variable: '--font-wc-sans',
  display: 'swap',
  weight: ['300', '400', '500', '600'],
})

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  variable: '--font-wc-serif',
  display: 'swap',
  style: ['normal', 'italic'],
  weight: ['300', '400', '500'],
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-wc-mono',
  display: 'swap',
  weight: ['300', '400', '500'],
})

export const metadata: Metadata = {
  title: {
    default: 'WebChess',
    template: '%s · WebChess',
  },
  description:
    'WebChess surrounds a foundation model with a 64-facet field, seeded symbolic casting, complete circular-chess traversal, adversarial review, deterministic admission, reversible action, and durable provenance.',
  metadataBase: new URL(resolveSiteOrigin()),
  authors: [{ name: 'Jack Reynolds', url: 'https://anansiportia.com' }],
  creator: 'The WebChess Project',
  keywords: [
    'WebChess',
    'ANANSI protocol',
    'deliberative middleware',
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
  const fontClasses = `${publicSans.variable} ${cormorant.variable} ${plexMono.variable}`

  return (
    <html lang="en">
      <body className={fontClasses}>
        {clerkConfigured && publishableKey ? (
          <ClerkProvider dynamic publishableKey={publishableKey}>
            {body}
          </ClerkProvider>
        ) : body}
      </body>
    </html>
  )
}
