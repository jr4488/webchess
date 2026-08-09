import {
  isValidElement,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import styles from './PublicSite.module.css'
import { PublicShell } from './PublicShell'

interface DocumentLink {
  href: string
  label: string
}

interface MarkdownDocumentProps {
  downloads?: readonly DocumentLink[]
  source: string
  sourceHref?: string
  sourceLabel?: string
}

function textFromNode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(textFromNode).join('')
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textFromNode(node.props.children)
  }

  return ''
}

function headingId(children: ReactNode): string {
  return textFromNode(children)
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

function publicDocumentHref(href: string | undefined): string | undefined {
  if (!href || href.startsWith('/') || href.startsWith('#') || /^[a-z]+:/i.test(href)) {
    return href
  }

  const [path, fragment] = href.split('#', 2)
  const normalizedPath = path?.replace(/^(\.\.\/|\.\/)+/, '')
  const mappedPaths: Readonly<Record<string, string>> = {
    'README.md': '/',
    'INSTALL.md': '/install',
    'LICENSE': '/license',
    'CONTRIBUTING.md': '/contributing',
    'SECURITY.md': '/security',
    'SUPPORT.md': '/support',
    'ACCEPTABLE_USE.md': '/acceptable-use',
    'docs/ACCEPTABLE_USE.md': '/acceptable-use',
    'docs/ARCHITECTURE.md': '/white-paper#29-current-production-architecture',
    'docs/WEBCHESS_2_0_OPERATIONS.md': '/operations',
    'docs/PRIVACY.md': '/privacy',
    'docs/RESEARCH.md': '/white-paper#17-a-falsifiable-validation-program',
    'docs/TERMS.md': '/terms',
    'docs/WEBCHESS_WHITE_PAPER.md': '/white-paper',
  }
  const destination = normalizedPath ? mappedPaths[normalizedPath] : undefined

  if (!destination) {
    return href
  }

  return fragment && !destination.includes('#') ? `${destination}#${fragment}` : destination
}

function markdownForDisplay(source: string): string {
  const output: string[] = []
  let expression: string[] | null = null

  for (const line of source.split(/\r?\n/)) {
    if (expression === null && line.trim() === String.raw`\[`) {
      expression = []
      continue
    }

    if (expression !== null && line.trim() === String.raw`\]`) {
      output.push('```text', ...expression, '```')
      expression = null
      continue
    }

    if (expression === null) {
      output.push(line)
    } else {
      expression.push(line)
    }
  }

  if (expression !== null) {
    output.push(String.raw`\[`, ...expression)
  }

  return output.join('\n')
}

function Table({
  children,
  node: _node,
  ...props
}: HTMLAttributes<HTMLTableElement> & { node?: unknown }) {
  void _node

  return (
    <div
      className={styles.tableWrap}
      role="region"
      tabIndex={0}
      aria-label="Scrollable table"
    >
      <table {...props}>{children}</table>
    </div>
  )
}

export function MarkdownDocument({
  downloads = [],
  source,
  sourceHref,
  sourceLabel = 'Download source',
}: MarkdownDocumentProps) {
  return (
    <PublicShell>
      <article className={styles.document} data-public-document>
        <aside className={styles.documentUtility} aria-label="Document resources">
          <p>Repository-backed document</p>
          <div className={styles.documentActions}>
            {sourceHref ? (
              <a
                href={sourceHref}
                download={sourceHref.startsWith('/downloads/') || undefined}
              >
                {sourceLabel}
              </a>
            ) : null}
            {downloads.map((download) => (
              <a href={download.href} key={download.href} download>
                {download.label}
              </a>
            ))}
          </div>
        </aside>

        <div className={styles.markdown}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ children, href, title }) => (
                <a href={publicDocumentHref(href)} title={title}>
                  {children}
                </a>
              ),
              h1: ({ children }) => <h1 id={headingId(children)}>{children}</h1>,
              h2: ({ children }) => {
                const id = headingId(children)
                return (
                  <h2 id={id}>
                    <a className={styles.headingAnchor} href={`#${id}`}>
                      {children}
                    </a>
                  </h2>
                )
              },
              h3: ({ children }) => {
                const id = headingId(children)
                return (
                  <h3 id={id}>
                    <a className={styles.headingAnchor} href={`#${id}`}>
                      {children}
                    </a>
                  </h3>
                )
              },
              pre: ({ children }) => (
                <pre role="region" tabIndex={0} aria-label="Scrollable code or formula">
                  {children}
                </pre>
              ),
              table: Table,
            }}
          >
            {markdownForDisplay(source)}
          </ReactMarkdown>
        </div>
      </article>
    </PublicShell>
  )
}
