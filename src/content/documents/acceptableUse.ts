import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function loadAcceptableUse(): Promise<string> {
  return readFile(join(process.cwd(), 'docs/ACCEPTABLE_USE.md'), 'utf8')
}
