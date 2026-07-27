import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function loadInstall(): Promise<string> {
  return readFile(join(process.cwd(), 'INSTALL.md'), 'utf8')
}
