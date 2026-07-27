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
    'A circular chess method that divides a difficult question into 64 perspectives, plays the tensions, and turns the resulting trail into practical next moves.',
  metadataBase: new URL(resolveSiteOrigin()),
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
