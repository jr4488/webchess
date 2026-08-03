import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function loadOperations(): Promise<string> {
  return readFile(
    join(process.cwd(), 'docs/WEBCHESS_2_0_OPERATIONS.md'),
    'utf8',
  )
}
