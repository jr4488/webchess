import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function loadContributing(): Promise<string> {
  return readFile(join(process.cwd(), 'CONTRIBUTING.md'), 'utf8')
}
