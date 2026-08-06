import Link from 'next/link'

import styles from './PublicSite.module.css'

const NAVIGATION = [
  { href: '/#method', label: 'Method' },
  { href: '/research', label: 'Research' },
  { href: '/white-paper', label: 'White paper' },
  { href: 'https://github.com/jr4488/webchess', label: 'GitHub' },
] as const

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link className={styles.brand} href="/" aria-label="WebChess home">
          <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>
          <span>
            WebChess
            <small>Deliberative AI</small>
          </span>
        </Link>

        <nav className={styles.nav} aria-label="Primary navigation">
          <ul className={styles.navList}>
            {NAVIGATION.map((item) => (
              <li key={item.href}>
                {item.href.startsWith('http') ? (
                  <a href={item.href}>{item.label}</a>
                ) : (
                  <Link href={item.href}>{item.label}</Link>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.headerActions}>
          <Link className={styles.textAction} href="/sign-in">Sign in</Link>
          <Link className={styles.headerPlay} href="/play">Play</Link>
        </div>
      </div>
    </header>
  )
}
