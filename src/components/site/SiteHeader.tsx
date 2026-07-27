import Link from 'next/link'

import styles from './PublicSite.module.css'

const NAVIGATION = [
  { href: '/#method', label: 'Method' },
  { href: '/white-paper', label: 'White paper' },
  { href: '/install', label: 'Install' },
  { href: '/support', label: 'Support' },
] as const

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link className={styles.brand} href="/">
          WebChess
          <span className={styles.brandDescriptor}>Circular problem solving</span>
        </Link>

        <nav className={styles.nav} aria-label="Primary navigation">
          <ul className={styles.navList}>
            {NAVIGATION.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.headerActions}>
          <Link className={styles.textAction} href="/sign-in">
            Sign in
          </Link>
          <Link className={styles.primaryAction} href="/play">
            Play WebChess
          </Link>
        </div>
      </div>
    </header>
  )
}
