import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function loadPrivacy(): Promise<string> {
  return readFile(join(process.cwd(), 'docs/PRIVACY.md'), 'utf8')
}
