// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
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

vi.mock('./service-adapter', () => ({
  createApiServices: harness.createHostedServices,
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  harness.localMode.mockReturnValue(false)
  harness.createHostedServices.mockResolvedValue({ kind: 'hosted' })
  harness.getOpenClawServices.mockResolvedValue({ kind: 'openclaw' })
})

describe('principal-bound API service selection', () => {
  it('loads hosted services only for a non-OpenClaw principal', async () => {
    const { getApiServices } = await import('./services')

    await expect(getApiServices('clerk')).resolves.toEqual({ kind: 'hosted' })
    await expect(getApiServices('local-openclaw')).rejects.toMatchObject({
      status: 503,
    })

    expect(harness.createHostedServices).toHaveBeenCalledOnce()
    expect(harness.getOpenClawServices).not.toHaveBeenCalled()
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

  it('fails closed if runtime mode changes after service initialization', async () => {
    const { getApiServices } = await import('./services')
    await expect(getApiServices('clerk')).resolves.toEqual({ kind: 'hosted' })

    harness.localMode.mockReturnValue(true)
    await expect(getApiServices('local-openclaw')).rejects.toMatchObject({
      status: 503,
    })
    expect(harness.getOpenClawServices).not.toHaveBeenCalled()
  })
})
