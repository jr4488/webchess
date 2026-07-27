import { describe, expect, it } from 'vitest'

import {
  LOCAL_SITE_ORIGIN,
  PRODUCTION_SITE_ORIGIN,
  resolveSiteOrigin,
} from './site-origin'

describe('resolveSiteOrigin', () => {
  it('uses the local origin only outside Vercel', () => {
    expect(resolveSiteOrigin({})).toBe(LOCAL_SITE_ORIGIN)
    expect(
      resolveSiteOrigin({
        NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
      }),
    ).toBe('http://127.0.0.1:3000')
  })

  it('uses an exact HTTPS origin configured for Preview', () => {
    expect(
      resolveSiteOrigin({
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        NEXT_PUBLIC_SITE_URL:
          'https://webchess-stable-preview.vercel.app',
      }),
    ).toBe('https://webchess-stable-preview.vercel.app')
  })

  it('derives a Preview origin from VERCEL_URL', () => {
    expect(
      resolveSiteOrigin({
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'webchess-preview-abc.vercel.app',
      }),
    ).toBe('https://webchess-preview-abc.vercel.app')
  })

  it('uses VERCEL_TARGET_ENV when that is the available target marker', () => {
    expect(
      resolveSiteOrigin({
        VERCEL_TARGET_ENV: 'preview',
        VERCEL_URL: 'webchess-preview-abc.vercel.app',
      }),
    ).toBe('https://webchess-preview-abc.vercel.app')
  })

  it('rejects conflicting or unsupported deployment targets', () => {
    expect(() =>
      resolveSiteOrigin({
        VERCEL_ENV: 'preview',
        VERCEL_TARGET_ENV: 'production',
        VERCEL_URL: 'webchess-preview-abc.vercel.app',
      }),
    ).toThrow(
      'VERCEL_ENV and VERCEL_TARGET_ENV must identify the same target',
    )

    expect(() =>
      resolveSiteOrigin({
        VERCEL_TARGET_ENV: 'development',
        VERCEL_URL: 'webchess-preview-abc.vercel.app',
      }),
    ).toThrow(
      'A Vercel deployment must identify VERCEL_ENV or VERCEL_TARGET_ENV as preview or production',
    )
  })

  it('rejects an invalid VERCEL_URL hostname', () => {
    expect(() =>
      resolveSiteOrigin({
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'webchess-preview.vercel.app/untrusted-path',
      }),
    ).toThrow('VERCEL_URL must contain only a deployment hostname')
  })

  it('never falls back to localhost on Vercel', () => {
    expect(() =>
      resolveSiteOrigin({
        VERCEL: '1',
        VERCEL_ENV: 'preview',
      }),
    ).toThrow(
      'A Vercel deployment requires NEXT_PUBLIC_SITE_URL or VERCEL_URL',
    )
    expect(() =>
      resolveSiteOrigin({
        VERCEL: '1',
      }),
    ).toThrow(
      'A Vercel deployment must identify VERCEL_ENV or VERCEL_TARGET_ENV as preview or production',
    )
  })

  it('requires the approved origin in Production', () => {
    expect(
      resolveSiteOrigin({
        VERCEL: '1',
        VERCEL_ENV: 'production',
        NEXT_PUBLIC_SITE_URL: PRODUCTION_SITE_ORIGIN,
      }),
    ).toBe(PRODUCTION_SITE_ORIGIN)

    expect(() =>
      resolveSiteOrigin({
        VERCEL: '1',
        VERCEL_ENV: 'production',
        NEXT_PUBLIC_SITE_URL: 'https://anansiportia.com',
      }),
    ).toThrow(
      `Production NEXT_PUBLIC_SITE_URL must be ${PRODUCTION_SITE_ORIGIN}`,
    )

    expect(() =>
      resolveSiteOrigin({
        VERCEL: '1',
        VERCEL_ENV: 'production',
      }),
    ).toThrow(
      `Production NEXT_PUBLIC_SITE_URL must be ${PRODUCTION_SITE_ORIGIN}`,
    )
  })

  it.each([
    'https://webchess.example/',
    'ftp://webchess.example',
    'not an origin',
  ])('rejects a non-exact local origin: %s', (siteUrl) => {
    expect(() =>
      resolveSiteOrigin({
        NEXT_PUBLIC_SITE_URL: siteUrl,
      }),
    ).toThrow('NEXT_PUBLIC_SITE_URL must be an exact HTTP(S) origin')
  })

  it.each([
    'http://webchess-preview.example',
    'https://webchess-preview.example/',
    'https://user:password@webchess-preview.example',
    'https://webchess-preview.example/path',
  ])('rejects a non-exact Preview origin: %s', (siteUrl) => {
    expect(() =>
      resolveSiteOrigin({
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        NEXT_PUBLIC_SITE_URL: siteUrl,
      }),
    ).toThrow('NEXT_PUBLIC_SITE_URL must be an exact HTTPS origin')
  })
})
