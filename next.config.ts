import type { NextConfig } from 'next'

const developmentEval =
  process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''

const nonBlank = (value: string | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0

const clerkMiddlewareOwnsContentSecurityPolicy =
  nonBlank(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
  nonBlank(process.env.CLERK_SECRET_KEY)

const offlineContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://*.protect.clerk.com",
  "font-src 'self' data:",
  "form-action 'self' https://*.clerk.accounts.dev https://*.clerk.com",
  "frame-ancestors 'none'",
  "frame-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com https://*.protect.clerk.com",
  "img-src 'self' data: blob: https://img.clerk.com",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${developmentEval} https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com https://*.protect.clerk.com`,
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
].join('; ')

const securityHeaders = [
  ...(
    clerkMiddlewareOwnsContentSecurityPolicy
      ? []
      : [
          {
            key: 'Content-Security-Policy',
            value: offlineContentSecurityPolicy,
          },
        ]
  ),
  {
    key: 'Cross-Origin-Opener-Policy',
    value: 'same-origin-allow-popups',
  },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=()' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
