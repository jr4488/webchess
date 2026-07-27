import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const protectedModules = [
  'auth/config.ts',
  'auth/e2e.ts',
  'auth/index.ts',
  'auth/session.ts',
  'db/index.ts',
  'db/sql.ts',
  'games/index.ts',
  'http/handlers.ts',
  'http/index.ts',
  'http/service-adapter.ts',
  'http/services.ts',
  'openai/client.ts',
  'openai/index.ts',
  'site-origin.ts',
  'usage/config.ts',
  'usage/index.ts',
] as const

describe('server-only module boundary', () => {
  it.each(protectedModules)(
    'poisons client imports of %s',
    (relativePath) => {
      const moduleUrl = new URL(relativePath, import.meta.url)
      const source = readFileSync(moduleUrl, 'utf8')

      expect(source).toMatch(/^import 'server-only'\s*$/mu)
    },
  )
})
