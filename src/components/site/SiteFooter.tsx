import Link from 'next/link'

import styles from './PublicSite.module.css'

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div>
          <Link className={styles.brand} href="/">
            WebChess
          </Link>
          <p className={styles.footerSummary}>
            An open-source circular chess method for examining difficult questions. Board events
            create salience, not evidence.
          </p>
        </div>

        <nav className={styles.footerGroup} aria-label="Method and documentation">
          <h2>Understand</h2>
          <ul className={styles.footerLinks}>
            <li><Link href="/#method">Method</Link></li>
            <li><Link href="/white-paper">White paper</Link></li>
            <li><Link href="/install">Install</Link></li>
            <li><Link href="/license">License</Link></li>
          </ul>
        </nav>

        <nav className={styles.footerGroup} aria-label="Project and support">
          <h2>Project</h2>
          <ul className={styles.footerLinks}>
            <li><Link href="/contributing">Contributing</Link></li>
            <li><Link href="/security">Security</Link></li>
            <li><Link href="/support">Support</Link></li>
            <li>
              <a href="https://github.com/jr4488/webchess">GitHub source</a>
            </li>
            <li>
              <a href="https://github.com/jr4488/webchess/discussions">Discussions</a>
            </li>
          </ul>
        </nav>

        <nav className={styles.footerGroup} aria-label="Policies">
          <h2>Policies</h2>
          <ul className={styles.footerLinks}>
            <li><Link href="/privacy">Privacy</Link></li>
            <li><Link href="/terms">Terms</Link></li>
            <li><Link href="/acceptable-use">Acceptable use</Link></li>
          </ul>
        </nav>

        <p className={styles.footerMeta}>
          WebChess is an independent project. Source code is licensed under Apache-2.0.
        </p>
      </div>
    </footer>
  )
}
