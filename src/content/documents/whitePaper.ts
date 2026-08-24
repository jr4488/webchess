import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function loadWhitePaper(): Promise<string> {
  return readFile(join(process.cwd(), 'docs/WEBCHESS_WHITE_PAPER_V3.md'), 'utf8')
}

export function loadCandidateWhitePaper(): Promise<string> {
  return readFile(
    join(process.cwd(), 'docs/ARACHNE_METHOD_WHITE_PAPER_3_1.md'),
    'utf8',
  )
}
