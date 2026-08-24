import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  LOCAL_HOSTNAME,
  LOCAL_HOSTED_AUTH_FLAG,
  LOCAL_HOSTED_RETIRED_MESSAGE,
  LOCAL_HOSTED_QUOTAS,
  LOCAL_ENV_LOCK_DIRECTORY,
  LOCAL_POSTGRES_CONTAINER,
  LOCAL_POSTGRES_ADOPTED_VOLUME_VALUE,
  LOCAL_POSTGRES_IMAGE,
  LOCAL_POSTGRES_OWNER_LABEL,
  LOCAL_POSTGRES_OWNER_LABEL_VALUE,
  LOCAL_POSTGRES_PORT,
  LOCAL_POSTGRES_VOLUME,
  LOCAL_POSTGRES_VOLUME_BINDING_LABEL,
  LOCAL_POSTGRES_VOLUME_OWNER_LABEL,
  LOCAL_POSTGRES_VOLUME_OWNER_LABEL_VALUE,
  LOCAL_SESSION_SECRET_NAME,
  LOCAL_SITE_ORIGIN,
  assertExistingLocalPostgresConfiguration,
  assertLocalAppPortAvailable,
  assertLocalPostgresVolumeConfiguration,
  buildChildEnvironment,
  buildLocalAppEnv,
  combinedEnvironment,
  ensureLocalEnvFiles,
  ensureLocalPostgresVolume,
  localDevArgs,
  localPostgresRunArgs,
  mergeLocalAppEnv,
  missingLocalHostedSecrets,
  openLocalBrowser,
  parseLaunchOptions,
  parseDotEnv,
  parseLoopbackPostgresUrl,
  postgresUrl,
  resolveLocalAuthMode,
  runCapture,
  runLocalHosted,
  signalOwnedProcessGroup,
  startLocalPostgres,
  stopLocalPostgres,
  terminateOwnedProcessGroup,
  validateLocalHostedSecrets,
  verifyLocalPostgresCredentials,
  waitForLocalApp,
  writeDotEnvFile,
} from './local-hosted.mjs'

function localAppEnv(existing = {}) {
  return buildLocalAppEnv({
    deletionHmacSecret: 'd'.repeat(64),
    existing,
    hmacSecret: 'h'.repeat(64),
    localSessionSecret: 's'.repeat(64),
    postgresPassword: 'local-pass',
  })
}

function compliantContainerInspection(overrides = {}) {
  const base = {
    Id: 'a'.repeat(64),
    Config: {
      Cmd: ['postgres'],
      Entrypoint: ['docker-entrypoint.sh'],
      Env: [
        'POSTGRES_DB=webchess',
        'POSTGRES_USER=webchess',
        'POSTGRES_PASSWORD=local-pass',
        'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        'GOSU_VERSION=1.19',
        'LANG=en_US.utf8',
        'PG_MAJOR=17',
        'PG_VERSION=17.10',
        'PG_SHA256=078a03516dcdbdb705fecaf415ea3d13a956c589e46f09fed68a06fb00598c90',
        'DOCKER_PG_LLVM_DEPS=llvm21-dev \t\tclang21',
        'PGDATA=/var/lib/postgresql/data',
      ],
      Healthcheck: {
        Interval: 5_000_000_000,
        Retries: 12,
        Test: [
          'CMD-SHELL',
          'pg_isready --username=webchess --dbname=webchess',
        ],
        Timeout: 5_000_000_000,
      },
      Image: LOCAL_POSTGRES_IMAGE,
      Labels: {
        [LOCAL_POSTGRES_OWNER_LABEL]: LOCAL_POSTGRES_OWNER_LABEL_VALUE,
        [LOCAL_POSTGRES_VOLUME_BINDING_LABEL]:
          LOCAL_POSTGRES_VOLUME_OWNER_LABEL_VALUE,
      },
      User: '',
    },
    HostConfig: {
      AutoRemove: false,
      CapAdd: null,
      DeviceRequests: null,
      Devices: null,
      CgroupnsMode: 'private',
      IpcMode: 'private',
      NetworkMode: 'default',
      PidMode: '',
      PortBindings: {
        '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55433' }],
      },
      Privileged: false,
      PublishAllPorts: false,
      ReadonlyRootfs: false,
      RestartPolicy: { Name: 'unless-stopped' },
      SecurityOpt: null,
      UTSMode: '',
      UsernsMode: '',
    },
    Mounts: [{
      Destination: '/var/lib/postgresql/data',
      Name: LOCAL_POSTGRES_VOLUME,
      RW: true,
      Type: 'volume',
    }],
    NetworkSettings: {
      Networks: { bridge: {} },
    },
  }
  return JSON.stringify([{
    ...base,
    ...overrides,
    Config: {
      ...base.Config,
      ...(overrides.Config ?? {}),
    },
    HostConfig: {
      ...base.HostConfig,
      ...(overrides.HostConfig ?? {}),
    },
  }])
}

