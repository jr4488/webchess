import { describe, expect, it } from 'vitest'

import {
  buildSignInPath,
  buildSignUpPath,
  resolveAuthReturnUrl,
  sanitizeReturnUrl,
} from './return-url'

describe('sanitizeReturnUrl', () => {
  it('preserves a local path, query, and fragment', () => {
    expect(sanitizeReturnUrl('/play?resume=game_42#board')).toBe(
      '/play?resume=game_42#board',
    )
  })

  it.each([
    'https://attacker.example/steal',
    '//attacker.example/steal',
    '/\\attacker.example/steal',
    'javascript:alert(1)',
    '/play\nLocation: https://attacker.example',
    '',
  ])('rejects the unsafe return target %j', (value) => {
    expect(sanitizeReturnUrl(value)).toBe('/play')
  })

  it('rejects repeated query values instead of choosing one implicitly', () => {
    expect(sanitizeReturnUrl(['/account', '//attacker.example'])).toBe('/play')
  })

  it('uses a safe fallback when the caller supplies an unsafe fallback', () => {
    expect(sanitizeReturnUrl(undefined, '//attacker.example')).toBe('/play')
  })
})

describe('resolveAuthReturnUrl', () => {
  const siteUrl = 'https://webchess.example'

  it('gives a valid app return_url precedence over Clerk redirect_url', () => {
    expect(
      resolveAuthReturnUrl(
        '/account?tab=usage',
        'https://webchess.example/play',
        siteUrl,
      ),
    ).toBe('/account?tab=usage')
  })

  it('normalizes a same-origin Clerk redirect_url to a local path', () => {
    expect(
      resolveAuthReturnUrl(
        undefined,
        'https://webchess.example/account/security?from=play#sessions',
        siteUrl,
      ),
    ).toBe('/account/security?from=play#sessions')
  })

  it('uses a valid Clerk destination when return_url is unsafe', () => {
    expect(
      resolveAuthReturnUrl(
        'https://attacker.example/steal',
        '/account',
        siteUrl,
      ),
    ).toBe('/account')
  })

  it.each([
    'https://attacker.example/steal',
    'http://webchess.example/account',
    'https://webchess.example.attacker.test/account',
    'https://webchess.example//attacker.example/steal',
  ])('rejects the non-local Clerk redirect target %j', (redirectUrl) => {
    expect(resolveAuthReturnUrl(undefined, redirectUrl, siteUrl)).toBe('/play')
  })

  it('rejects repeated Clerk redirect values', () => {
    expect(
      resolveAuthReturnUrl(
        undefined,
        ['https://webchess.example/account', 'https://attacker.example'],
        siteUrl,
      ),
    ).toBe('/play')
  })

  it('fails closed for an absolute redirect when the configured site is invalid', () => {
    expect(
      resolveAuthReturnUrl(
        undefined,
        'https://webchess.example/account',
        'not an origin',
      ),
    ).toBe('/play')
  })
})

describe('auth paths', () => {
  it('encodes a sanitized sign-in return path', () => {
    expect(buildSignInPath('/account?tab=usage')).toBe(
      '/sign-in?return_url=%2Faccount%3Ftab%3Dusage',
    )
  })

  it('encodes a sanitized sign-up return path', () => {
    expect(buildSignUpPath('https://attacker.example')).toBe(
      '/sign-up?return_url=%2Fplay',
    )
  })
})
