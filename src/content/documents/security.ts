import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function loadSecurity(): Promise<string> {
  return readFile(join(process.cwd(), 'SECURITY.md'), 'utf8')
}
