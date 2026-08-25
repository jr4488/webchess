import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const protectedModules = [
  'auth/config.ts',
  'auth/e2e.ts',
  'auth/local-session.ts',
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

  it('keeps browser-side directional prompt verification free of Node built-ins', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/lifecycle/trajectory-direction.ts'),
      'utf8',
    )

    expect(source).not.toMatch(/from ['"]node:/u)
    expect(source).not.toContain('Buffer.')
  })
})