function compliantVolumeInspection(overrides = {}) {
  return JSON.stringify([{
    Driver: 'local',
    Labels: {
      [LOCAL_POSTGRES_VOLUME_OWNER_LABEL]:
        LOCAL_POSTGRES_VOLUME_OWNER_LABEL_VALUE,
    },
    Mountpoint: `/var/lib/docker/volumes/${LOCAL_POSTGRES_VOLUME}/_data`,
    Name: LOCAL_POSTGRES_VOLUME,
    Options: null,
    Scope: 'local',
    ...overrides,
  }])
}

describe('local hosted launcher', () => {
  it('has no npm entry point and fails closed when invoked directly', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
    expect(Object.keys(packageJson.scripts)).not.toContain('local:setup')
    expect(Object.keys(packageJson.scripts)).not.toContain('local:dev')
    expect(Object.keys(packageJson.scripts)).not.toContain('local:down')

    const direct = spawnSync(
      process.execPath,
      ['scripts/local-hosted.mjs', 'dev', '--no-open'],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    expect(direct.status).toBe(1)
    expect(direct.stderr.trim()).toBe(LOCAL_HOSTED_RETIRED_MESSAGE)
  })

  it('builds a loopback environment and never enables OpenClaw or test auth', () => {
    const env = localAppEnv()

    expect(env.DATABASE_URL).toBe(
      postgresUrl({
        password: 'local-pass',
        user: 'webchess',
      }),
    )
    expect(parseLoopbackPostgresUrl(env.DATABASE_URL).port).toBe(
      String(LOCAL_POSTGRES_PORT),
    )
    expect(env.NEXT_PUBLIC_SITE_URL).toBe(LOCAL_SITE_ORIGIN)
    expect(env.WEBCHESS_OPENCLAW_ENABLED).toBe('')
    expect(env[LOCAL_SESSION_SECRET_NAME]).toBe('s'.repeat(64))
    expect(env.WEBCHESS_DAILY_GAME_LIMIT).toBe(
      LOCAL_HOSTED_QUOTAS.WEBCHESS_DAILY_GAME_LIMIT,
    )
    expect(env.WEBCHESS_HOURLY_WILBUR_ACTION_LIMIT).toBe('1200')
    expect(env.WEBCHESS_HOURLY_IP_WILBUR_ACTION_LIMIT).toBe('2400')
    expect(env.WEBCHESS_HOURLY_WILBUR_OBSERVATION_LIMIT).toBe('600')
    expect(env.WEBCHESS_HOURLY_IP_WILBUR_OBSERVATION_LIMIT).toBe('1200')
    expect(env.WEBCHESS_WILBUR_STORAGE_ROW_LIMIT).toBe('500')
    expect(env.WEBCHESS_WILBUR_STORAGE_TEXT_BYTES_LIMIT).toBe('250000')
    expect(buildChildEnvironment({
      AWS_ACCESS_KEY_ID: 'must-not-survive',
      AWS_BEARER_TOKEN_BEDROCK: 'must-not-survive',
      CODEX_TOKEN: 'must-not-survive',
      OPENAI_ADMIN_KEY: 'must-not-survive',
      OPENAI_API_KEY: 'must-not-survive',
      OPENAI_BASE_URL: 'must-not-survive',
      OPENAI_CUSTOM_HEADERS: 'must-not-survive',
      OPENAI_PROJECT_ID: 'must-not-survive',
      OPENAI_WEBHOOK_SECRET: 'must-not-survive',
      HTTPS_PROXY: 'must-not-survive',
      NODE_EXTRA_CA_CERTS: 'must-not-survive',
      OPENCLAW_DEBUG_PROXY_URL: 'must-not-survive',
      PROVIDER_AUTH_TOKEN: 'must-not-survive',
      VERCEL: '1',
      WEBCHESS_E2E_AUTH: 'playwright',
      WEBCHESS_E2E_USER_ID: 'bypass',
      WEBCHESS_OPENCLAW_ENABLED: 'true',
      WEBCHESS_OPENCLAW_DATABASE_URL: 'postgresql://example',
    })).toEqual({
      [LOCAL_HOSTED_AUTH_FLAG]: 'true',
      NEXT_TELEMETRY_DISABLED: '1',
      WEBCHESS_OPENCLAW_ENABLED: 'false',
    })
    expect(localDevArgs()).toEqual([
      'run',
      'dev',
      '--',
      '--hostname',
      LOCAL_HOSTNAME,
      '--port',
      '3005',
    ])
    expect(localPostgresRunArgs()).toEqual(expect.arrayContaining([
      '--name',
      'webchess-local-postgres',
      '-p',
      '127.0.0.1:55433:5432',
      '--label',
      `${LOCAL_POSTGRES_OWNER_LABEL}=${LOCAL_POSTGRES_OWNER_LABEL_VALUE}`,
      'postgres:17.10-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193',
    ]))
    expect(localPostgresRunArgs()).toEqual(expect.arrayContaining([
      '-e',
      'POSTGRES_PASSWORD',
    ]))
    expect(localPostgresRunArgs().join(' ')).not.toContain('local-pass')
    expect(localPostgresRunArgs().join(' ')).not.toContain('openclaw')
  })

  it('preserves only intentional secrets while forcing local-owned settings', () => {
    const merged = mergeLocalAppEnv(
      {
        CLERK_SECRET_KEY: 'sk_test_keep',
        DATABASE_URL: 'postgresql://neon.example/webchess',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_keep',
        UNRELATED_STALE_SETTING: 'remove-me',
      },
      {
        CLERK_SECRET_KEY: 'sk_test_replace',
        DATABASE_URL: 'postgresql://webchess:local@127.0.0.1:55433/webchess',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_replace',
        WEBCHESS_OPENCLAW_ENABLED: '',
      },
    )

    expect(merged.CLERK_SECRET_KEY).toBe('sk_test_keep')
    expect(merged.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).toBe('pk_test_keep')
    expect(merged.DATABASE_URL).toContain('127.0.0.1:55433')
    expect(merged.UNRELATED_STALE_SETTING).toBeUndefined()
  })

  it('generates a stable dedicated session secret in owner-only files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'webchess-local-env-'))
    try {
      const generated = ['a', 'b', 'c'].map((letter) => letter.repeat(64))
      const first = await ensureLocalEnvFiles({
        generateHmac: () => generated.shift(),
        generatePassword: () => 'local-pass',
        root,
      })
      const firstSecret = first.appEnv[LOCAL_SESSION_SECRET_NAME]
      expect(firstSecret).toBe('c'.repeat(64))
      expect(first.appEnv.WEBCHESS_SOFTWARE_VERSION).toBe('2.2.0-rc.1-local')

      const second = await ensureLocalEnvFiles({
        generateHmac: () => {
          throw new Error('preserved secrets should not be regenerated')
        },
        generatePassword: () => 'replacement-pass',
        root,
      })
      expect(second.appEnv[LOCAL_SESSION_SECRET_NAME]).toBe(firstSecret)
      expect(parseDotEnv(await readFile(second.appEnvPath, 'utf8')))
        .toMatchObject({ [LOCAL_SESSION_SECRET_NAME]: firstSecret })
      expect((await stat(second.appEnvPath)).mode & 0o777).toBe(0o600)
      expect((await stat(second.composeEnvPath)).mode & 0o777).toBe(0o600)
      await expect(stat(path.join(root, LOCAL_ENV_LOCK_DIRECTORY)))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('atomically replaces env files and preserves the previous file if rename fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'webchess-local-atomic-'))
    const target = path.join(root, '.env.development.local')
    try {
      await writeFile(target, 'ORIGINAL=value\n', { mode: 0o600 })
      await expect(writeDotEnvFile(
        target,
        { REPLACEMENT: 'value' },
        '# replacement',
        {
          renameFile: async () => {
            throw new Error('simulated rename failure')
          },
        },
      )).rejects.toThrow(/simulated rename failure/u)
      expect(await readFile(target, 'utf8')).toBe('ORIGINAL=value\n')
      expect(await readdir(root)).toEqual(['.env.development.local'])
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('rolls both generated env files back if the paired update cannot finish', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'webchess-local-rollback-'))
    const appPath = path.join(root, '.env.development.local')
    const composePath = path.join(root, 'local/.env')
    try {
      await mkdir(path.dirname(composePath), { recursive: true })
      await writeFile(appPath, 'ORIGINAL_APP=value\n', { mode: 0o600 })
      await writeFile(composePath, 'ORIGINAL_COMPOSE=value\n', { mode: 0o600 })
      const generated = ['a', 'b', 'c'].map((letter) => letter.repeat(64))
      let writeCount = 0

      await expect(ensureLocalEnvFiles({
        generateHmac: () => generated.shift(),
        generatePassword: () => 'local-pass',
        root,
        writeEnv: async (...args) => {
          writeCount += 1
          if (writeCount === 2) throw new Error('simulated app env failure')
          await writeDotEnvFile(...args)
        },
      })).rejects.toThrow(/simulated app env failure/u)

      expect(await readFile(appPath, 'utf8')).toBe('ORIGINAL_APP=value\n')
      expect(await readFile(composePath, 'utf8')).toBe('ORIGINAL_COMPOSE=value\n')
      await expect(stat(path.join(root, LOCAL_ENV_LOCK_DIRECTORY)))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('serializes concurrent setup without deleting or bypassing the active lock', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'webchess-local-lock-'))
    const appPath = path.join(root, '.env.development.local')
    const composePath = path.join(root, 'local/.env')
    let continueRead
    let reportReadStarted
    const readStarted = new Promise((resolve) => {
      reportReadStarted = resolve
    })
    const readGate = new Promise((resolve) => {
      continueRead = resolve
    })
    let firstRead = true
    const blockedRead = async (filePath) => {
      if (firstRead) {
        firstRead = false
        reportReadStarted()
        await readGate
      }
      try {
        return parseDotEnv(await readFile(filePath, 'utf8'))
      } catch (error) {
        if (error?.code === 'ENOENT') return {}
        throw error
      }
    }

    try {
      await mkdir(path.dirname(composePath), { recursive: true })
      await writeFile(appPath, 'UNCHANGED=app\n', { mode: 0o600 })
      await writeFile(composePath, 'UNCHANGED=compose\n', { mode: 0o600 })
      const generated = ['a', 'b', 'c'].map((letter) => letter.repeat(64))
      const firstSetup = ensureLocalEnvFiles({
        generateHmac: () => generated.shift(),
        generatePassword: () => 'local-pass',
        readEnv: blockedRead,
        root,
      })
      await readStarted

      await expect(ensureLocalEnvFiles({ root })).rejects.toThrow(
        /Another local WebChess setup/u,
      )
      expect(await readFile(appPath, 'utf8')).toBe('UNCHANGED=app\n')
      expect(await readFile(composePath, 'utf8')).toBe('UNCHANGED=compose\n')
      expect((await stat(path.join(root, LOCAL_ENV_LOCK_DIRECTORY))).isDirectory())
        .toBe(true)

      continueRead()
      await firstSetup
      await expect(stat(path.join(root, LOCAL_ENV_LOCK_DIRECTORY)))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      continueRead?.()
      await rm(root, { force: true, recursive: true })
    }
  })

  it('requires runtime secrets but treats Clerk as an optional all-or-nothing pair', () => {
    expect(missingLocalHostedSecrets({})).not.toContain('CLERK_SECRET_KEY')
    expect(missingLocalHostedSecrets({
      DATABASE_URL: 'postgresql://webchess:local@127.0.0.1:55433/webchess',
      WEBCHESS_DELETION_HMAC_SECRET: 'd'.repeat(64),
      WEBCHESS_HMAC_SECRET: 'h'.repeat(64),
      [LOCAL_SESSION_SECRET_NAME]: 's'.repeat(64),
    })).toEqual([])
    expect(resolveLocalAuthMode({})).toBe('local-session')
    expect(resolveLocalAuthMode({
      CLERK_SECRET_KEY: 'sk_test_example',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
    })).toBe('clerk')
    expect(() => resolveLocalAuthMode({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_partial',
    })).toThrow(/requires both/u)
    expect(() => resolveLocalAuthMode({
      CLERK_SECRET_KEY: 'sk_live_example',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_example',
    })).toThrow(/development/u)
    expect(() => validateLocalHostedSecrets({
      WEBCHESS_DELETION_HMAC_SECRET: 'd'.repeat(64),
      WEBCHESS_HMAC_SECRET: 'h'.repeat(64),
      [LOCAL_SESSION_SECRET_NAME]: 'short',
    })).toThrow(new RegExp(LOCAL_SESSION_SECRET_NAME, 'u'))
    expect(() => validateLocalHostedSecrets({
      WEBCHESS_DELETION_HMAC_SECRET: 'x'.repeat(64),
      WEBCHESS_HMAC_SECRET: 'x'.repeat(64),
      [LOCAL_SESSION_SECRET_NAME]: 's'.repeat(64),
    })).toThrow(/must be distinct/u)
    expect(combinedEnvironment(
      { WEBCHESS_TEST_SETTING: 'from-root' },
      { DATABASE_URL: 'postgresql://127.0.0.1/webchess' },
    ).WEBCHESS_TEST_SETTING).toBe('from-root')
  })

  it('parses setup, down, and bounded port options', () => {
    expect(parseLaunchOptions(['node', 'local-hosted.mjs'])).toEqual({
      adoptVolume: false,
      command: 'dev',
      openBrowser: true,
      port: 3005,
    })
    expect(parseLaunchOptions([
      'node',
      'local-hosted.mjs',
      'setup',
      '--no-open',
    ])).toEqual({
      adoptVolume: false,
      command: 'setup',
      openBrowser: false,
      port: 3005,
    })
    expect(parseLaunchOptions([
      'node',
      'local-hosted.mjs',
      'down',
    ]).command).toBe('down')
    expect(parseLaunchOptions([
      'node',
      'local-hosted.mjs',
      'setup',
      '--adopt-volume',
    ])).toMatchObject({ adoptVolume: true, command: 'setup' })
    expect(() => parseLaunchOptions([
      'node',
      'local-hosted.mjs',
      'dev',
      '--adopt-volume',
    ])).toThrow(/only with local:setup/u)
    expect(() => parseLaunchOptions([
      'node',
      'local-hosted.mjs',
      'explode',
    ])).toThrow(/Usage/u)
    expect(() => parseLaunchOptions([
      'node',
      'local-hosted.mjs',
      'dev',
      '--port',
      '80',
    ])).toThrow(/1024 through 65535/u)
  })

  it.each([
    ['setup', ['node', 'local-hosted.mjs', 'setup', '--adopt-volume']],
    ['dev', ['node', 'local-hosted.mjs', 'dev', '--port', '80']],
    ['down', ['node', 'local-hosted.mjs', 'down']],
  ])('fails closed for imported %s invocation without reading dependencies', async (
    _command,
    argv,
  ) => {
    const dependencyTouches = vi.fn()
    const dependencies = new Proxy({}, {
      defineProperty(_target, property) {
        dependencyTouches('defineProperty', property)
        throw new Error('dependencies must not be mutated')
      },
      deleteProperty(_target, property) {
        dependencyTouches('deleteProperty', property)
        throw new Error('dependencies must not be mutated')
      },
      get(_target, property) {
        dependencyTouches('get', property)
        throw new Error('dependencies must not be read')
      },
      ownKeys() {
        dependencyTouches('ownKeys')
        throw new Error('dependencies must not be enumerated')
      },
      set(_target, property) {
        dependencyTouches('set', property)
        throw new Error('dependencies must not be mutated')
      },
    })
    const argvReads = vi.fn()
    const originalArgv = [...argv]
    const guardedArgv = new Proxy(argv, {
      get(_target, property) {
        argvReads(property)
        throw new Error('arguments must not be parsed')
      },
    })

    await expect(runLocalHosted(guardedArgv, dependencies)).rejects.toMatchObject({
      message: LOCAL_HOSTED_RETIRED_MESSAGE,
    })

    expect(argvReads).not.toHaveBeenCalled()
    expect(dependencyTouches).not.toHaveBeenCalled()
    expect(argv).toEqual(originalArgv)
  })

  it('refuses a drifted named database container without changing it', async () => {
    const run = vi.fn()
    const capture = vi.fn().mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: compliantContainerInspection({
        HostConfig: {
          PortBindings: {
            '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55433' }],
          },
          RestartPolicy: { Name: 'unless-stopped' },
        },
      }),
    })

    expect(() => assertExistingLocalPostgresConfiguration(
      compliantContainerInspection(),
      'local-pass',
    )).not.toThrow()
    await expect(startLocalPostgres({
      capture,
      password: 'local-pass',
      run,
    })).rejects.toThrow(/was not changed/u)
    expect(capture).toHaveBeenCalledWith('docker', [
      'inspect',
      LOCAL_POSTGRES_CONTAINER,
    ])
    expect(run).not.toHaveBeenCalled()
  })

  it.each([
    ['host networking', { HostConfig: { NetworkMode: 'host' } }],
    ['host PID namespace', { HostConfig: { PidMode: 'host' } }],
    ['host IPC namespace', { HostConfig: { IpcMode: 'host' } }],
    ['automatic container removal', { HostConfig: { AutoRemove: true } }],
    ['privileged mode', { HostConfig: { Privileged: true } }],
    ['added capabilities', { HostConfig: { CapAdd: ['SYS_ADMIN'] } }],
    ['host devices', {
      HostConfig: {
        Devices: [{ PathOnHost: '/dev/sda', PathInContainer: '/dev/sda' }],
      },
    }],
    ['a custom command', { Config: { Cmd: ['sh'] } }],
    ['a custom entrypoint', { Config: { Entrypoint: ['/bin/sh'] } }],
    ['a missing healthcheck', { Config: { Healthcheck: null } }],
    ['trust authentication', {
      Config: {
        Env: [
          'POSTGRES_DB=webchess',
          'POSTGRES_USER=webchess',
          'POSTGRES_PASSWORD=local-pass',
          'POSTGRES_HOST_AUTH_METHOD=trust',
        ],
      },
    }],
    ['an LD_PRELOAD injection', {
      Config: {
        Env: [
          ...JSON.parse(compliantContainerInspection())[0].Config.Env,
          'LD_PRELOAD=/host/attack.so',
        ],
      },
    }],
    ['a changed PGDATA path', {
      Config: {
        Env: JSON.parse(compliantContainerInspection())[0].Config.Env.map(
          (entry) => entry.startsWith('PGDATA=')
            ? 'PGDATA=/host/postgres'
            : entry,
        ),
      },
    }],
    ['an extra mount', {
      Mounts: [
        {
          Destination: '/var/lib/postgresql/data',
          Name: LOCAL_POSTGRES_VOLUME,
          RW: true,
          Type: 'volume',
        },
        {
          Destination: '/host',
          Source: '/',
          Type: 'bind',
        },
      ],
    }],
    ['an extra Docker network', {
      NetworkSettings: {
        Networks: { bridge: {}, hostile: {} },
      },
    }],
    ['a missing ownership label', { Config: { Labels: {} } }],
  ])('rejects an existing database configured with %s', (_label, overrides) => {
    expect(() => assertExistingLocalPostgresConfiguration(
      compliantContainerInspection(overrides),
      'local-pass',
    )).toThrow(/not an owned, exact local WebChess database/u)
  })

  it('creates and reuses only an owned default local database volume', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const createCapture = vi.fn()
      .mockResolvedValueOnce({
        code: 1,
        stderr: `Error: No such volume: ${LOCAL_POSTGRES_VOLUME}`,
        stdout: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: compliantVolumeInspection(),
      })

    await expect(ensureLocalPostgresVolume({
      capture: createCapture,
      run,
    })).resolves.toMatchObject({
      volumeBinding: LOCAL_POSTGRES_VOLUME_OWNER_LABEL_VALUE,
    })
    expect(run).toHaveBeenCalledWith('docker', [
      'volume',
      'create',
      '--label',
      `${LOCAL_POSTGRES_VOLUME_OWNER_LABEL}=${LOCAL_POSTGRES_VOLUME_OWNER_LABEL_VALUE}`,
      LOCAL_POSTGRES_VOLUME,
    ])

    expect(() => assertLocalPostgresVolumeConfiguration(
      compliantVolumeInspection({ Labels: {}, Options: { type: 'none' } }),
      { allowUnlabeled: true },
    )).toThrow(/not an owned, default local WebChess volume/u)
  })

  it('refuses an unowned same-name volume unless setup explicitly adopts it', async () => {
    const capture = vi.fn().mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: compliantVolumeInspection({ Labels: {} }),
    })
    const run = vi.fn()

    await expect(ensureLocalPostgresVolume({ capture, run }))
      .rejects.toThrow(/was not mounted or changed/u)
    expect(run).not.toHaveBeenCalled()
    await expect(ensureLocalPostgresVolume({
      adoptUnlabeled: true,
      capture,
      run,
    })).resolves.toMatchObject({
      volumeBinding: LOCAL_POSTGRES_ADOPTED_VOLUME_VALUE,
    })
  })

  it('never adopts a same-name volume carrying foreign ownership labels', async () => {
    const capture = vi.fn().mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: compliantVolumeInspection({
        Labels: {
          'com.docker.compose.project': 'another-application',
          'com.docker.compose.volume': LOCAL_POSTGRES_VOLUME,
        },
      }),
    })
    const run = vi.fn()

    await expect(ensureLocalPostgresVolume({
      adoptUnlabeled: true,
      capture,
      run,
    })).rejects.toThrow(/was not mounted or changed/u)
    expect(run).not.toHaveBeenCalled()
  })

  it('passes the database password only through the Docker child environment', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const capture = vi.fn()
      .mockResolvedValueOnce({
        code: 1,
        stderr: `Error: No such container: ${LOCAL_POSTGRES_CONTAINER}`,
        stdout: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: compliantVolumeInspection(),
      })
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: compliantContainerInspection(),
      })
      .mockResolvedValueOnce({ code: 0, stderr: '', stdout: 'healthy\n' })
    const verifyCredentials = vi.fn().mockResolvedValue(undefined)

    await startLocalPostgres({
      capture,
      password: 'local-pass',
      run,
      verifyCredentials,
    })

    const [, dockerArgs, dockerOptions] = run.mock.calls.find((call) => (
      call[1][0] === 'run'
    ))
    expect(dockerArgs.join(' ')).not.toContain('local-pass')
    expect(dockerArgs).toEqual(expect.arrayContaining([
      '-e',
      'POSTGRES_PASSWORD',
    ]))
    expect(dockerOptions.env.POSTGRES_PASSWORD).toBe('local-pass')
    expect(verifyCredentials).toHaveBeenCalledWith({
      containerId: 'a'.repeat(64),
      password: 'local-pass',
    })
  })

  it('targets the inspected immutable container id for start, health, and auth', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const capture = vi.fn()
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: compliantContainerInspection({ Id: 'b'.repeat(64) }),
      })
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: compliantVolumeInspection(),
      })
      .mockResolvedValueOnce({ code: 0, stderr: '', stdout: 'healthy\n' })
    const verifyCredentials = vi.fn().mockResolvedValue(undefined)

    await startLocalPostgres({
      capture,
      password: 'local-pass',
      run,
      verifyCredentials,
    })

    expect(run).toHaveBeenCalledWith('docker', ['start', 'b'.repeat(64)])
    expect(capture).toHaveBeenNthCalledWith(3, 'docker', [
      'inspect',
      '-f',
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
      'b'.repeat(64),
    ])
    expect(verifyCredentials).toHaveBeenCalledWith({
      containerId: 'b'.repeat(64),
      password: 'local-pass',
    })
    expect(run.mock.calls[0][1]).not.toContain(LOCAL_POSTGRES_CONTAINER)
  })

  it('fails setup if the saved password cannot authenticate to the healthy database', async () => {
    const client = {
      connect: vi.fn().mockRejectedValue(new Error('password authentication failed')),
      end: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(),
    }
    const clientFactory = vi.fn(() => client)
    await expect(verifyLocalPostgresCredentials({
      clientFactory,
      containerId: 'c'.repeat(64),
      password: 'not-in-argv',
    })).rejects.toThrow(/exact endpoint used by WebChess/u)
    expect(clientFactory).toHaveBeenCalledWith(expect.objectContaining({
      database: 'webchess',
      host: '127.0.0.1',
      password: 'not-in-argv',
      port: 55433,
      ssl: false,
      user: 'webchess',
    }))
    expect(client.end).toHaveBeenCalledOnce()
  })

  it('refuses legacy unlabeled containers with a data-preserving adoption procedure', async () => {
    const run = vi.fn()
    const legacyInspection = compliantContainerInspection({
      Config: { Labels: {} },
    })
    const capture = vi.fn().mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: legacyInspection,
    })

    await expect(startLocalPostgres({
      capture,
      password: 'local-pass',
      run,
    })).rejects.toThrow(
      new RegExp(`docker rm ${LOCAL_POSTGRES_CONTAINER}.*npm run local:setup`, 'u'),
    )
    expect(run).not.toHaveBeenCalled()
    await expect(stopLocalPostgres({ capture })).rejects.toThrow(
      new RegExp(`${LOCAL_POSTGRES_VOLUME}.*never run "docker volume rm"`, 'u'),
    )
    expect(capture).toHaveBeenCalledTimes(2)
  })

  it('stops only an owned database whose full configuration is still safe', async () => {
    const stopOwned = vi.fn()
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: compliantContainerInspection(),
      })
      .mockResolvedValueOnce({ code: 0, stderr: '', stdout: '' })
    await expect(stopLocalPostgres({ capture: stopOwned })).resolves.toBe(true)
    expect(stopOwned).toHaveBeenLastCalledWith('docker', [
      'stop',
      'a'.repeat(64),
    ])

    const stopUnowned = vi.fn().mockResolvedValue({
      code: 0,
      stderr: '',
      stdout: compliantContainerInspection({ Config: { Labels: {} } }),
    })
    await expect(stopLocalPostgres({ capture: stopUnowned }))
      .rejects.toThrow(/predates its immutable WebChess ownership label/u)
    expect(stopUnowned).toHaveBeenCalledOnce()
  })

  it('requires exact non-redirecting WebChess HTML instead of accepting a stale 2xx', async () => {
    const pendingChild = new Promise(() => {})
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('<html>some other app</html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
        status: 200,
      }))
      .mockResolvedValueOnce(new Response(
        '<html>Every question arrives wrapped in its first frame. Board events generate</html>',
        {
          headers: { 'content-type': 'text/html; charset=utf-8' },
          status: 200,
        },
      ))
    await expect(waitForLocalApp({
      childOutcome: pendingChild,
      fetchImpl,
      probes: [{
        bodyMarkers: [
          'Every question arrives wrapped in its first frame.',
          'Board events generate',
        ],
        url: 'http://127.0.0.1:3005/',
      }],
      sleep: async () => {},
    })).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    let time = 0
    await expect(waitForLocalApp({
      childOutcome: pendingChild,
      fetchImpl: vi.fn().mockResolvedValue(new Response('', {
        headers: { location: '/somewhere-else' },
        status: 307,
      })),
      now: () => {
        time += 10
        return time
      },
      probes: [{
        bodyMarkers: ['Every question arrives wrapped in its first frame.'],
        url: 'http://127.0.0.1:3005/',
      }],
      sleep: async () => {},
      timeoutMs: 15,
    })).rejects.toThrow(/Timed out/u)
  })

  it('fails readiness when the spawned child exits before serving WebChess', async () => {
    await expect(waitForLocalApp({
      childOutcome: Promise.resolve({ code: 1, signal: null }),
      fetchImpl: vi.fn(() => new Promise(() => {})),
      probes: [{
        bodyMarkers: ['Every question arrives wrapped in its first frame.'],
        url: 'http://127.0.0.1:3005/',
      }],
      serverReady: Promise.resolve(false),
    })).rejects.toThrow(/before it became ready|announced readiness/u)
  })

  it('times out even when the live child never announces Next.js readiness', async () => {
    await expect(waitForLocalApp({
      childOutcome: new Promise(() => {}),
      fetchImpl: vi.fn(() => new Promise(() => {})),
      probes: [{
        bodyMarkers: ['Every question arrives wrapped in its first frame.'],
        url: 'http://127.0.0.1:3005/',
      }],
      serverReady: new Promise(() => {}),
      timeoutMs: 5,
    })).rejects.toThrow(/Timed out/u)
  })

  it('rejects an occupied app port before spawning', async () => {
    const server = new EventEmitter()
    server.listen = vi.fn(() => {
      const error = Object.assign(new Error('occupied'), { code: 'EADDRINUSE' })
      queueMicrotask(() => server.emit('error', error))
    })
    server.close = vi.fn()

    await expect(assertLocalAppPortAvailable({
      createServerImpl: () => server,
      port: 3005,
    })).rejects.toThrow(/already in use/u)
    expect(server.close).not.toHaveBeenCalled()
  })

  it('kills and rejects a Docker capture that never exits', async () => {
    const child = new EventEmitter()
    child.kill = vi.fn()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()

    await expect(runCapture('docker', ['inspect', 'stuck'], {
      spawnImpl: () => child,
      timeoutMs: 5,
    })).rejects.toThrow(/did not finish within 5ms/u)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('kills and rejects a browser helper that never exits', async () => {
    const child = new EventEmitter()
    child.kill = vi.fn()

    await expect(openLocalBrowser('http://localhost:3005/play', {
      spawnImpl: () => child,
      timeoutMs: 5,
    })).rejects.toThrow(/did not finish opening the browser within 5ms/u)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('signals the entire owned process group and escalates if descendants remain', async () => {
    const child = { kill: vi.fn(), pid: 4242 }
    const calls = []
    let time = 0
    let exists = true
    const killProcess = (pid, signal) => {
      calls.push([pid, signal])
      if (signal === 'SIGKILL') exists = false
      if (signal === 0 && !exists) {
        throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      }
    }

    expect(signalOwnedProcessGroup(child, 'SIGTERM', { killProcess }))
      .toBe(true)
    await terminateOwnedProcessGroup(child, {
      graceMs: 5,
      killProcess,
      now: () => time,
      sleep: async (ms) => {
        time += ms
      },
    })

    expect(calls).toContainEqual([-4242, 'SIGTERM'])
    expect(calls).toContainEqual([-4242, 'SIGKILL'])
    expect(child.kill).not.toHaveBeenCalled()
  })

})
