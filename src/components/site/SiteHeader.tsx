import Link from 'next/link'

const NAVIGATION = [
  { href: '/#method', label: 'Method' },
  { href: '/#episode', label: 'Episode' },
  { href: '/#lifecycle', label: 'Lifecycle' },
  { href: '/research', label: 'Research' },
  { href: '/white-paper', label: 'Paper' },
  { href: '/install', label: 'Install' },
] as const

export function SiteHeader() {
  return (
    <header className="wc-nav" data-wc-nav data-scrolled="false">
      <div className="wc-nav-in">
        <Link className="wc-wordmark" href="/" aria-label="WebChess home">
          Web<span>Chess</span>
        </Link>

        <nav aria-label="Primary navigation">
          <ul className="wc-nav-links">
            {NAVIGATION.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="wc-nav-actions">
          <Link className="wc-nav-signin" href="/sign-in">Sign in</Link>
          <Link className="wc-nav-play" href="/install">Run locally</Link>
        </div>
      </div>
    </header>
  )
}
