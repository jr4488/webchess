import { describe, expect, it } from 'vitest'

import {
  candidateReleaseUrls,
  candidateWhitePaperWithReleaseHandoff,
  createPdf,
  downloadableMarkdown,
  downloadablePdfMarkdown,
  historicalWhitePaperForDistribution,
  pdfAscii,
  renderWhitePaperHtml,
} from './generate-downloads.mjs'

const releaseCommit = '0123456789abcdef0123456789abcdef01234567'

describe('downloadable white-paper formulas', () => {
  it('preserves logical, set, and boundary operators in PDF-safe text', () => {
    const portable = downloadableMarkdown([
      String.raw`\[`,
      String.raw`\neg P \land Q \iff A \subseteq B`,
      String.raw`(A \cap B) \cup C`,
      String.raw`x \parallel y \Vert z \oplus w`,
      String.raw`\lfloor a \rfloor \le b \le \lceil c \rceil`,
      String.raw`\Delta d = α ± β; § 1`,
      String.raw`\]`,
    ].join('\n'))

    expect(pdfAscii(portable)).toContain('NOT P AND Q <=> A subseteq B')
    expect(pdfAscii(portable)).toContain('(A intersection B) union C')
    expect(pdfAscii(portable)).toContain('x || y || z XOR w')
    expect(pdfAscii(portable)).toContain('floor( a ) <= b <= ceil( c )')
    expect(pdfAscii(portable)).toContain('Delta d = alpha +/- beta; Section 1')
  })

  it('marks the cover image for a stable one-page print constraint', () => {
    const cover = '../public/white-paper/figures/arachne-cover-v3.jpg'
    const html = renderWhitePaperHtml(
      `![Arachne cover](${cover})`,
      new Map([[cover, { dataUri: 'data:image/jpeg;base64,cover' }]]),
    )

    expect(html).toContain('class="white-paper-cover"')
    expect(html).toContain(
      '.white-paper-cover { width: auto; max-height: 220mm; object-fit: contain; }',
    )
  })

  it('pins historical paper links to its immutable source snapshot', () => {
    const html = renderWhitePaperHtml(
      '[Install](../INSTALL.md#requirements)',
      new Map(),
    )

    expect(html).toContain(
      'https://github.com/jr4488/webchess/blob/0384978b2ba709da4c9824f2821c8623d3f84364/INSTALL.md#requirements',
    )
    expect(html).not.toContain('/blob/main/')
  })

  it('wraps the preserved historical manuscript with a retirement warning', () => {
    const source = '# Historical manuscript\n\nOriginal bytes remain evidence.\n'
    const distributed = historicalWhitePaperForDistribution(source)

    expect(distributed).toContain(
      '**HISTORICAL AND RETIRED — not installation or runtime instructions.**',
    )
    expect(distributed).toContain('provider keys/tokens and non-OpenClaw')
    expect(distributed.endsWith(source)).toBe(true)
    expect(source).toBe('# Historical manuscript\n\nOriginal bytes remain evidence.\n')
  })

  it('pins candidate paper links only when an exact release commit is supplied', () => {
    const commit = releaseCommit
    const sourcePath = 'docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md'
    const markdown = '[Install](../INSTALL.md#requirements)'

    expect(renderWhitePaperHtml(markdown, new Map(), {
      sourceCommit: commit,
      sourcePath,
    })).toContain(
      `https://github.com/jr4488/webchess/blob/${commit}/INSTALL.md#requirements`,
    )
    expect(renderWhitePaperHtml(markdown, new Map(), {
      sourceCommit: null,
      sourcePath,
    })).toContain('href="../INSTALL.md#requirements"')
  })

  it('binds every public-reader handoff URL to the exact release commit', () => {
    const source = [
      '# Candidate',
      '',
      '<!-- WEBCHESS_RELEASE_HANDOFF -->',
      '',
      'No DOI and no efficacy claim.',
    ].join('\n')
    const urls = candidateReleaseUrls(releaseCommit)
    const released = candidateWhitePaperWithReleaseHandoff(
      source,
      releaseCommit,
    )

    expect(released).toContain(releaseCommit)
    expect(urls).toEqual({
      install: `https://github.com/jr4488/webchess/blob/${releaseCommit}/INSTALL.md`,
      publicInstall:
        'https://webchess.anansiportia.com/downloads/webchess-installation.md',
      releaseManifest:
        'https://webchess.anansiportia.com/downloads/webchess-release-identity.json',
      sourceArchive:
        `https://webchess.anansiportia.com/downloads/webchess-source-${releaseCommit}.zip`,
      sourceTree:
        `https://github.com/jr4488/webchess/tree/${releaseCommit}`,
    })
    for (const url of Object.values(urls)) {
      expect(released).toContain(`\n${url}\n`)
    }
    expect(released).toContain('not efficacy')
    expect(released).toContain('claims no DOI')
    expect(released).not.toContain('WEBCHESS_RELEASE_HANDOFF')
  })

  it('adds usable URI annotations to the release-bound candidate PDF only', () => {
    const source = [
      '# Candidate',
      '',
      '<!-- WEBCHESS_RELEASE_HANDOFF -->',
    ].join('\n')
    const released = candidateWhitePaperWithReleaseHandoff(
      source,
      releaseCommit,
    )
    const urls = candidateReleaseUrls(releaseCommit)
    const linkedPdf = createPdf(released, '2.2.0-rc.1', new Map(), {
      linkAnnotations: true,
    }).toString('latin1')
    const historicalPathPdf = createPdf(
      released,
      '2.2.0-rc.1',
      new Map(),
    ).toString('latin1')

    expect(linkedPdf).toContain('/Subtype /Link')
    for (const url of Object.values(urls)) {
      expect(linkedPdf).toContain(`/S /URI /URI (${url})`)
    }
    expect(historicalPathPdf).not.toContain('/Subtype /Link')
    expect(historicalPathPdf).not.toContain('/Annots')
  })

  it('labels candidate HTML and PDF metadata with the candidate paper title', () => {
    const title = 'The Arachne Method and WebChess'
    const markdown = `# ${title}`
    const html = renderWhitePaperHtml(markdown, new Map(), {
      documentTitle: title,
    })
    const pdf = createPdf(markdown, '2.2.0-rc.1', new Map(), {
      documentTitle: title,
    }).toString('latin1')

    expect(html).toContain(`<title>${title} — WebChess white paper</title>`)
    expect(pdf).toContain(`/Title (${title})`)
    expect(pdf).not.toContain('/Title (The First Answer Is Not Enough)')
  })

  it('removes CommonMark hard-break markers from PDF text', () => {
    const portable = downloadablePdfMarkdown(
      ['**Paper version:** 3.0\\', '**Date:** August 15, 2026'].join('\n'),
    )

    expect(portable).not.toContain('3.0\\')
    expect(portable).toContain(
      '**Paper version:** 3.0\n**Date:** August 15, 2026',
    )
  })

  it('preserves underscores inside inline-code paths and environment names', () => {
    const pdf = createPdf([
      'The auth-only launcher rejects `OPENAI_API_KEY` by variable name.',
      'See [`docs/CASE_BUNDLES.md`](CASE_BUNDLES.md) and',
      '[`docs/WEBCHESS_WHITE_PAPER_V3.md`](WEBCHESS_WHITE_PAPER_V3.md).',
      'Keep _emphasized prose_ free of Markdown delimiters.',
    ].join('\n\n'), '2.2.0-rc.1', new Map()).toString('latin1')

    expect(pdf).toContain('OPENAI_API_KEY')
    expect(pdf).toContain('docs/CASE_BUNDLES.md')
    expect(pdf).toContain('docs/WEBCHESS_WHITE_PAPER_V3.md')
    expect(pdf.match(/CASE_BUNDLES\.md/g)).toHaveLength(2)
    expect(pdf.match(/WEBCHESS_WHITE_PAPER_V3\.md/g)).toHaveLength(2)
    expect(pdf).toContain('Keep emphasized prose free of Markdown delimiters.')
    expect(pdf).not.toContain('_emphasized prose_')
  })
})
