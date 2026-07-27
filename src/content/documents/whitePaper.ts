import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function loadWhitePaper(): Promise<string> {
  return readFile(join(process.cwd(), 'docs/WEBCHESS_WHITE_PAPER.md'), 'utf8')
}
