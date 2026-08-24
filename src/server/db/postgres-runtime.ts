import { createRequire } from 'node:module'

import type { Pool } from 'pg'

const requireFromHere = createRequire(import.meta.url)

/**
 * Loads node-postgres only after local-runtime environment validation.
 * Keeping this lazy prevents NODE_PG_FORCE_NATIVE from affecting hosted Neon
 * processes that import the shared database module but never use a local Pool.
 */
export function loadPostgresPool(): typeof Pool {
  const postgres = requireFromHere('pg') as typeof import('pg')
  return postgres.Pool
}
