import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createElement, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const downloadDirectory = join(repositoryRoot, 'public', 'downloads')
const candidateWhitePaperRepositoryPath =
  'docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md'
const historicalWhitePaperRepositoryPath = 'docs/WEBCHESS_WHITE_PAPER_V3.md'
const historicalWhitePaperSourceCommit =
  '0384978b2ba709da4c9824f2821c8623d3f84364'
const historicalWhitePaperSoftwareVersion = '2.2.0'

const sourcePaths = {
  installation: join(repositoryRoot, 'INSTALL.md'),
  license: join(repositoryRoot, 'LICENSE'),
  package: join(repositoryRoot, 'package.json'),
  candidateWhitePaper: join(
    repositoryRoot,
    candidateWhitePaperRepositoryPath,
  ),
  historicalWhitePaper: join(
    repositoryRoot,
    historicalWhitePaperRepositoryPath,
  ),
}

const outputPaths = {
  candidateWhitePaperHtml: join(
    downloadDirectory,
    'webchess-white-paper.html',
  ),
  candidateWhitePaperMarkdown: join(
    downloadDirectory,
    'webchess-white-paper.md',
  ),
  candidateWhitePaperPdf: join(
    downloadDirectory,
    'webchess-white-paper.pdf',
  ),
  installation: join(downloadDirectory, 'webchess-installation.md'),
  license: join(downloadDirectory, 'LICENSE'),
  historicalWhitePaperHtml: join(
    downloadDirectory,
    'webchess-white-paper-v3-historical.html',
  ),
  historicalWhitePaperMarkdown: join(
    downloadDirectory,
    'webchess-white-paper-v3-historical.md',
  ),
  historicalWhitePaperPdf: join(
    downloadDirectory,
    'webchess-white-paper-v3-historical.pdf',
  ),
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

function replaceBraceCommand(expression, command, argumentCount, render) {
  const token = '\\' + command
  let result = expression
  let offset = 0

  while (offset < result.length) {
    const start = result.indexOf(token, offset)
    if (start === -1) {
      break
    }

    let cursor = start + token.length
    const argumentsFound = []
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

function readableInlineMath(expression) {
  const commandCharacters = {
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
  result = replaceBraceCommand(result, 'binom', 2, ([top, bottom]) => 'C(' + top + ', ' + bottom + ')')
  result = replaceBraceCommand(result, 'frac', 2, ([top, bottom]) => '(' + top + ') / (' + bottom + ')')
  result = replaceBraceCommand(result, 'pmod', 1, ([modulus]) => '(mod ' + modulus + ')')
  result = replaceBraceCommand(result, 'mathbin', 1, ([content]) => content)
  result = replaceBraceCommand(result, 'boxed', 1, ([content]) => content)

  return result
    .replace(/\\begin\{cases\}/gu, 'cases:')
    .replace(/\\end\{cases\}/gu, '')
    .replace(/\\(?:left|right)\b/gu, '')
    .replace(/_\{([^{}]+)\}/gu, '_$1')
    .replace(/\^\{([^{}]+)\}/gu, '^$1')
    .replace(/\\(Delta|Vert|bmod|cap|cdots|cup|exists|ge|iff|in|lambda|land|lceil|ldots|le|leftarrow|lfloor|max|min|neg|oplus|parallel|pi|quad|qquad|rceil|rfloor|rightarrow|subseteq|sum|times)(?![A-Za-z])/gu, (_match, command) => commandCharacters[command])
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

function portableInlineMath(line) {
  return line.replace(/\\\((.+?)\\\)/gu, (_match, expression) => `\`${readableInlineMath(expression)}\``)
}

function downloadableMarkdown(source) {
  const output = []
  let expression = null
  let expressionClose = null
  let expressionOpen = null

  for (const sourceLine of source.split(/\r?\n/)) {
    const lines = sourceLine.replaceAll(/<br\s*\/?>/gi, '  \n').split('\n')

    for (const line of lines) {
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
  }

  if (expression !== null) {
    output.push(expressionOpen ?? String.raw`\[`, ...expression)
  }

  return output.join('\n')
}

function downloadablePdfMarkdown(source) {
  return downloadableMarkdown(source).replace(/\\(?=\r?$)/gmu, '')
}

function repositoryHref(
  sourcePath,
  href,
  sourceCommit = historicalWhitePaperSourceCommit,
) {
  if (
    !href ||
    href.startsWith('#') ||
    href.startsWith('/') ||
    /^[a-z][a-z\d+.-]*:/i.test(href)
  ) {
    return href
  }

  if (sourceCommit === null) {
    return href
  }
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) {
    throw new Error('White-paper source links require an exact lowercase commit.')
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
  return `${repositoryUrl}/blob/${sourceCommit}/${normalizedParts.join('/')}${suffix}`
}

function renderWhitePaperHtml(
  markdown,
  images,
  {
    sourceCommit = historicalWhitePaperSourceCommit,
    sourcePath = historicalWhitePaperRepositoryPath,
  } = {},
) {
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
                href: repositoryHref(sourcePath, href, sourceCommit),
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
          img: ({ alt, src, title }) =>
            createElement('img', {
              alt: alt ?? '',
              className: src?.includes('arachne-cover-v3.jpg')
                ? 'white-paper-cover'
                : undefined,
              decoding: 'async',
              loading: 'lazy',
              src: images.get(src)?.dataUri ?? src,
              title,
            }),
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
  <title>The First Answer Is Not Enough — WebChess white paper</title>
  <meta name="description" content="The repository-backed WebChess paper on the Arachne Method and AI-assisted deliberation before decision.">
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
    img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 2rem auto;
      border: 1px solid #a8b0a7;
      border-radius: 0.3rem;
      box-shadow: 0 1rem 2.5rem rgba(16, 42, 27, 0.12);
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
    @page { size: A4; margin: 14mm 13mm 15mm; }
    @media print {
      :root { background: #fff; color: #111; font-size: 10.5pt; }
      main { width: auto; margin: 0; padding: 0; }
      h1, h2, h3, h4 { break-after: avoid; color: #111; text-wrap: auto; }
      pre, blockquote, img, tr { break-inside: avoid; }
      pre { overflow: visible; white-space: pre-wrap; overflow-wrap: anywhere; }
      .white-paper-cover { width: auto; max-height: 220mm; object-fit: contain; }
      .table-wrap { overflow: visible; border: 0; }
      table { width: 100%; table-layout: fixed; break-inside: auto; }
      thead { display: table-header-group; }
      th, td { min-width: 0; padding: 0.45rem; font-size: 8.5pt; overflow-wrap: anywhere; }
      #references + ol > li { break-inside: avoid; }
      a { color: #111; text-decoration: none; }
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

function markdownImageReferences(markdown) {
  const references = new Set()
  const pattern = /!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'))?\)/gu
  let match

  while ((match = pattern.exec(markdown)) !== null) {
    references.add(match[1] ?? match[2])
  }

  return [...references]
}

function localImagePath(href) {
  if (!href || /^(?:data:|https?:|#)/iu.test(href)) {
    return null
  }

  const cleanHref = href.split(/[?#]/u, 1)[0]
  const absolutePath = resolve(dirname(sourcePaths.whitePaper), decodeURI(cleanHref))
  const repositoryRelativePath = relative(repositoryRoot, absolutePath)
  if (
    !repositoryRelativePath ||
    repositoryRelativePath.startsWith('..') ||
    resolve(repositoryRoot, repositoryRelativePath) !== absolutePath ||
    !repositoryRelativePath.startsWith('public/')
  ) {
    return null
  }

  return absolutePath
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('PDF figures must be JPEG images')
  }

  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ])
  let offset = 2

  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (buffer[offset] === 0xff) {
      offset += 1
    }
    const marker = buffer[offset]
    offset += 1
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue
    }
    if (offset + 2 > buffer.length) {
      break
    }
    const segmentLength = buffer.readUInt16BE(offset)
    if (startOfFrameMarkers.has(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      }
    }
    if (segmentLength < 2) {
      break
    }
    offset += segmentLength
  }

  throw new Error('Could not read JPEG dimensions')
}

async function loadWhitePaperImages(markdown) {
  const images = new Map()

  for (const href of markdownImageReferences(markdown)) {
    const path = localImagePath(href)
    if (!path) {
      continue
    }
    const extension = extname(path).toLowerCase()
    if (extension !== '.jpg' && extension !== '.jpeg') {
      throw new Error(`PDF figure must be JPEG: ${href}`)
    }
    const data = await readFile(path)
    const dimensions = jpegDimensions(data)
    images.set(href, {
      ...dimensions,
      data,
      dataUri: `data:image/jpeg;base64,${data.toString('base64')}`,
      name: `Im${images.size + 1}`,
      source: href,
    })
  }

  return images
}

const replacementCharacters = new Map([
  ['\u00a0', ' '],
  ['\u00a7', 'Section '],
  ['\u00ad', ''],
  ['\u00b1', '+/-'],
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
  ['\u2016', '||'],
  ['\u2032', "'"],
  ['\u2033', '"'],
  ['\u2190', '<-'],
  ['\u2191', '^'],
  ['\u2192', '->'],
  ['\u2193', 'v'],
  ['\u21d2', '=>'],
  ['\u21d4', '<=>'],
  ['\u2227', ' AND '],
  ['\u2229', ' intersection '],
  ['\u222a', ' union '],
  ['\u2225', '||'],
  ['\u2226', '||'],
  ['\u2295', ' XOR '],
  ['\u2212', '-'],
  ['\u2217', '*'],
  ['\u221e', 'infinity'],
  ['\u2286', ' subseteq '],
  ['\u2308', 'ceil('],
  ['\u2309', ')'],
  ['\u230a', 'floor('],
  ['\u230b', ')'],
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
  ['\u0394', 'Delta'],
  ['\u03b1', 'alpha'],
  ['\u03b2', 'beta'],
  ['\u03a0', 'Pi'],
  ['\u03c3', 'sigma'],
  ['\u03a3', 'Sigma'],
  ['\u03b8', 'theta'],
  ['\u03bb', 'lambda'],
  ['\u00ac', 'NOT '],
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

    if (/^(?:```|~~~)/.test(trimmed)) {
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

    const image = /^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'))?\)$/u.exec(trimmed)
    if (image) {
      flushParagraph()
      blocks.push({
        alt: plainInlineMarkdown(image[1]),
        kind: 'image',
        src: image[2] ?? image[3],
      })
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

function paginateWhitePaper(markdown, softwareVersion, images) {
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

    if (block.kind === 'image') {
      const image = images.get(block.src)
      if (!image) {
        const fallback = block.alt ? `[Figure: ${block.alt}]` : '[Figure unavailable]'
        addLine(fallback, marginX, { color: 0.28, font: 'F4', size: 8.5 }, 12)
        y -= 6
        continue
      }
      const maximumHeight = image.source.includes('cover') ? 480 : 410
      const scale = Math.min(bodyWidth / image.width, maximumHeight / image.height)
      const width = image.width * scale
      const height = image.height * scale
      ensureRoom(height + 18)
      const x = marginX + (bodyWidth - width) / 2
      currentPage().push({
        height,
        imageName: image.name,
        kind: 'image',
        width,
        x,
        y: y - height,
      })
      y -= height + 18
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
      text: `WebChess ${softwareVersion} | Page ${index + 1} of ${pages.length}`,
      x: marginX,
      y: 28,
    })
  }

  return { pageHeight, pageWidth, pages }
}

function createPdf(markdown, softwareVersion, images) {
  const { pageHeight, pageWidth, pages } = paginateWhitePaper(
    markdown,
    softwareVersion,
    images,
  )
  const objects = new Map()
  const pageObjectIds = []
  const firstPageObjectId = 6
  const italicFontObjectId = firstPageObjectId + pages.length * 2
  const imageObjectIds = new Map()
  let nextObjectId = italicFontObjectId + 1
  for (const image of images.values()) {
    imageObjectIds.set(image.name, nextObjectId)
    nextObjectId += 1
  }
  const infoObjectId = nextObjectId
  const imageResources = [...imageObjectIds.entries()]
    .map(([name, id]) => `/${name} ${id} 0 R`)
    .join(' ')

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
  objects.set(
    italicFontObjectId,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>',
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
        if (line.kind === 'image') {
          return `q ${line.width.toFixed(2)} 0 0 ${line.height.toFixed(2)} ${line.x.toFixed(2)} ${line.y.toFixed(2)} cm /${line.imageName} Do Q`
        }
        return textCommand(line)
      }),
      'Q',
    ].join('\n')
    const xObjectResources = imageResources
      ? ` /XObject << ${imageResources} >>`
      : ''

    pageObjectIds.push(pageObjectId)
    objects.set(
      pageObjectId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 ${italicFontObjectId} 0 R >>${xObjectResources} >> /Contents ${contentObjectId} 0 R >>`,
    )
    objects.set(
      contentObjectId,
      `<< /Length ${Buffer.byteLength(commands, 'latin1')} >>\nstream\n${commands}\nendstream`,
    )
  }

  for (const image of images.values()) {
    const imageObjectId = imageObjectIds.get(image.name)
    const header = Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n`,
      'latin1',
    )
    objects.set(
      imageObjectId,
      Buffer.concat([header, image.data, Buffer.from('\nendstream', 'latin1')]),
    )
  }

  objects.set(
    infoObjectId,
    '<< /Title (The First Answer Is Not Enough) /Author (WebChess contributors) /Subject (The Arachne Method for AI-assisted deliberation before decision) /Creator (WebChess deterministic download generator) >>',
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
    const objectBuffer = Buffer.isBuffer(object)
      ? object
      : Buffer.from(object, 'latin1')
    const chunk = Buffer.concat([
      Buffer.from(`${id} 0 obj\n`, 'latin1'),
      objectBuffer,
      Buffer.from('\nendobj\n', 'latin1'),
    ])
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
  const [
    installation,
    license,
    packageSource,
    candidateWhitePaper,
    historicalWhitePaper,
  ] = await Promise.all([
    readFile(sourcePaths.installation, 'utf8'),
    readFile(sourcePaths.license, 'utf8'),
    readFile(sourcePaths.package, 'utf8'),
    readFile(sourcePaths.candidateWhitePaper, 'utf8'),
    readFile(sourcePaths.historicalWhitePaper, 'utf8'),
  ])

  assertDocument('INSTALL.md', installation)
  assertDocument('LICENSE', license)
  assertDocument('package.json', packageSource)
  assertDocument(candidateWhitePaperRepositoryPath, candidateWhitePaper)
  assertDocument(historicalWhitePaperRepositoryPath, historicalWhitePaper)

  const softwareVersion = JSON.parse(packageSource).version
  if (
    typeof softwareVersion !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/u.test(softwareVersion)
  ) {
    throw new Error('package.json must provide a semantic software version')
  }

  const configuredSourceCommit = process.env.WEBCHESS_RELEASE_SOURCE_SHA
    ?.trim()
    .toLowerCase() ?? null
  if (
    configuredSourceCommit !== null &&
    !/^[0-9a-f]{40}$/u.test(configuredSourceCommit)
  ) {
    throw new Error(
      'WEBCHESS_RELEASE_SOURCE_SHA must be an exact 40-character hexadecimal commit.',
    )
  }

  const [candidateImages, historicalImages] = await Promise.all([
    loadWhitePaperImages(candidateWhitePaper),
    loadWhitePaperImages(historicalWhitePaper),
  ])
  const candidateWhitePaperHtml = renderWhitePaperHtml(
    candidateWhitePaper,
    candidateImages,
    {
      sourceCommit: configuredSourceCommit,
      sourcePath: candidateWhitePaperRepositoryPath,
    },
  )
  const candidateWhitePaperPdf = createPdf(
    downloadablePdfMarkdown(candidateWhitePaper),
    softwareVersion,
    candidateImages,
  )
  const historicalWhitePaperHtml = renderWhitePaperHtml(
    historicalWhitePaper,
    historicalImages,
  )
  const historicalWhitePaperPdf = createPdf(
    downloadablePdfMarkdown(historicalWhitePaper),
    historicalWhitePaperSoftwareVersion,
    historicalImages,
  )

  await mkdir(downloadDirectory, { recursive: true })
  const writes = [
    writeFile(outputPaths.installation, installation, 'utf8'),
    writeFile(outputPaths.license, license, 'utf8'),
    writeFile(
      outputPaths.historicalWhitePaperHtml,
      historicalWhitePaperHtml,
      'utf8',
    ),
    writeFile(
      outputPaths.historicalWhitePaperMarkdown,
      historicalWhitePaper,
      'utf8',
    ),
    writeFile(
      outputPaths.historicalWhitePaperPdf,
      historicalWhitePaperPdf,
    ),
  ]
  if (configuredSourceCommit === null) {
    writes.push(...[
      rm(outputPaths.candidateWhitePaperHtml, { force: true }),
      rm(outputPaths.candidateWhitePaperMarkdown, { force: true }),
      rm(outputPaths.candidateWhitePaperPdf, { force: true }),
    ])
  } else {
    writes.push(...[
      writeFile(
        outputPaths.candidateWhitePaperHtml,
        candidateWhitePaperHtml,
        'utf8',
      ),
      writeFile(
        outputPaths.candidateWhitePaperMarkdown,
        candidateWhitePaper,
        'utf8',
      ),
      writeFile(
        outputPaths.candidateWhitePaperPdf,
        candidateWhitePaperPdf,
      ),
    ])
  }
  await Promise.all(writes)

  console.log(
    `Generated ${configuredSourceCommit === null ? 5 : 8} download artifacts in public/downloads`,
  )
}

export {
  downloadableMarkdown,
  downloadablePdfMarkdown,
  pdfAscii,
  readableInlineMath,
  renderWhitePaperHtml,
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main()
}
