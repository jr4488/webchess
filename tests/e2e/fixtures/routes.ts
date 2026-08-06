export interface RouteFixture {
  path: string
  label: string
  shell?: 'site' | 'auth'
}

export interface DownloadFixture extends RouteFixture {
  sourcePath?: string
  contentType: RegExp
  signature?: string
  redirectLocation?: RegExp
}

export const PUBLIC_ROUTES: readonly RouteFixture[] = [
  { path: '/', label: 'home' },
  { path: '/research', label: 'research' },
  { path: '/white-paper', label: 'white paper' },
  { path: '/install', label: 'installation' },
  { path: '/operations', label: 'operator guide' },
  { path: '/license', label: 'license' },
  { path: '/contributing', label: 'contributing' },
  { path: '/security', label: 'security' },
  { path: '/support', label: 'support' },
  { path: '/privacy', label: 'privacy' },
  { path: '/terms', label: 'terms' },
  { path: '/acceptable-use', label: 'acceptable use' },
  { path: '/sign-in', label: 'sign in', shell: 'auth' },
  { path: '/sign-up', label: 'sign up', shell: 'auth' },
] as const

export const PROTECTED_ROUTES: readonly RouteFixture[] = [
  { path: '/play', label: 'play' },
  { path: '/account', label: 'account' },
] as const

export const DOWNLOADS: readonly DownloadFixture[] = [
  {
    path: '/downloads/webchess-white-paper.md',
    label: 'white paper Markdown',
    sourcePath: 'public/downloads/webchess-white-paper.md',
    contentType: /(?:text\/(?:markdown|plain)|application\/octet-stream)/i,
  },
  {
    path: '/downloads/webchess-white-paper.html',
    label: 'white paper HTML',
    sourcePath: 'public/downloads/webchess-white-paper.html',
    contentType: /text\/html/i,
    signature: '<!doctype html',
  },
  {
    path: '/downloads/webchess-white-paper.pdf',
    label: 'white paper PDF',
    sourcePath: 'public/downloads/webchess-white-paper.pdf',
    contentType: /application\/pdf/i,
    signature: '%PDF-',
  },
  {
    path: '/downloads/webchess-installation.md',
    label: 'installation Markdown',
    sourcePath: 'public/downloads/webchess-installation.md',
    contentType: /(?:text\/(?:markdown|plain)|application\/octet-stream)/i,
  },
  {
    path: '/downloads/LICENSE',
    label: 'Apache-2.0 license',
    sourcePath: 'public/downloads/LICENSE',
    contentType: /(?:text\/plain|application\/octet-stream)/i,
  },
  {
    path: '/downloads/webchess-source.zip',
    label: 'source archive',
    contentType: /(?:application\/(?:zip|x-zip-compressed|octet-stream))/i,
    signature: 'PK',
    redirectLocation:
      /^https:\/\/github\.com\/jr4488\/webchess\/archive\/(?:[a-f0-9]{40}\.zip|refs\/heads\/main\.zip)$/i,
  },
] as const

export const GITHUB_REPOSITORY_URL = 'https://github.com/jr4488/webchess'
export const GITHUB_DISCUSSIONS_URL =
  'https://github.com/jr4488/webchess/discussions'
export const GITHUB_ISSUES_URL = 'https://github.com/jr4488/webchess/issues'
export const GITHUB_SECURITY_ADVISORY_URL =
  'https://github.com/jr4488/webchess/security/advisories/new'
