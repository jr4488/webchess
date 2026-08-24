import Link from 'next/link'

import { immutableReleaseSourceUrl } from '@/lib/release-source'

export function SiteFooter() {
  const immutableSourceUrl = immutableReleaseSourceUrl()

  return (
    <footer className="wc-footer">
      <div className="wc-wrap">
        <div className="wc-foot-grid">
          <div>
            <div className="wc-foot-mark">Web<span>Chess</span></div>
            <p>
              An independent research project in Sierra Madre, California. Prepared with AI
              assistance under human direction; the author is responsible for all claims. The
              Anansi and <em>Yijing</em> borrowings are documented functional analogies, not claims
              of cultural authority.
            </p>
          </div>

          <nav aria-label="WebChess project links">
            <h2>Project</h2>
            <ul className="wc-footer-links">
              <li><Link href="/#method">Method</Link></li>
              <li><Link href="/#episode">Episode</Link></li>
              <li><Link href="/#lifecycle">Lifecycle</Link></li>
              <li><Link href="/research">Research program</Link></li>
              <li>
                <Link href="/white-paper">
                  {immutableSourceUrl ? 'Mapped paper 3.1' : 'Historical paper 3.0'}
                </Link>
              </li>
              <li><Link href="/install">Install the local research build</Link></li>
              <li>
                {immutableSourceUrl ? (
                  <>
                    <a href={immutableSourceUrl}>Immutable source</a>{' · '}
                    <a href="/downloads/webchess-release-identity.json">Release identity</a>
                  </>
                ) : (
                  <span role="status">Source identity pending</span>
                )}
              </li>
            </ul>
          </nav>

          <nav aria-label="WebChess contact and policies">
            <h2>Contact & policies</h2>
            <ul className="wc-footer-links">
              <li><a href="mailto:AnansiPortia@gmail.com">AnansiPortia@gmail.com</a></li>
              <li><a href="https://github.com/jr4488/webchess/discussions">Discussions</a></li>
              <li><Link href="/security">Security</Link></li>
              <li><Link href="/privacy">Privacy</Link></li>
              <li><Link href="/terms">Terms</Link></li>
              <li><Link href="/acceptable-use">Acceptable use</Link></li>
            </ul>
          </nav>
        </div>

        <div className="wc-foot-note">
          <span>© 2026 The WebChess Project · Apache-2.0</span>
          <span>Not a validated safety technology. Not for medical, legal, financial, or emergency decisions.</span>
        </div>
      </div>
    </footer>
  )
}
