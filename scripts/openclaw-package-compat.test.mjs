import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const PINNED_OPENCLAW_RUNTIME = '2026.7.1-2'
const NUMERIC_CORRECTION = /^[vV]?(\d{4}\.[1-9]\d?\.[1-9]\d*)-\d+$/

function pluginApiVersionForNumericCorrection(runtimeVersion) {
  return NUMERIC_CORRECTION.exec(runtimeVersion.trim())?.[1] ?? runtimeVersion
}

describe('packed OpenClaw compatibility metadata', () => {
  it('targets the stable plugin API exposed by the pinned correction runtime', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'))

    expect(packageJson.openclaw?.compat).toEqual({
      minGatewayVersion: PINNED_OPENCLAW_RUNTIME,
      pluginApi: '2026.7.1',
    })
    expect(pluginApiVersionForNumericCorrection(PINNED_OPENCLAW_RUNTIME)).toBe(
      packageJson.openclaw.compat.pluginApi,
    )
  })

  it('does not mistake the correction release label for its plugin API', () => {
    expect(pluginApiVersionForNumericCorrection(PINNED_OPENCLAW_RUNTIME))
      .not.toBe(PINNED_OPENCLAW_RUNTIME)
  })
})
