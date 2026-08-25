// @vitest-environment node

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

import type { SqlAdapter } from '../db'
import type { UsageController } from '../usage'
import { createDataControlServicesWithDependencies } from './data-control-service-core'

const OWNER_ID = 'user_data_controls'

function runtimeModuleSpecifiers(filePath: string): readonly string[] {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const specifiers: string[] = []

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      if (clause?.isTypeOnly) continue
      if (
        clause &&
        !clause.name &&
        clause.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.every((element) => element.isTypeOnly)
      ) {
        continue
      }
      if (ts.isStringLiteralLike(statement.moduleSpecifier)) {
        specifiers.push(statement.moduleSpecifier.text)
      }
      continue
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      !statement.isTypeOnly &&
      !(
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.every((element) => element.isTypeOnly)
      )
    ) {
      specifiers.push(statement.moduleSpecifier.text)
    }
  }

  return specifiers
}

function resolveSourceModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const unresolved = resolve(
    dirname(fromFile),
    specifier.replace(/\.(?:js|mjs)$/u, ''),
  )
  const candidates = [
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    `${unresolved}.mjs`,
    resolve(unresolved, 'index.ts'),
    resolve(unresolved, 'index.tsx'),
  ]
  return candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  ) ?? null
}

function runtimeSourceGraph(entryFile: string): readonly string[] {
  const pending = [entryFile]
  const visited = new Set<string>()

  while (pending.length > 0) {
    const filePath = pending.pop()
    if (!filePath || visited.has(filePath)) continue
    visited.add(filePath)
    for (const specifier of runtimeModuleSpecifiers(filePath)) {
      const dependency = resolveSourceModule(filePath, specifier)
      if (dependency && !visited.has(dependency)) pending.push(dependency)
    }
  }

  return [...visited].sort()
}

function projectPath(filePath: string): string {
  return relative(process.cwd(), filePath).split(sep).join('/')
}

function ownerContext() {
  return {
    ownerId: OWNER_ID,
    requestId: 'request-data-controls',
    signal: new AbortController().signal,
  }
}

describe('data-control-only service adapter', () => {
  it('keeps its complete runtime source graph inside DB, usage, and HTTP data-control boundaries', () => {
    const graph = runtimeSourceGraph(resolve(
      process.cwd(),
      'src/server/http/data-control-service-adapter.ts',
    )).map(projectPath)
    const allowedHttpModules = new Set([
      'src/server/http/data-control-service-adapter.ts',
      'src/server/http/data-control-service-core.ts',
      'src/server/http/errors.ts',
      'src/server/http/usage-error.ts',
    ])
    const outsideBoundary = graph.filter((filePath) =>
      filePath !== 'src/types.ts' &&
      filePath !== 'src/server/model-operation-timeouts.ts' &&
      !filePath.startsWith('src/server/db/') &&
      !filePath.startsWith('src/server/usage/') &&
      !allowedHttpModules.has(filePath),
    )

    expect(graph).toContain('src/server/http/data-control-service-core.ts')
    expect(graph).not.toContain('src/server/http/service-adapter.ts')
    expect(outsideBoundary).toEqual([])
    expect(graph.filter((filePath) =>
      /^src\/server\/(?:case-bundle|games|lifecycle|openai|openclaw|research)(?:\/|\.ts$)/u
        .test(filePath),
    )).toEqual([])
  })

  it('exposes and executes only usage, export, and deletion controls', async () => {
    const usage = {
      consumeAccountExportRate: vi.fn(async () => ({ ok: true })),
      deleteAccountData: vi.fn(async () => ({ ok: true, deleted: true })),
      getUsageSummary: vi.fn(async () => ({
        period: {
          startsAt: '2026-08-24T00:00:00.000Z',
          endsAt: '2026-08-25T00:00:00.000Z',
        },
        modelOperations: { used: 3, reserved: 0, limit: 10, remaining: 7 },
        gameStarts: { used: 1, reserved: 0, limit: 4, remaining: 3 },
        activeModelRequests: 0,
      })),
    } as unknown as UsageController
    const results = [
      { rows: [{ estimatedBytes: '100' }] },
      { rows: [{ suspended: false }] },
      ...Array.from({ length: 17 }, () => ({ rows: [] })),
    ]
    const database = {
      transaction: vi.fn(async () => results),
    } as unknown as SqlAdapter
    const services = createDataControlServicesWithDependencies({
      accountExportMaxBytes: 100_000,
      database,
      hmacSecret: 'data-control-hmac-secret-material-32-bytes',
      usage,
    })

    expect(Object.keys(services).sort()).toEqual([
      'deleteAccountData',
      'exportAccount',
      'getAccountUsage',
      'handleClerkUserDeleted',
    ])
    expect(services).not.toHaveProperty('divide')
    expect(services).not.toHaveProperty('answer')
    expect(services).not.toHaveProperty('runPortia')
    expect(services).not.toHaveProperty('runCharlotte')
    expect(services).not.toHaveProperty('exportCase')

    await expect(services.getAccountUsage(ownerContext())).resolves.toMatchObject({
      activeModelRequests: 0,
      modelOperations: { remaining: 7 },
    })
    await expect(services.exportAccount({
      ...ownerContext(),
      ipAddress: '203.0.113.44',
    })).resolves.toMatchObject({
      format: 'webchess-account-export/4',
      controls: { suspended: false },
      games: [],
    })
    await expect(services.deleteAccountData({
      ...ownerContext(),
      idempotencyKey: '64bf718b-593c-418d-b010-d52050f13ebf',
      ipAddress: '203.0.113.44',
    })).resolves.toBeUndefined()
    await expect(services.handleClerkUserDeleted({
      clerkUserId: OWNER_ID,
      webhookEventId: 'msg_verified_delete',
      requestId: 'request-webhook',
    })).resolves.toBeUndefined()

    expect(usage.consumeAccountExportRate).toHaveBeenCalledWith({
      userId: OWNER_ID,
      ipAddress: '203.0.113.44',
    })
    expect(usage.deleteAccountData).toHaveBeenNthCalledWith(1, OWNER_ID)
    expect(usage.deleteAccountData).toHaveBeenNthCalledWith(
      2,
      OWNER_ID,
      { force: true },
    )
    expect(database.transaction).toHaveBeenCalledWith(
      expect.any(Array),
      { isolationLevel: 'RepeatableRead', readOnly: true },
    )
  })
})
