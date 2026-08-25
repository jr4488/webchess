import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { sha256Utf8Hex, utf8ByteLength } from './browser-sha256'

describe('browser-safe SHA-256', () => {
  it.each([
    '',
    'abc',
    'Arachne trajectory: 乾之乾 🕸️',
    'x'.repeat(1_000_000),
  ])('matches Node SHA-256 for bounded UTF-8 input', (value) => {
    expect(sha256Utf8Hex(value)).toBe(
      createHash('sha256').update(value, 'utf8').digest('hex'),
    )
    expect(utf8ByteLength(value)).toBe(Buffer.byteLength(value, 'utf8'))
  })
})
