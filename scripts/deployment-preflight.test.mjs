import { describe, expect, it } from 'vitest'

import { validateDeploymentEnvironment } from './deployment-preflight.mjs'

const previewEnvironment = () => ({
  VERCEL: '1',
  VERCEL_ENV: 'preview',
  VERCEL_URL: 'webchess-preview-abc.vercel.app',
  VERCEL_PROJECT_ID: 'prj_webchess_example',
  WEBCHESS_EXPECTED_VERCEL_PROJECT_ID: 'prj_webchess_example',
  VERCEL_GIT_COMMIT_SHA: '1'.repeat(40),
  DATABASE_URL: 'postgresql://runtime.example/webchess',
  OPENAI_API_KEY: 'openai-secret-value',
  CLERK_SECRET_KEY: 'sk_test_example',
  CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_test_example',
  WEBCHESS_HMAC_SECRET: 'a'.repeat(32),
  WEBCHESS_DELETION_HMAC_SECRET: 'b'.repeat(32),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
  NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: '/play',
  NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: '/play',
})

describe('validateDeploymentEnvironment', () => {
  it('is a no-op outside Vercel', () => {
    expect(validateDeploymentEnvironment({})).toEqual({
      target: 'local',
      siteOrigin: null,
    })
  })

  it.each([
    { VERCEL: '' },
    { VERCEL_ENV: 'preview' },
    { VERCEL_TARGET_ENV: 'preview' },
    { VERCEL_URL: 'webchess-preview-abc.vercel.app' },
    { VERCEL_PROJECT_ID: 'prj_webchess_example' },
  ])('treats any Vercel marker as a deployment: %o', (marker) => {
    expect(() => validateDeploymentEnvironment(marker)).toThrow(
      'Vercel deployment preflight failed',
    )
  })

  it('derives the preview origin from VERCEL_URL', () => {
    expect(validateDeploymentEnvironment(previewEnvironment())).toEqual({
      target: 'preview',
      siteOrigin: 'https://webchess-preview-abc.vercel.app',
    })
  })

  it('rejects a migration-owner credential without echoing it', () => {
    const environment = previewEnvironment()
    environment.MIGRATION_DATABASE_URL =
      'postgresql://migration-owner:do-not-print@example.invalid/webchess'

    let message = ''
    try {
      validateDeploymentEnvironment(environment)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain(
      'MIGRATION_DATABASE_URL must not be configured in a Vercel deployment',
    )
    expect(message).not.toContain(environment.MIGRATION_DATABASE_URL)
  })

  it('allows an empty migration-owner variable', () => {
    const environment = previewEnvironment()
    environment.MIGRATION_DATABASE_URL = '   '

    expect(validateDeploymentEnvironment(environment)).toEqual({
      target: 'preview',
      siteOrigin: 'https://webchess-preview-abc.vercel.app',
    })
  })

  it('accepts an explicitly configured exact preview origin', () => {
    const environment = previewEnvironment()
    environment.NEXT_PUBLIC_SITE_URL =
      'https://webchess-stable-preview.vercel.app'

    expect(validateDeploymentEnvironment(environment)).toEqual({
      target: 'preview',
      siteOrigin: 'https://webchess-stable-preview.vercel.app',
    })
  })

  it('accepts VERCEL_TARGET_ENV as the explicit deployment target', () => {
    const environment = previewEnvironment()
    delete environment.VERCEL
    delete environment.VERCEL_ENV
    environment.VERCEL_TARGET_ENV = 'preview'

    expect(validateDeploymentEnvironment(environment)).toEqual({
      target: 'preview',
      siteOrigin: 'https://webchess-preview-abc.vercel.app',
    })
  })

  it('rejects conflicting or unsupported deployment targets', () => {
    const conflicting = previewEnvironment()
    conflicting.VERCEL_TARGET_ENV = 'production'
    expect(() => validateDeploymentEnvironment(conflicting)).toThrow(
      'VERCEL_ENV and VERCEL_TARGET_ENV must identify the same target',
    )

    const unsupported = previewEnvironment()
    unsupported.VERCEL_ENV = 'development'
    expect(() => validateDeploymentEnvironment(unsupported)).toThrow(
      'The Vercel deployment target must be preview or production',
    )
  })

  it('rejects an invalid VERCEL_URL hostname', () => {
    const environment = previewEnvironment()
    environment.VERCEL_URL =
      'webchess-preview.vercel.app/untrusted-path'

    expect(() => validateDeploymentEnvironment(environment)).toThrow(
      'VERCEL_URL must contain only a deployment hostname',
    )
  })

  it('accepts only the production WebChess origin for production', () => {
    const environment = previewEnvironment()
    environment.VERCEL_ENV = 'production'
    environment.NEXT_PUBLIC_SITE_URL =
      'https://webchess.anansiportia.com'
    environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_live_example'
    environment.CLERK_SECRET_KEY = 'sk_live_example'

    expect(validateDeploymentEnvironment(environment)).toEqual({
      target: 'production',
      siteOrigin: 'https://webchess.anansiportia.com',
    })

    environment.NEXT_PUBLIC_SITE_URL = 'https://anansiportia.com'
    expect(() => validateDeploymentEnvironment(environment)).toThrow(
      'Production NEXT_PUBLIC_SITE_URL must be https://webchess.anansiportia.com',
    )

    delete environment.NEXT_PUBLIC_SITE_URL
    expect(() => validateDeploymentEnvironment(environment)).toThrow(
      'NEXT_PUBLIC_SITE_URL is required',
    )
  })

  it('requires deployment-class Clerk credentials and a webhook secret', () => {
    const preview = previewEnvironment()
    preview.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_live_wrong_preview'
    preview.CLERK_SECRET_KEY = 'sk_live_wrong_preview'
    preview.CLERK_WEBHOOK_SIGNING_SECRET = 'wrong_preview_webhook'

    expect(() => validateDeploymentEnvironment(preview)).toThrow(
      /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must use a pk_test_ credential for preview[\s\S]*CLERK_SECRET_KEY must use a sk_test_ credential for preview[\s\S]*CLERK_WEBHOOK_SIGNING_SECRET must use a whsec_ credential for preview/,
    )

    const production = previewEnvironment()
    production.VERCEL_ENV = 'production'
    production.NEXT_PUBLIC_SITE_URL =
      'https://webchess.anansiportia.com'

    expect(() => validateDeploymentEnvironment(production)).toThrow(
      /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must use a pk_live_ credential for production[\s\S]*CLERK_SECRET_KEY must use a sk_live_ credential for production/,
    )
  })

  it('does not echo malformed Clerk credential values', () => {
    const environment = previewEnvironment()
    environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY =
      'publishable-do-not-print'
    environment.CLERK_SECRET_KEY = 'secret-do-not-print'
    environment.CLERK_WEBHOOK_SIGNING_SECRET =
      'webhook-do-not-print'

    let message = ''
    try {
      validateDeploymentEnvironment(environment)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('pk_test_')
    expect(message).toContain('sk_test_')
    expect(message).toContain('whsec_')
    expect(message).not.toContain(
      environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    )
    expect(message).not.toContain(environment.CLERK_SECRET_KEY)
    expect(message).not.toContain(
      environment.CLERK_WEBHOOK_SIGNING_SECRET,
    )
  })

  it('reports missing credentials and Clerk routes by name', () => {
    const environment = previewEnvironment()
    delete environment.DATABASE_URL
    environment.NEXT_PUBLIC_CLERK_SIGN_IN_URL = ''

    expect(() => validateDeploymentEnvironment(environment)).toThrow(
      /DATABASE_URL is required[\s\S]*NEXT_PUBLIC_CLERK_SIGN_IN_URL must be \/sign-in/,
    )
  })

  it('requires the system project ID and a separately configured expectation', () => {
    const missingSystemId = previewEnvironment()
    delete missingSystemId.VERCEL_PROJECT_ID
    expect(() =>
      validateDeploymentEnvironment(missingSystemId),
    ).toThrow('VERCEL_PROJECT_ID is required')

    const missingExpectation = previewEnvironment()
    delete missingExpectation.WEBCHESS_EXPECTED_VERCEL_PROJECT_ID
    expect(() =>
      validateDeploymentEnvironment(missingExpectation),
    ).toThrow('WEBCHESS_EXPECTED_VERCEL_PROJECT_ID is required')
  })

  it('rejects the wrong Vercel project without echoing either ID', () => {
    const environment = previewEnvironment()
    environment.VERCEL_PROJECT_ID = 'prj_wrong_project'
    environment.WEBCHESS_EXPECTED_VERCEL_PROJECT_ID =
      'prj_expected_webchess'

    let message = ''
    try {
      validateDeploymentEnvironment(environment)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain(
      'VERCEL_PROJECT_ID must exactly match WEBCHESS_EXPECTED_VERCEL_PROJECT_ID',
    )
    expect(message).not.toContain(environment.VERCEL_PROJECT_ID)
    expect(message).not.toContain(
      environment.WEBCHESS_EXPECTED_VERCEL_PROJECT_ID,
    )
  })

  it('rejects project IDs with surrounding whitespace', () => {
    const environment = previewEnvironment()
    environment.VERCEL_PROJECT_ID =
      ` ${environment.WEBCHESS_EXPECTED_VERCEL_PROJECT_ID} `

    expect(() => validateDeploymentEnvironment(environment)).toThrow(
      'VERCEL_PROJECT_ID must exactly match WEBCHESS_EXPECTED_VERCEL_PROJECT_ID',
    )
  })

  it('requires independent HMAC secrets of at least 32 bytes', () => {
    const environment = previewEnvironment()
    environment.WEBCHESS_HMAC_SECRET = 'too-short'
    environment.WEBCHESS_DELETION_HMAC_SECRET = 'too-short'

    expect(() => validateDeploymentEnvironment(environment)).toThrow(
      /WEBCHESS_HMAC_SECRET must be at least 32 bytes[\s\S]*WEBCHESS_DELETION_HMAC_SECRET must be at least 32 bytes[\s\S]*must be independent/,
    )
  })

  it('requires an immutable release commit without echoing invalid input', () => {
    const environment = previewEnvironment()
    environment.VERCEL_GIT_COMMIT_SHA = 'not-a-commit'

    let message = ''
    try {
      validateDeploymentEnvironment(environment)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain(
      'WEBCHESS_RELEASE_SHA or VERCEL_GIT_COMMIT_SHA must identify the exact 40-character release commit',
    )
    expect(message).not.toContain(environment.VERCEL_GIT_COMMIT_SHA)

    delete environment.VERCEL_GIT_COMMIT_SHA
    environment.WEBCHESS_RELEASE_SHA = '2'.repeat(40)
    expect(validateDeploymentEnvironment(environment).target).toBe('preview')
  })

  it('requires both supplied release SHAs to be valid and identical', () => {
    const environment = previewEnvironment()
    environment.WEBCHESS_RELEASE_SHA = '2'.repeat(40)

    let message = ''
    try {
      validateDeploymentEnvironment(environment)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain(
      'WEBCHESS_RELEASE_SHA must match VERCEL_GIT_COMMIT_SHA when both are configured',
    )
    expect(message).not.toContain(environment.WEBCHESS_RELEASE_SHA)
    expect(message).not.toContain(environment.VERCEL_GIT_COMMIT_SHA)

    environment.VERCEL_GIT_COMMIT_SHA =
      environment.WEBCHESS_RELEASE_SHA
    expect(validateDeploymentEnvironment(environment).target).toBe('preview')

    environment.VERCEL_GIT_COMMIT_SHA = 'not-a-commit'
    expect(() => validateDeploymentEnvironment(environment)).toThrow(
      'WEBCHESS_RELEASE_SHA or VERCEL_GIT_COMMIT_SHA must identify the exact 40-character release commit',
    )
  })

  it.each([
    'http://webchess-preview.example',
    'https://webchess-preview.example/',
    'https://user:password@webchess-preview.example',
    'https://webchess-preview.example/path',
  ])('rejects a non-exact preview origin without echoing it: %s', (siteUrl) => {
    const environment = previewEnvironment()
    environment.NEXT_PUBLIC_SITE_URL = siteUrl

    let message = ''
    try {
      validateDeploymentEnvironment(environment)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain(
      'NEXT_PUBLIC_SITE_URL must be an exact HTTPS origin',
    )
    expect(message).not.toContain(siteUrl)
  })

  it('does not include secret values in its failure text', () => {
    const environment = previewEnvironment()
    environment.VERCEL_ENV = ''
    environment.OPENAI_API_KEY = 'do-not-print-this-openai-key'
    environment.CLERK_SECRET_KEY = 'do-not-print-this-clerk-key'

    let message = ''
    try {
      validateDeploymentEnvironment(environment)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).not.toContain(environment.OPENAI_API_KEY)
    expect(message).not.toContain(environment.CLERK_SECRET_KEY)
  })
})
