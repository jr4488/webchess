// @vitest-environment node

import { describe, expect, it } from 'vitest'

describe('retired hosted and source-checkout service bootstrap', () => {
  it('fails closed without reading runtime configuration', async () => {
    const { createApiServices } = await import('./service-adapter')

    await expect(createApiServices()).rejects.toMatchObject({ status: 503 })
    await expect(createApiServices()).rejects.toThrow(
      /hosted and source-checkout service adapters are retired/u,
    )
  })
})
