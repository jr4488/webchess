import styles from './PublicSite.module.css'
import { PublicShell } from './PublicShell'

interface TextDocumentProps {
  downloadHref: string
  source: string
  title: string
}

export function TextDocument({
  downloadHref,
  source,
  title,
}: TextDocumentProps) {
  return (
    <PublicShell>
      <article className={styles.document}>
        <aside className={styles.documentUtility} aria-label="Document resources">
          <p>Repository-backed document</p>
          <div className={styles.documentActions}>
            <a href={downloadHref} download>
              Download text
            </a>
          </div>
        </aside>
        <div className={styles.markdown}>
          <h1>{title}</h1>
        </div>
        <pre className={styles.plainDocument}>{source}</pre>
      </article>
    </PublicShell>
  )
}
