import { describe, expect, it } from 'vitest'

import {
  reviewedDatabaseClientConfig,
  validateDeploymentEnvironment,
} from './deployment-preflight.mjs'

const previewEnvironment = () => ({
  VERCEL: '1',
  VERCEL_ENV: 'preview',
  VERCEL_URL: 'webchess-preview-abc.vercel.app',
  VERCEL_PROJECT_ID: 'prj_webchess_example',
  WEBCHESS_EXPECTED_VERCEL_PROJECT_ID: 'prj_webchess_example',
  VERCEL_GIT_COMMIT_SHA: '1'.repeat(40),
  DATABASE_URL:
    'postgresql://runtime:runtime-secret@runtime.example/webchess',
  CLERK_SECRET_KEY: 'sk_test_example',
  CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_test_example',
  WEBCHESS_HMAC_SECRET: 'a'.repeat(32),
  WEBCHESS_DELETION_HMAC_SECRET: 'b'.repeat(32),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
  NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: '/account',
  NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: '/account',
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

  it.each([
    'ANTHROPIC_AUTH_TOKEN',
    'AWS_ACCESS_KEY_ID',
    'AWS_BEARER_TOKEN_BEDROCK',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'CODEX_API_KEY',
    'CODEX_TOKEN',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'HF_TOKEN',
    'OPENAI_ACCESS_TOKEN',
    'OPENAI_ADMIN_KEY',
    'OPENAI_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY_',
    'OPENAI_API_KEY_PRIMARY',
    'OPENAI_API_TOKEN',
    'OPENAI_OAUTH_TOKEN',
    'OPENAI_TOKEN',
    'OPENCLAW_LIVE_OPENAI_KEY',
    'OPENCLAW_LIVE_OPENAI_KEYS',
    'THIRD_PARTY_API_KEY',
  ])('rejects a nonempty provider credential by name: %s', (variableName) => {
    const environment = previewEnvironment()
    const secretValue = `do-not-print-${variableName.toLowerCase()}`
    environment[variableName] = secretValue

    let message = ''
    try {
      validateDeploymentEnvironment(environment)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain(variableName)
    expect(message).toContain('only OpenAI account OAuth through OpenClaw')
    expect(message).not.toContain(secretValue)
  })

  it('allows empty provider credential variables', () => {
    const environment = previewEnvironment()
    environment.OPENAI_API_KEY = ''
    environment.HF_TOKEN = ''

    expect(validateDeploymentEnvironment(environment)).toEqual({
      target: 'preview',
      siteOrigin: 'https://webchess-preview-abc.vercel.app',
    })
  })

  it('reports every forbidden provider credential name without values', () => {
    const environment = previewEnvironment()
    environment.OPENAI_API_KEY = 'first-secret-value'
    environment.CODEX_TOKEN = 'second-secret-value'

    let message = ''
    try {
      validateDeploymentEnvironment(environment)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toMatch(/CODEX_TOKEN[\s\S]*OPENAI_API_KEY/u)
    expect(message).not.toContain(environment.OPENAI_API_KEY)
    expect(message).not.toContain(environment.CODEX_TOKEN)
  })

  it.each([
    ['OPENAI_BASE_URL', 'https://custom-provider.invalid/v1'],
    ['OPENAI_API_BASE', 'https://custom-provider.invalid/v1'],
    ['OPENAI_CUSTOM_HEADERS', '{"x-custom":"secret"}'],
    ['OPENAI_LOG', 'debug'],
    ['OPENAI_ORG_ID', 'org-do-not-print'],
    ['OPENAI_PROJECT_ID', 'project-do-not-print'],
    ['HTTP_PROXY', 'http://proxy.invalid'],
    ['https_proxy', 'http://proxy.invalid'],
    ['ALL_PROXY', 'socks5://proxy.invalid'],
    ['BUN_OPTIONS', '--preload=/private/injected.js'],
    ['CODEX_CA_CERTIFICATE', '/private/codex-ca.pem'],
    ['DYLD_INSERT_LIBRARIES', '/private/injected.dylib'],
    ['LD_PRELOAD', '/private/injected.so'],
    ['NODE_EXTRA_CA_CERTS', '/private/custom-ca.pem'],
    ['NODE_DEBUG', 'module,http'],
    ['NODE_DEBUG_NATIVE', 'native-debug-secret'],
    ['NODE_OPTIONS', '--require=/private/injected.js'],
    ['NODE_PATH', '/private/injected-modules'],
    ['OPENCLAW_NODE_EXTRA_CA_CERTS_READY', '1'],
    ['SSL_CERT_FILE', '/private/custom-ca.pem'],
    ['SSL_CERT_DIR', '/private/custom-ca-directory'],
    ['OPENCLAW_BUILD_PRIVATE_QA', '1'],
    ['OPENCLAW_QA_FORCE_RUNTIME', '1'],
    ['OPENCLAW_DEBUG_PROXY_ENABLED', '1'],
    ['OPENCLAW_DEBUG_PROXY_REQUIRE', '1'],
    ['OPENCLAW_DEBUG_PROXY_URL', 'http://proxy.invalid'],
    ['OPENCLAW_DEBUG_PROXY_DB_PATH', '/private/proxy.sqlite'],
    ['OPENCLAW_DEBUG_PROXY_BLOB_DIR', '/private/proxy-blobs'],
    ['OPENSSL_CONF', '/private/openssl.cnf'],
    ['SSLKEYLOGFILE', '/private/tls.keys'],
    ['NODE_TLS_REJECT_UNAUTHORIZED', '0'],
  ])(
    'rejects unsafe provider transport configuration without values: %s',
    (variableName, unsafeValue) => {
      const environment = previewEnvironment()
      environment[variableName] = unsafeValue

      let message = ''
      try {
        validateDeploymentEnvironment(environment)
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }

      expect(message).toContain(variableName.toUpperCase())
      expect(message).toContain('custom provider endpoints')
      expect(message).not.toContain(unsafeValue)
    },
  )

  it('allows empty transport variables and an enabled TLS verifier', () => {
    const environment = previewEnvironment()
    environment.OPENAI_BASE_URL = ''
    environment.HTTP_PROXY = ''
    environment.NODE_EXTRA_CA_CERTS = ''
    environment.NODE_TLS_REJECT_UNAUTHORIZED = '1'

    expect(validateDeploymentEnvironment(environment)).toEqual({
      target: 'preview',
      siteOrigin: 'https://webchess-preview-abc.vercel.app',
    })
  })

  it.each([
    ['OPENAI_API_KEY', 'only OpenAI account OAuth'],
    ['NODE_EXTRA_CA_CERTS', 'custom provider endpoints'],
    ['SSL_CERT_FILE', 'custom provider endpoints'],
    ['OPENSSL_CONF', 'custom provider endpoints'],
    ['PGOPTIONS', 'DATABASE_URL is the only approved'],
  ])(
    'rejects a whitespace-only forbidden environment value: %s',
    (variableName, expectedMessage) => {
      const environment = previewEnvironment()
      environment[variableName] = '   '

      let message = ''
      try {
        validateDeploymentEnvironment(environment)
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }

      expect(message).toContain(variableName)
      expect(message).toContain(expectedMessage)
    },
  )

  it('rejects sslmode=disable for a remote database without echoing the URL', () => {
    const environment = previewEnvironment()
    environment.DATABASE_URL =
      'postgresql://runtime:do-not-print@runtime.example/webchess?sslmode=disable'

    let message = ''
    try {
      validateDeploymentEnvironment(environment)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('DATABASE_URL contains an unapproved sslmode')
    expect(message).not.toContain(environment.DATABASE_URL)
  })

  it.each([
    'postgresql://runtime:local-secret@127.0.0.1/webchess?sslmode=disable',
    'postgresql://runtime:local-secret@[::1]/webchess?sslmode=disable',
  ])('rejects plaintext loopback PostgreSQL in hosted deployment: %s', (databaseUrl) => {
    const environment = previewEnvironment()
    environment.DATABASE_URL = databaseUrl

    expect(() => validateDeploymentEnvironment(environment)).toThrow(
      'DATABASE_URL must use verified TLS in a hosted deployment',
    )
  })

  it('builds an explicit verified remote client configuration without a connection string', () => {
    const environment = previewEnvironment()
    const config = reviewedDatabaseClientConfig(
      `${environment.DATABASE_URL}?sslmode=verify-full`,
      {
        applicationName: 'webchess-test',
        environment,
      },
    )

    expect(config).toEqual({
      application_name: 'webchess-test',
      database: 'webchess',
      host: 'runtime.example',
      port: 5432,
      ssl: { rejectUnauthorized: true },
      sslnegotiation: 'postgres',
      user: 'runtime',
    })
    expect(config.password).toBe('runtime-secret')
    expect(Object.keys(config)).not.toContain('password')
    expect(config).not.toHaveProperty('connectionString')
  })

  it('builds an explicit non-TLS client configuration only for loopback', () => {
    const config = reviewedDatabaseClientConfig(
      'postgresql://runtime:local-secret@[::1]/webchess?sslmode=disable',
      {
        applicationName: 'webchess-test',
        allowLoopbackPlaintext: true,
        environment: {},
      },
    )

    expect(config).toMatchObject({
      host: '::1',
      ssl: false,
      sslnegotiation: 'postgres',
    })
    expect(config.password).toBe('local-secret')
  })

  it('requires an explicit opt-in before building a plaintext loopback configuration', () => {
    expect(() => reviewedDatabaseClientConfig(
      'postgresql://runtime:local-secret@127.0.0.1/webchess?sslmode=disable',
      {
        applicationName: 'webchess-test',
        environment: {},
      },
    )).toThrow(
      'DATABASE_URL must use verified TLS in a hosted deployment',
    )
  })

  it('never treats DNS localhost as a plaintext loopback exception', () => {
    expect(() => reviewedDatabaseClientConfig(
      'postgresql://runtime:local-secret@localhost/webchess?sslmode=disable',
      {
        applicationName: 'webchess-test',
        allowLoopbackPlaintext: true,
        environment: {},
      },
    )).toThrow('DATABASE_URL contains an unapproved sslmode')
  })

  it.each([
    'host=shadow.invalid',
    'port=6543',
    'user=shadow-user',
    'password=shadow-secret',
    'database=shadow-database',
    'dbname=shadow-database',
    'ssl=0',
    'sslmode=no-verify',
    'sslmode=disable',
    'sslmode=allow',
    'sslmode=prefer',
    'sslmode=require',
    'sslmode=verify-ca',
    'uselibpqcompat=true',
  ])('rejects a PostgreSQL query override without exposing it: %s', (query) => {
    const environment = previewEnvironment()
    const secret = 'query-secret-do-not-print'
    environment.DATABASE_URL =
      `postgresql://runtime:${secret}@runtime.example/webchess?${query}`

    let message = ''
    try {
      validateDeploymentEnvironment(environment)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('DATABASE_URL')
    expect(message).not.toContain(environment.DATABASE_URL)
    expect(message).not.toContain(secret)
    expect(message).not.toContain(query)
  })

  it.each([
    'PGAPPNAME',
    'PGBINARY',
    'PGCLIENT_ENCODING',
    'PGCLIENTENCODING',
    'PGCONNECT_TIMEOUT',
    'PGHOST',
    'PGHOSTADDR',
    'PGPORT',
    'PGDATABASE',
    'PGUSER',
    'PGPASSWORD',
    'PGPASSFILE',
    'PGOPTIONS',
    'PGREPLICATION',
    'PGREQUIRESSL',
    'PGSERVICE',
    'PGSERVICEFILE',
    'PGSSLMODE',
    'PGSSLCERT',
    'PGSSLKEY',
    'PGSSLROOTCERT',
    'PGSSLNEGOTIATION',
    'PGSYSCONFDIR',
    'PGTARGETSESSIONATTRS',
    'NODE_EXTRA_CA_CERTS',
    'NODE_OPTIONS',
    'NODE_PG_FORCE_NATIVE',
    'NODE_USE_SYSTEM_CA',
    'OPENSSL_CONF',
    'SSL_CERT_DIR',
    'SSL_CERT_FILE',
  ])('rejects a PostgreSQL environment override without its value: %s', (name) => {
    const environment = previewEnvironment()
    const secret = `do-not-print-${name.toLowerCase()}`
    environment[name] = secret

    let message = ''
    try {
      validateDeploymentEnvironment(environment)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain(name)
    expect(message).toContain('DATABASE_URL is the only approved')
    expect(message).not.toContain(secret)
  })

  it.each([
    'NODE_PG_FORCE_NATIVE',
    'PGOPTIONS',
  ])('rejects an effective whitespace-only PostgreSQL override: %s', (name) => {
    const environment = previewEnvironment()
    environment[name] = '   '

    expect(() => validateDeploymentEnvironment(environment)).toThrow(name)
  })

  it('allows an enabled Node TLS verifier but rejects the disabling value', () => {
    const allowed = previewEnvironment()
    allowed.NODE_TLS_REJECT_UNAUTHORIZED = '1'
    expect(validateDeploymentEnvironment(allowed).target).toBe('preview')

    const rejected = previewEnvironment()
    rejected.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    expect(() => validateDeploymentEnvironment(rejected)).toThrow(
      'NODE_TLS_REJECT_UNAUTHORIZED',
    )
  })

  it.each([
    'postgresql://runtime:secret@192.0.2.10/webchess',
    'postgresql://runtime:secret@[2001:db8::10]/webchess',
    'postgresql://runtime:secret@127.0.0.1/webchess?sslmode=verify-full',
    'postgresql://runtime:secret@[::1]/webchess?sslmode=verify-full',
  ])('rejects a TLS IP literal that cannot receive hostname verification: %s', (databaseUrl) => {
    const environment = previewEnvironment()
    environment.DATABASE_URL = databaseUrl

    expect(() => validateDeploymentEnvironment(environment)).toThrow(
      'DATABASE_URL must use a DNS hostname',
    )
  })

  it.each([
    'postgresql://runtime%00shadow:secret@runtime.example/webchess',
    'postgresql://runtime:secret%00shadow@runtime.example/webchess',
    'postgresql://runtime:secret@runtime.example/webchess%00shadow',
  ])('rejects percent-encoded NULs without echoing the URL: %s', (databaseUrl) => {
    const environment = previewEnvironment()
    environment.DATABASE_URL = databaseUrl

    let message = ''
    try {
      validateDeploymentEnvironment(environment)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('invalid control characters')
    expect(message).not.toContain(databaseUrl)
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
