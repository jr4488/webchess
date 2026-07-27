import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function loadTerms(): Promise<string> {
  return readFile(join(process.cwd(), 'docs/TERMS.md'), 'utf8')
}
