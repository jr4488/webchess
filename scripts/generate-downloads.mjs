import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const downloadDirectory = join(repositoryRoot, 'public', 'downloads')

const sourcePaths = {
  installation: join(repositoryRoot, 'INSTALL.md'),
  license: join(repositoryRoot, 'LICENSE'),
  whitePaper: join(repositoryRoot, 'docs', 'WEBCHESS_WHITE_PAPER_V2.md'),
}

const outputPaths = {
  installation: join(downloadDirectory, 'webchess-installation.md'),
  license: join(downloadDirectory, 'LICENSE'),
  whitePaperHtml: join(downloadDirectory, 'webchess-white-paper.html'),
  whitePaperMarkdown: join(downloadDirectory, 'webchess-white-paper.md'),
  whitePaperPdf: join(downloadDirectory, 'webchess-white-paper.pdf'),
}

const repositoryUrl = 'https://github.com/jr4488/webchess'

function assertDocument(name, source) {
  if (!source.trim()) {
    throw new Error(`${name} is empty; refusing to publish an empty download`)
  }
}

function textFromNode(node) {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(textFromNode).join('')
  }

  if (isValidElement(node)) {
    return textFromNode(node.props.children)
  }

  return ''
}

function headingId(children) {
  return textFromNode(children)
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

function downloadableMarkdown(source) {
  const output = []
  let expression = null

  for (const sourceLine of source.split(/\r?\n/)) {
    const lines = sourceLine.replaceAll(/<br\s*\/?>/gi, '  \n').split('\n')

    for (const line of lines) {
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
  }

  if (expression !== null) {
    output.push(String.raw`\[`, ...expression)
  }

  return output.join('\n')
}

function repositoryHref(sourcePath, href) {
  if (
    !href ||
    href.startsWith('#') ||
    href.startsWith('/') ||
    /^[a-z][a-z\d+.-]*:/i.test(href)
  ) {
    return href
  }

  const [relativePath, fragment] = href.split('#', 2)
  const basePath = sourcePath.split('/').slice(0, -1).join('/')
  const pathParts = `${basePath}/${relativePath}`.split('/')
  const normalizedParts = []

  for (const part of pathParts) {
    if (!part || part === '.') {
      continue
    }
    if (part === '..') {
      normalizedParts.pop()
    } else {
      normalizedParts.push(part)
    }
  }

  const suffix = fragment ? `#${fragment}` : ''
  return `${repositoryUrl}/blob/main/${normalizedParts.join('/')}${suffix}`
}

function renderWhitePaperHtml(markdown) {
  const article = renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm],
        components: {
          a: ({ children, href, title }) =>
            createElement(
              'a',
              {
                href: repositoryHref('docs/WEBCHESS_WHITE_PAPER_V2.md', href),
                title,
              },
              children,
            ),
          h1: ({ children }) =>
            createElement('h1', { id: headingId(children) }, children),
          h2: ({ children }) =>
            createElement('h2', { id: headingId(children) }, children),
          h3: ({ children }) =>
            createElement('h3', { id: headingId(children) }, children),
          h4: ({ children }) =>
            createElement('h4', { id: headingId(children) }, children),
          table: ({ children }) =>
            createElement(
              'div',
              { className: 'table-wrap', role: 'region', tabIndex: 0 },
              createElement('table', null, children),
            ),
        },
      },
      downloadableMarkdown(markdown),
    ),
  )

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
  <title>WebChess — Technical white paper</title>
  <meta name="description" content="The repository-backed WebChess research and technical white paper.">
  <style>
    :root {
      color: #172019;
      background: #f5f3eb;
      font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
      font-synthesis: none;
      line-height: 1.65;
    }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main {
      width: min(100% - 2rem, 54rem);
      margin-inline: auto;
      padding: 3rem 0 5rem;
    }
    h1, h2, h3, h4 {
      color: #102a1b;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.18;
      text-wrap: balance;
    }
    h1 { font-size: clamp(2.35rem, 7vw, 4.25rem); letter-spacing: -0.04em; }
    h2 { margin-top: 3.5rem; font-size: clamp(1.7rem, 4vw, 2.35rem); }
    h3 { margin-top: 2.5rem; font-size: 1.4rem; }
    h4 { margin-top: 2rem; font-size: 1.12rem; }
    p, li { font-size: 1.05rem; }
    a { color: #075e44; text-decoration-thickness: 0.09em; text-underline-offset: 0.14em; }
    a:hover { color: #003d2c; }
    a:focus-visible {
      outline: 3px solid #9c5d00;
      outline-offset: 3px;
    }
    blockquote {
      margin-inline: 0;
      border-left: 0.3rem solid #9c5d00;
      padding: 0.25rem 0 0.25rem 1.25rem;
      color: #29362c;
    }
    code, pre {
      font-family: ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    }
    code {
      border-radius: 0.2rem;
      background: #e4e7df;
      padding: 0.08em 0.25em;
    }
    pre {
      overflow-x: auto;
      border: 1px solid #a8b0a7;
      border-radius: 0.35rem;
      background: #e9ece6;
      padding: 1rem;
      line-height: 1.5;
    }
    pre code { padding: 0; background: transparent; }
    .table-wrap {
      overflow-x: auto;
      margin: 1.5rem 0;
      border: 1px solid #a8b0a7;
    }
    table { width: 100%; border-collapse: collapse; }
    th, td { min-width: 10rem; border: 1px solid #a8b0a7; padding: 0.7rem; text-align: left; vertical-align: top; }
    th { background: #dfe5dc; font-family: ui-sans-serif, system-ui, sans-serif; }
    hr { margin: 3rem 0; border: 0; border-top: 1px solid #8a958b; }
    @media (max-width: 38rem) {
      main { width: min(100% - 1.25rem, 54rem); padding-top: 1.5rem; }
      p, li { font-size: 1rem; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; }
    }
    @media print {
      :root { background: #fff; color: #111; font-size: 10.5pt; }
      main { width: auto; margin: 0; padding: 0; }
      h1, h2, h3, h4 { break-after: avoid; color: #111; }
      pre, blockquote, table { break-inside: avoid; }
      a { color: #111; text-decoration: none; }
      a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 0.85em; overflow-wrap: anywhere; }
    }
  </style>
</head>
<body>
  <main>
    <article>${article}</article>
  </main>
</body>
</html>
`
}

const replacementCharacters = new Map([
  ['\u00a0', ' '],
  ['\u00ad', ''],
  ['\u2010', '-'],
  ['\u2011', '-'],
  ['\u2012', '-'],
  ['\u2013', '-'],
  ['\u2014', '--'],
  ['\u2015', '--'],
  ['\u2018', "'"],
  ['\u2019', "'"],
  ['\u201a', "'"],
  ['\u201c', '"'],
  ['\u201d', '"'],
  ['\u2022', '*'],
  ['\u2026', '...'],
  ['\u2032', "'"],
  ['\u2033', '"'],
  ['\u2190', '<-'],
  ['\u2191', '^'],
  ['\u2192', '->'],
  ['\u2193', 'v'],
  ['\u21d2', '=>'],
  ['\u2212', '-'],
  ['\u2217', '*'],
  ['\u221e', 'infinity'],
  ['\u2260', '!='],
  ['\u2264', '<='],
  ['\u2265', '>='],
  ['\u2208', 'in'],
  ['\u2209', 'not in'],
  ['\u2200', 'for all'],
  ['\u2203', 'there exists'],
  ['\u00d7', 'x'],
  ['\u00f7', '/'],
  ['\u03c0', 'pi'],
  ['\u03a0', 'Pi'],
  ['\u03c3', 'sigma'],
  ['\u03a3', 'Sigma'],
  ['\u03b8', 'theta'],
  ['\u03bb', 'lambda'],
])

function pdfAscii(value) {
  let output = ''

  for (const character of value.normalize('NFKD')) {
    if (replacementCharacters.has(character)) {
      output += replacementCharacters.get(character)
      continue
    }

    const codePoint = character.codePointAt(0)
    if (codePoint >= 32 && codePoint <= 126) {
      output += character
      continue
    }

    if (codePoint === 10 || codePoint === 13 || codePoint === 9) {
      output += ' '
    }
  }

  return output.replace(/\s+/g, ' ').trim()
}

function plainInlineMarkdown(value) {
  return pdfAscii(
    value
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
      .replace(/\[([^\]]+)\]\((#[^)]+)\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/\[([^\]]+)\]\[[^\]]+\]/g, '$1')
      .replace(/<\/?[^>]+>/g, ' ')
      .replace(/\\operatorname\{([^}]+)\}/g, '$1')
      .replace(/\\text\{([^}]+)\}/g, '$1')
      .replace(/\\(?:qquad|quad|left|right|mathrm|mathbf|mathbb)/g, '')
      .replace(/\\([{}[\]()])/g, '$1')
      .replace(/[*_~`$]/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>'),
  )
}

function markdownBlocks(markdown) {
  const blocks = []
  let paragraph = []
  let inFence = false

  const flushParagraph = () => {
    const text = plainInlineMarkdown(paragraph.join(' '))
    if (text) {
      blocks.push({ kind: 'paragraph', text })
    }
    paragraph = []
  }

  for (const sourceLine of markdown.split(/\r?\n/)) {
    const line = sourceLine.replaceAll(/<br\s*\/?>/gi, ' ')
    const trimmed = line.trim()

    if (/^```/.test(trimmed)) {
      flushParagraph()
      inFence = !inFence
      continue
    }

    if (inFence) {
      blocks.push({ kind: 'code', text: pdfAscii(line) || ' ' })
      continue
    }

    if (!trimmed) {
      flushParagraph()
      blocks.push({ kind: 'space' })
      continue
    }

    if (/^(?:---+|\*\*\*+)$/.test(trimmed)) {
      flushParagraph()
      blocks.push({ kind: 'rule' })
      continue
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed)
    if (heading) {
      flushParagraph()
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        text: plainInlineMarkdown(heading[2]),
      })
      continue
    }

    if (/^\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(trimmed)) {
      flushParagraph()
      continue
    }

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushParagraph()
      blocks.push({
        kind: 'table',
        text: plainInlineMarkdown(
          trimmed
            .slice(1, -1)
            .split('|')
            .map((cell) => cell.trim())
            .join(' | '),
        ),
      })
      continue
    }

    const listItem = /^(\s*)([-+*]|\d+\.)\s+(.+)$/.exec(line)
    if (listItem) {
      flushParagraph()
      blocks.push({
        kind: 'list',
        marker: listItem[2].endsWith('.') ? listItem[2] : '*',
        text: plainInlineMarkdown(listItem[3]),
      })
      continue
    }

    if (/^\s{4}/.test(line)) {
      flushParagraph()
      blocks.push({ kind: 'code', text: pdfAscii(line.trimEnd()) || ' ' })
      continue
    }

    if (trimmed.startsWith('>')) {
      flushParagraph()
      blocks.push({
        kind: 'quote',
        text: plainInlineMarkdown(trimmed.replace(/^>\s?/, '')),
      })
      continue
    }

    paragraph.push(trimmed)
  }

  flushParagraph()
  return blocks
}

function breakLongWord(word, limit) {
  const chunks = []
  for (let index = 0; index < word.length; index += limit) {
    chunks.push(word.slice(index, index + limit))
  }
  return chunks
}

function wrapText(text, limit) {
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => (word.length > limit ? breakLongWord(word, limit) : [word]))
  const lines = []
  let current = ''

  for (const word of words) {
    if (!current) {
      current = word
    } else if (`${current} ${word}`.length <= limit) {
      current += ` ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }

  if (current) {
    lines.push(current)
  }

  return lines.length ? lines : [' ']
}

function pdfString(value) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
}

function textCommand({ color = 0, font, size, text, x, y }) {
  return `${color} g BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfString(text)}) Tj ET`
}

function paginateWhitePaper(markdown) {
  const pageWidth = 595.28
  const pageHeight = 841.89
  const marginX = 54
  const top = 780
  const bottom = 54
  const bodyWidth = pageWidth - marginX * 2
  const pages = [[]]
  let y = top

  const currentPage = () => pages.at(-1)
  const newPage = () => {
    pages.push([])
    y = top
  }
  const ensureRoom = (height) => {
    if (y - height < bottom) {
      newPage()
    }
  }
  const addLine = (line, x, style, leading) => {
    ensureRoom(leading)
    currentPage().push({
      ...style,
      text: line,
      x,
      y,
    })
    y -= leading
  }

  for (const block of markdownBlocks(markdown)) {
    if (block.kind === 'space') {
      y -= 4
      continue
    }

    if (block.kind === 'rule') {
      ensureRoom(16)
      currentPage().push({ kind: 'rule', x: marginX, y: y - 4, width: bodyWidth })
      y -= 16
      continue
    }

    if (block.kind === 'heading') {
      const headingStyles = {
        1: { font: 'F2', size: 24, leading: 29, before: 16, after: 10, limit: 38 },
        2: { font: 'F2', size: 16, leading: 20, before: 18, after: 7, limit: 57 },
        3: { font: 'F2', size: 12, leading: 16, before: 13, after: 5, limit: 76 },
        4: { font: 'F2', size: 10.5, leading: 14, before: 10, after: 4, limit: 88 },
      }
      const style = headingStyles[block.level]
      const lines = wrapText(block.text, style.limit)
      const followingTextAllowance = block.level === 1 ? 32 : 28
      ensureRoom(
        style.before +
          lines.length * style.leading +
          style.after +
          followingTextAllowance,
      )
      y -= style.before
      for (const line of lines) {
        addLine(line, marginX, { color: 0.08, font: style.font, size: style.size }, style.leading)
      }
      y -= style.after
      continue
    }

    const blockStyle = {
      code: { color: 0.12, font: 'F3', size: 7.8, leading: 10.5, limit: 104, x: marginX + 10 },
      list: { color: 0.08, font: 'F1', size: 9.4, leading: 13.2, limit: 91, x: marginX + 16 },
      paragraph: { color: 0.08, font: 'F1', size: 9.4, leading: 13.2, limit: 96, x: marginX },
      quote: { color: 0.24, font: 'F4', size: 9.4, leading: 13.2, limit: 90, x: marginX + 18 },
      table: { color: 0.1, font: 'F3', size: 7.4, leading: 10.2, limit: 108, x: marginX + 4 },
    }[block.kind]

    const prefix =
      block.kind === 'list' ? `${block.marker} ` : block.kind === 'quote' ? '> ' : ''
    const lines = wrapText(`${prefix}${block.text}`, blockStyle.limit)
    ensureRoom(lines.length * blockStyle.leading + 5)
    for (const line of lines) {
      addLine(line, blockStyle.x, blockStyle, blockStyle.leading)
    }
    y -= block.kind === 'code' || block.kind === 'table' ? 2 : 5
  }

  for (const [index, page] of pages.entries()) {
    if (index > 0) {
      page.push({
        color: 0.4,
        font: 'F1',
        size: 7.5,
        text: 'WebChess | Research and technical white paper',
        x: marginX,
        y: pageHeight - 34,
      })
    }

    page.push({
      color: 0.4,
      font: 'F1',
      size: 7.5,
      text: `WebChess 2.0.0 | Page ${index + 1} of ${pages.length}`,
      x: marginX,
      y: 28,
    })
  }

  return { pageHeight, pageWidth, pages }
}

function createPdf(markdown) {
  const { pageHeight, pageWidth, pages } = paginateWhitePaper(markdown)
  const objects = new Map()
  const pageObjectIds = []
  const firstPageObjectId = 6

  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>')
  objects.set(
    3,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  )
  objects.set(
    4,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  )
  objects.set(
    5,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
  )

  for (const [index, lines] of pages.entries()) {
    const pageObjectId = firstPageObjectId + index * 2
    const contentObjectId = pageObjectId + 1
    const commands = [
      'q',
      ...lines.map((line) => {
        if (line.kind === 'rule') {
          return `0.62 G 0.7 w ${line.x.toFixed(2)} ${line.y.toFixed(2)} m ${(line.x + line.width).toFixed(2)} ${line.y.toFixed(2)} l S`
        }
        return textCommand(line)
      }),
      'Q',
    ].join('\n')

    pageObjectIds.push(pageObjectId)
    objects.set(
      pageObjectId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 ${firstPageObjectId + pages.length * 2} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
    )
    objects.set(
      contentObjectId,
      `<< /Length ${Buffer.byteLength(commands, 'latin1')} >>\nstream\n${commands}\nendstream`,
    )
  }

  const italicFontObjectId = firstPageObjectId + pages.length * 2
  const infoObjectId = italicFontObjectId + 1
  objects.set(
    italicFontObjectId,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>',
  )
  objects.set(
    infoObjectId,
    '<< /Title (WebChess - Research and technical white paper) /Author (WebChess contributors) /Subject (Problem decomposition, circular chess, symbolic reframing, and AI-assisted synthesis) /Creator (WebChess deterministic download generator) >>',
  )
  objects.set(
    2,
    `<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  )

  const objectCount = infoObjectId
  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  const offsets = Array.from({ length: objectCount + 1 }, () => 0)
  let offset = chunks[0].length

  for (let id = 1; id <= objectCount; id += 1) {
    const object = objects.get(id)
    if (!object) {
      throw new Error(`Missing PDF object ${id}`)
    }
    const chunk = Buffer.from(`${id} 0 obj\n${object}\nendobj\n`, 'latin1')
    offsets[id] = offset
    chunks.push(chunk)
    offset += chunk.length
  }

  const xrefOffset = offset
  const xref = [
    `xref\n0 ${objectCount + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n `),
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info ${infoObjectId} 0 R >>`,
    `startxref\n${xrefOffset}\n%%EOF\n`,
  ].join('\n')
  chunks.push(Buffer.from(xref, 'latin1'))

  return Buffer.concat(chunks)
}

async function main() {
  const [installation, license, whitePaper] = await Promise.all([
    readFile(sourcePaths.installation, 'utf8'),
    readFile(sourcePaths.license, 'utf8'),
    readFile(sourcePaths.whitePaper, 'utf8'),
  ])

  assertDocument('INSTALL.md', installation)
  assertDocument('LICENSE', license)
  assertDocument('docs/WEBCHESS_WHITE_PAPER_V2.md', whitePaper)

  const whitePaperHtml = renderWhitePaperHtml(whitePaper)
  const whitePaperPdf = createPdf(whitePaper)

  await mkdir(downloadDirectory, { recursive: true })
  await Promise.all([
    writeFile(outputPaths.installation, installation, 'utf8'),
    writeFile(outputPaths.license, license, 'utf8'),
    writeFile(outputPaths.whitePaperHtml, whitePaperHtml, 'utf8'),
    writeFile(outputPaths.whitePaperMarkdown, whitePaper, 'utf8'),
    writeFile(outputPaths.whitePaperPdf, whitePaperPdf),
  ])

  console.log(
    `Generated ${Object.keys(outputPaths).length} download artifacts in public/downloads`,
  )
}

await main()
