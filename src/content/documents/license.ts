import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function loadLicense(): Promise<string> {
  return readFile(join(process.cwd(), 'LICENSE'), 'utf8')
}
