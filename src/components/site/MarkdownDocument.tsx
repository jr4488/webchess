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
    'docs/ARCHITECTURE.md':
      '/white-paper#214-three-runtime-surfaces-three-separate-promises',
    'docs/WEBCHESS_2_0_OPERATIONS.md': '/operations',
    'docs/PRIVACY.md': '/privacy',
    'docs/RESEARCH.md': '/white-paper#18-falsifiable-evaluation-program',
    'docs/TERMS.md': '/terms',
    'docs/WEBCHESS_WHITE_PAPER.md': '/white-paper',
    'docs/WEBCHESS_WHITE_PAPER_V2.md': '/white-paper',
    'docs/WEBCHESS_WHITE_PAPER_V3.md': '/white-paper',
  }
  const destination = normalizedPath ? mappedPaths[normalizedPath] : undefined

  if (!destination) {
    return href
  }

  return fragment && !destination.includes('#') ? `${destination}#${fragment}` : destination
}

function publicDocumentImageSrc(src: string | undefined): string | undefined {
  if (!src || src.startsWith('/') || /^data:/i.test(src) || /^https?:/i.test(src)) {
    return src
  }

  const normalizedPath = src.replace(/^(?:\.\.\/|\.\/)+/, '')
  if (normalizedPath.startsWith('public/')) {
    return `/${normalizedPath.slice('public/'.length)}`
  }

  return src
}

function replaceBraceCommand(
  expression: string,
  command: string,
  argumentCount: number,
  render: (argumentsFound: string[]) => string,
): string {
  const token = '\\' + command
  let result = expression
  let offset = 0

  while (offset < result.length) {
    const start = result.indexOf(token, offset)
    if (start === -1) {
      break
    }

    let cursor = start + token.length
    const argumentsFound: string[] = []
    let valid = true

    for (let argumentIndex = 0; argumentIndex < argumentCount; argumentIndex += 1) {
      while (/\s/u.test(result[cursor] ?? '')) {
        cursor += 1
      }
      if (result[cursor] !== '{') {
        valid = false
        break
      }

      let depth = 0
      let end = -1
      for (let index = cursor; index < result.length; index += 1) {
        if (result[index] === '{') {
          depth += 1
        } else if (result[index] === '}') {
          depth -= 1
          if (depth === 0) {
            end = index
            break
          }
        }
      }
      if (end === -1) {
        valid = false
        break
      }

      argumentsFound.push(result.slice(cursor + 1, end))
      cursor = end + 1
    }

    if (!valid) {
      offset = start + token.length
      continue
    }

    const replacement = render(argumentsFound)
    result = result.slice(0, start) + replacement + result.slice(cursor)
    offset = start + replacement.length
  }

  return result
}

function readableInlineMath(expression: string): string {
  const commandCharacters: Readonly<Record<string, string>> = {
    Delta: 'Δ',
    Vert: '‖',
    bmod: ' mod ',
    cap: '∩',
    cdots: '…',
    cup: '∪',
    exists: '∃',
    ge: '≥',
    iff: '⇔',
    in: '∈',
    lambda: 'λ',
    land: '∧',
    lceil: '⌈',
    ldots: '…',
    le: '≤',
    leftarrow: '←',
    lfloor: '⌊',
    max: 'max',
    min: 'min',
    neg: '¬',
    oplus: '⊕',
    parallel: '∥',
    pi: 'π',
    quad: ' ',
    qquad: '  ',
    rceil: '⌉',
    rfloor: '⌋',
    rightarrow: '→',
    subseteq: '⊆',
    sum: 'Σ',
    times: '×',
  }

  let result = expression
  for (const command of ['operatorname', 'texttt', 'text', 'mbox']) {
    result = replaceBraceCommand(result, command, 1, ([content]) => content)
  }
  result = replaceBraceCommand(
    result,
    'binom',
    2,
    ([top, bottom]) => 'C(' + top + ', ' + bottom + ')',
  )
  result = replaceBraceCommand(
    result,
    'frac',
    2,
    ([top, bottom]) => '(' + top + ') / (' + bottom + ')',
  )
  result = replaceBraceCommand(result, 'pmod', 1, ([modulus]) => '(mod ' + modulus + ')')
  result = replaceBraceCommand(result, 'mathbin', 1, ([content]) => content)
  result = replaceBraceCommand(result, 'boxed', 1, ([content]) => content)

  return result
    .replace(/\\begin\{cases\}/gu, 'cases:')
    .replace(/\\end\{cases\}/gu, '')
    .replace(/\\(?:left|right)\b/gu, '')
    .replace(/_\{([^{}]+)\}/gu, '_$1')
    .replace(/\^\{([^{}]+)\}/gu, '^$1')
    .replace(
      /\\(Delta|Vert|bmod|cap|cdots|cup|exists|ge|iff|in|lambda|land|lceil|ldots|le|leftarrow|lfloor|max|min|neg|oplus|parallel|pi|quad|qquad|rceil|rfloor|rightarrow|subseteq|sum|times)(?![A-Za-z])/gu,
      (_match, command: string) => commandCharacters[command] ?? command,
    )
    .replace(/\\_/gu, '_')
    .replace(/\\([{}])/gu, '$1')
    .replace(/\{,\}/gu, ',')
    .replace(/\\!/gu, '')
    .replace(/\\[,;:]/gu, ' ')
    .replace(/&/gu, '')
    .replace(/\\\\[ \t]*(?=\n|$)/gu, '')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim()
}

function portableInlineMath(line: string): string {
  return line.replace(
    /\\\((.+?)\\\)/gu,
    (_match, expression: string) => `\`${readableInlineMath(expression)}\``,
  )
}

function markdownForDisplay(source: string): string {
  const output: string[] = []
  let expression: string[] | null = null
  let expressionClose: string | null = null
  let expressionOpen: string | null = null

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (
      expression === null &&
      (trimmed === String.raw`\[` || trimmed === '$$')
    ) {
      expression = []
      expressionOpen = trimmed
      expressionClose = trimmed === '$$' ? '$$' : String.raw`\]`
      continue
    }

    if (expression !== null && trimmed === expressionClose) {
      output.push(
        '```text',
        ...readableInlineMath(expression.join('\n')).split('\n'),
        '```',
      )
      expression = null
      expressionClose = null
      expressionOpen = null
      continue
    }

    if (expression === null) {
      output.push(portableInlineMath(line))
    } else {
      expression.push(line)
    }
  }

  if (expression !== null) {
    output.push(expressionOpen ?? String.raw`\[`, ...expression)
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
              img: ({ alt, src, title }) => (
                <img
                  alt={alt ?? ''}
                  decoding="async"
                  loading="lazy"
                  src={typeof src === 'string' ? publicDocumentImageSrc(src) : src}
                  title={title}
                />
              ),
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
