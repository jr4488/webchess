// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const loaders = vi.hoisted(() => ({
  getApiServices: vi.fn(),
  getDataControlServices: vi.fn(),
}))

vi.mock('./services', () => loaders)

import {
  handleAccountExportRequest,
  handleAccountUsageRequest,
  handleCaseExportRequest,
  handleClerkWebhookRequest,
  handleDeleteAccountRequest,
  handleDivideRequest,
} from './handlers'
import { ApiError } from './errors'
import type {
  HttpDependencies,
  WebChessDataControlServices,
} from './ports'

const GAME_ID = '243af8b3-32f4-471c-a1f8-93a9d3f1501d'

function request(
  path: string,
  options: { body?: unknown; method?: string } = {},
): Request {
  const method = options.method ?? 'POST'
  const headers = new Headers({ origin: 'https://webchess.test' })
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  if (method !== 'GET') {
    headers.set('idempotency-key', '0dcfe214-2779-4476-85e6-12c4fab504ea')
  }
  return new Request(`https://webchess.test${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

describe('Clerk data-control routing', () => {
  let services: WebChessDataControlServices
  let dependencies: Pick<HttpDependencies, 'authenticate' | 'verifySameOrigin'>

  beforeEach(() => {
    vi.clearAllMocks()
    services = {
      getAccountUsage: vi.fn(async () => ({
        period: {
          startsAt: '2026-08-24T00:00:00.000Z',
          endsAt: '2026-08-25T00:00:00.000Z',
        },
        modelOperations: { used: 1, reserved: 0, limit: 10, remaining: 9 },
        gameStarts: { used: 1, reserved: 0, limit: 4, remaining: 3 },
        activeModelRequests: 0,
      })),
      exportAccount: vi.fn(async () => ({
        format: 'webchess-account-export/4',
        games: [],
      })),
      deleteAccountData: vi.fn(async () => undefined),
      handleClerkUserDeleted: vi.fn(async () => undefined),
    }
    loaders.getDataControlServices.mockResolvedValue(services)
    loaders.getApiServices.mockRejectedValue(new ApiError(
      'SERVICE_UNAVAILABLE',
      503,
      'The OpenClaw account-authenticated runtime is required.',
    ))
    dependencies = {
      authenticate: vi.fn(async () => ({
        userId: 'user_clerk_data_controls',
        source: 'clerk' as const,
      })),
      verifySameOrigin: vi.fn(() => null),
    }
  })

  it('serves account status, export, deletion, and verified webhook through only the data-control loader', async () => {
    const usage = await handleAccountUsageRequest(
      request('/api/account/usage', { method: 'GET' }),
      dependencies,
    )
    const exported = await handleAccountExportRequest(
      request('/api/account/export'),
      dependencies,
    )
    const deleted = await handleDeleteAccountRequest(
      request('/api/account', {
        method: 'DELETE',
        body: { confirmation: 'DELETE MY WEBCHESS DATA' },
      }),
      dependencies,
    )
    const webhookRequest = request('/api/webhooks/clerk', {
      body: { type: 'user.deleted' },
    })
    webhookRequest.headers.set('svix-id', 'msg_verified_delete')
    const webhook = await handleClerkWebhookRequest(webhookRequest, {
      verify: vi.fn(async () => ({
        type: 'user.deleted',
        data: { id: 'user_clerk_data_controls' },
      })),
    })

    expect(usage.status).toBe(200)
    expect(exported.status).toBe(200)
    expect(deleted.status).toBe(204)
    expect(webhook.status).toBe(200)
    expect(loaders.getDataControlServices).toHaveBeenCalledTimes(4)
    expect(loaders.getDataControlServices).toHaveBeenCalledWith('clerk')
    expect(loaders.getApiServices).not.toHaveBeenCalled()
    expect(services.getAccountUsage).toHaveBeenCalledOnce()
    expect(services.exportAccount).toHaveBeenCalledOnce()
    expect(services.deleteAccountData).toHaveBeenCalledOnce()
    expect(services.handleClerkUserDeleted).toHaveBeenCalledOnce()
  })

  it('keeps gameplay, model/research, and lifecycle case routes on the fail-closed OpenClaw loader', async () => {
    const divided = await handleDivideRequest(
      request('/api/divide', {
        body: {
          problem: 'Should this Clerk principal ever reach a model?',
          researchConsent: {
            version: 'webchess-research-consent-v1',
            decision: 'no_external_research',
          },
        },
      }),
      dependencies,
    )
    const caseExport = await handleCaseExportRequest(
      request(`/api/games/${GAME_ID}/case-export`, {
        body: { profile: 'research-redacted-v1' },
      }),
      GAME_ID,
      dependencies,
    )

    expect(divided.status).toBe(503)
    expect(caseExport.status).toBe(503)
    expect(loaders.getApiServices).toHaveBeenCalledTimes(2)
    expect(loaders.getApiServices).toHaveBeenCalledWith('clerk')
    expect(loaders.getDataControlServices).not.toHaveBeenCalled()
  })
})
