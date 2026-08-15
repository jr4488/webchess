// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { createPostgresSqlAdapter } from './postgres'

describe('PostgreSQL wire adapter', () => {
  it('rejects an empty connection string before opening a pool', () => {
    expect(() => createPostgresSqlAdapter('')).toThrow(
      /non-empty PostgreSQL connection string/u,
    )
    expect(() => createPostgresSqlAdapter('   ')).toThrow(
      /non-empty PostgreSQL connection string/u,
    )
  })
})
