// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  createDataControlServices: vi.fn(),
  createHostedServices: vi.fn(),
  getOpenClawServices: vi.fn(),
  localMode: vi.fn(),
}))

vi.mock('../openclaw/config', () => ({
  isOpenClawLocalModeEnabled: harness.localMode,
}))

vi.mock('../openclaw/services', () => ({
  getOpenClawApiServices: harness.getOpenClawServices,
}))

vi.mock('./data-control-service-adapter', () => ({
  createDataControlServices: harness.createDataControlServices,
}))

vi.mock('./service-adapter', () => ({
  createApiServices: harness.createHostedServices,
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  harness.localMode.mockReturnValue(false)
  harness.createDataControlServices.mockResolvedValue({
    deleteAccountData: vi.fn(),
    exportAccount: vi.fn(),
    getAccountUsage: vi.fn(),
    handleClerkUserDeleted: vi.fn(),
  })
  harness.createHostedServices.mockResolvedValue({ kind: 'hosted' })
  harness.getOpenClawServices.mockResolvedValue({ kind: 'openclaw' })
})

describe('principal-bound API service selection', () => {
  it('rejects every non-OpenClaw principal without loading a provider adapter', async () => {
    const { getApiServices } = await import('./services')

    for (const source of ['clerk', 'local-e2e', 'local-hosted'] as const) {
      await expect(getApiServices(source)).rejects.toMatchObject({ status: 503 })
    }

    expect(harness.localMode).not.toHaveBeenCalled()
    expect(harness.createHostedServices).not.toHaveBeenCalled()
    expect(harness.createDataControlServices).not.toHaveBeenCalled()
    expect(harness.getOpenClawServices).not.toHaveBeenCalled()
  })

  it('loads only the four-method data-control graph for Clerk', async () => {
    const { getDataControlServices } = await import('./services')

    const services = await getDataControlServices('clerk')

    expect(Object.keys(services).sort()).toEqual([
      'deleteAccountData',
      'exportAccount',
      'getAccountUsage',
      'handleClerkUserDeleted',
    ])
    await expect(getDataControlServices('local-e2e')).rejects.toMatchObject({
      status: 503,
    })
    await expect(getDataControlServices('local-hosted')).rejects.toMatchObject({
      status: 503,
    })
    await expect(getDataControlServices('local-openclaw')).rejects.toMatchObject({
      status: 503,
    })

    expect(harness.createDataControlServices).toHaveBeenCalledOnce()
    expect(harness.getOpenClawServices).not.toHaveBeenCalled()
    expect(harness.createHostedServices).not.toHaveBeenCalled()
    expect(services).not.toHaveProperty('divide')
    expect(services).not.toHaveProperty('exportCase')
  })

  it('loads local services only for the authenticated OpenClaw principal', async () => {
    harness.localMode.mockReturnValue(true)
    const { getApiServices } = await import('./services')

    await expect(getApiServices('local-openclaw')).resolves.toEqual({
      kind: 'openclaw',
    })
    await expect(getApiServices('clerk')).rejects.toMatchObject({ status: 503 })
    await expect(getApiServices('local-e2e')).rejects.toMatchObject({ status: 503 })
    await expect(getApiServices('local-hosted')).rejects.toMatchObject({ status: 503 })

    expect(harness.getOpenClawServices).toHaveBeenCalledOnce()
    expect(harness.createHostedServices).not.toHaveBeenCalled()
  })

  it('fails closed when the OpenClaw runtime is disabled', async () => {
    const { getApiServices } = await import('./services')

    await expect(getApiServices('local-openclaw')).rejects.toMatchObject({
      status: 503,
    })

    expect(harness.getOpenClawServices).not.toHaveBeenCalled()
    expect(harness.createHostedServices).not.toHaveBeenCalled()
  })

  it('fails closed if the OpenClaw runtime is disabled after initialization', async () => {
    harness.localMode.mockReturnValue(true)
    const { getApiServices } = await import('./services')
    await expect(getApiServices('local-openclaw')).resolves.toEqual({
      kind: 'openclaw',
    })

    harness.localMode.mockReturnValue(false)
    await expect(getApiServices('local-openclaw')).rejects.toMatchObject({
      status: 503,
    })
    expect(harness.getOpenClawServices).toHaveBeenCalledOnce()
    expect(harness.createHostedServices).not.toHaveBeenCalled()
  })

  it('rechecks cached OpenClaw reconciliation readiness on every request', async () => {
    harness.localMode.mockReturnValue(true)
    harness.getOpenClawServices
      .mockResolvedValueOnce({ kind: 'openclaw' })
      .mockRejectedValueOnce(new Error('durable reconciliation unavailable'))
    const { getApiServices } = await import('./services')

    await expect(getApiServices('local-openclaw')).resolves.toEqual({
      kind: 'openclaw',
    })
    await expect(getApiServices('local-openclaw')).rejects.toThrow(
      'durable reconciliation unavailable',
    )
    expect(harness.getOpenClawServices).toHaveBeenCalledTimes(2)
  })
})
