import Link from 'next/link'

import styles from './PublicSite.module.css'

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerLead}>
          <Link className={styles.brand} href="/">
            <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>
            <span>WebChess<small>Deliberative AI</small></span>
          </Link>
          <p>
            An open-source, rule-governed method for examining difficult questions before acting.
          </p>
          <a href="mailto:AnansiPortia@gmail.com">AnansiPortia@gmail.com</a>
        </div>

        <nav className={styles.footerGroup} aria-label="Explore WebChess">
          <h2>Explore</h2>
          <ul className={styles.footerLinks}>
            <li><Link href="/#method">Method</Link></li>
            <li><Link href="/research">Research</Link></li>
            <li><Link href="/white-paper">White paper</Link></li>
            <li><Link href="/install">Install</Link></li>
          </ul>
        </nav>

        <nav className={styles.footerGroup} aria-label="Project resources">
          <h2>Project</h2>
          <ul className={styles.footerLinks}>
            <li><a href="https://github.com/jr4488/webchess">Source</a></li>
            <li><a href="https://github.com/jr4488/webchess/discussions">Discussions</a></li>
            <li><Link href="/security">Security</Link></li>
            <li><Link href="/support">Support</Link></li>
          </ul>
        </nav>

        <nav className={styles.footerGroup} aria-label="WebChess policies">
          <h2>Policies</h2>
          <ul className={styles.footerLinks}>
            <li><Link href="/privacy">Privacy</Link></li>
            <li><Link href="/terms">Terms</Link></li>
            <li><Link href="/acceptable-use">Acceptable use</Link></li>
            <li><Link href="/license">Apache-2.0</Link></li>
          </ul>
        </nav>

        <p className={styles.footerMeta}>
          Board events generate salience, not evidence. WebChess is a research instrument—not prophecy, proof, or an autonomous decision maker.
        </p>
      </div>
    </footer>
  )
}
