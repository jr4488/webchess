import { describe, expect, it } from 'vitest'

import {
  downloadableMarkdown,
  downloadablePdfMarkdown,
  pdfAscii,
  renderWhitePaperHtml,
} from './generate-downloads.mjs'

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

  it('pins candidate paper links only when an exact release commit is supplied', () => {
    const commit = '0123456789abcdef0123456789abcdef01234567'
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

  it('removes CommonMark hard-break markers from PDF text', () => {
    const portable = downloadablePdfMarkdown(
      ['**Paper version:** 3.0\\', '**Date:** August 15, 2026'].join('\n'),
    )

    expect(portable).not.toContain('3.0\\')
    expect(portable).toContain(
      '**Paper version:** 3.0\n**Date:** August 15, 2026',
    )
  })
})
