import {
  execFile,
  type ChildProcess,
  type ExecFileException,
} from 'node:child_process'

import { z } from 'zod'

import type { OpenClawConfig, OpenClawTransport } from './config'

export type OpenClawCliFailureKind =
  | 'aborted'
  | 'failed'
  | 'invalid-output'
  | 'not-found'
  | 'timeout'

export class OpenClawCliError extends Error {
  readonly kind: OpenClawCliFailureKind

  constructor(kind: OpenClawCliFailureKind, message: string) {
    super(message)
    this.name = 'OpenClawCliError'
    this.kind = kind
  }
}

export interface OpenClawCommandOptions {
  signal?: AbortSignal
}

export type OpenClawExecutor = (
  args: readonly string[],
  config: OpenClawConfig,
  options?: OpenClawCommandOptions,
) => Promise<string>

interface ExecFileOptions {
  encoding: 'utf8'
  maxBuffer: number
  shell: false
  signal?: AbortSignal
  windowsHide: true
}

type ExecFileCallback = (
  error: ExecFileException | null,
  stdout: string,
) => void

export type ExecFileInvoker = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: ExecFileCallback,
) => Pick<ChildProcess, 'kill'>

const invokeExecFile: ExecFileInvoker = (file, args, options, callback) =>
  execFile(file, [...args], options, callback)

function classifyExecutionError(
  error: ExecFileException,
  timedOut: boolean,
  signal?: AbortSignal,
): OpenClawCliError {
  if (timedOut) {
    return new OpenClawCliError(
      'timeout',
      'OpenClaw did not finish within the local request timeout.',
    )
  }
  if (signal?.aborted || error.code === 'ABORT_ERR') {
    return new OpenClawCliError(
      'aborted',
      'The local OpenClaw request was cancelled.',
    )
  }
  if (error.code === 'ENOENT') {
    return new OpenClawCliError(
      'not-found',
      'The OpenClaw executable was not found.',
    )
  }
  return new OpenClawCliError(
    'failed',
    'OpenClaw could not complete the local command.',
  )
}

export function createOpenClawExecutor(
  invoke: ExecFileInvoker = invokeExecFile,
): OpenClawExecutor {
  return async (args, config, options = {}) =>
    new Promise<string>((resolve, reject) => {
      let timedOut = false
      let settled = false
      const timers: {
        forceKill?: ReturnType<typeof setTimeout>
        timeout?: ReturnType<typeof setTimeout>
      } = {}
      let child: Pick<ChildProcess, 'kill'>

      try {
        child = invoke(
          config.binary,
          args,
          {
            encoding: 'utf8',
            maxBuffer: config.maxOutputBytes,
            shell: false,
            signal: options.signal,
            windowsHide: true,
          },
          (error, stdout) => {
            settled = true
            if (timers.timeout) clearTimeout(timers.timeout)
            if (timers.forceKill) clearTimeout(timers.forceKill)

            if (error) {
              reject(classifyExecutionError(error, timedOut, options.signal))
              return
            }
            if (timedOut) {
              reject(new OpenClawCliError(
                'timeout',
                'OpenClaw did not finish within the local request timeout.',
              ))
              return
            }
            resolve(stdout)
          },
        )
      } catch {
        reject(new OpenClawCliError(
          'failed',
          'OpenClaw could not start the local command.',
        ))
        return
      }

      if (settled) return
      timers.timeout = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        timers.forceKill = setTimeout(() => {
          child.kill('SIGKILL')
        }, 1_000)
      }, config.timeoutMs)
    })
}

export const executeOpenClawCommand = createOpenClawExecutor()

const ModelOutputSchema = z.object({
  text: z.string(),
})

const ModelRunEnvelopeSchema = z.object({
  ok: z.literal(true),
  capability: z.literal('model.run'),
  transport: z.enum(['local', 'gateway']),
  provider: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  outputs: z.array(ModelOutputSchema).min(1).max(16),
})

interface ModelRunResult {
  model: string
  outputText: string
  provider: string
  transport: OpenClawTransport
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new OpenClawCliError(
      'invalid-output',
      'OpenClaw returned an invalid JSON envelope.',
    )
  }
}

function cleanDisplayValue(value: string): string | null {
  const cleaned = value.replace(/\s+/gu, ' ').trim()
  if (
    cleaned.length === 0 ||
    cleaned.length > 200 ||
    /[\p{C}]/gu.test(cleaned)
  ) {
    return null
  }
  return cleaned
}

export function modelAttribution(
  providerValue: string,
  modelValue: string,
): string {
  const provider = cleanDisplayValue(providerValue)
  const model = cleanDisplayValue(modelValue)
  if (!model) return 'configured OpenClaw model'
  if (!provider || model.toLowerCase().startsWith(`${provider.toLowerCase()}/`)) {
    return model
  }
  return `${provider}/${model}`
}

export function parseModelRunEnvelope(
  stdout: string,
  expectedTransport: OpenClawTransport,
): ModelRunResult {
  const parsed = ModelRunEnvelopeSchema.safeParse(parseJson(stdout))
  if (!parsed.success || parsed.data.transport !== expectedTransport) {
    throw new OpenClawCliError(
      'invalid-output',
      'OpenClaw returned an unexpected model response envelope.',
    )
  }

  const outputText = parsed.data.outputs
    .map((output) => output.text.trim())
    .filter(Boolean)
    .join('\n')
  if (!outputText) {
    throw new OpenClawCliError(
      'invalid-output',
      'OpenClaw returned no model output.',
    )
  }

  return {
    model: parsed.data.model,
    outputText,
    provider: parsed.data.provider,
    transport: parsed.data.transport,
  }
}

export async function runOpenClawModel(
  prompt: string,
  config: OpenClawConfig,
  options: {
    execute?: OpenClawExecutor
    signal?: AbortSignal
  } = {},
): Promise<ModelRunResult> {
  const transportFlag = config.transport === 'gateway' ? '--gateway' : '--local'
  const stdout = await (options.execute ?? executeOpenClawCommand)(
    [
      '--no-color',
      'infer',
      'model',
      'run',
      transportFlag,
      '--json',
      '--thinking',
      'medium',
      '--prompt',
      prompt,
    ],
    config,
    { signal: options.signal },
  )
  return parseModelRunEnvelope(stdout, config.transport)
}

export interface OpenClawStatus {
  available: boolean
  message?: string
  model?: string
  reason?: 'cli-not-found' | 'not-configured' | 'unavailable'
  transport: OpenClawTransport
  version?: string
}

function parseResolvedDefault(value: unknown): string | null {
  if (typeof value === 'string') return cleanDisplayValue(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  if (typeof record.provider !== 'string' || typeof record.model !== 'string') {
    return null
  }
  return modelAttribution(record.provider, record.model)
}

function parseAuthStatus(stdout: string): {
  missingProviders: number
  model: string | null
} {
  const value = parseJson(stdout)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenClawCliError(
      'invalid-output',
      'OpenClaw returned an invalid authentication status.',
    )
  }

  const record = value as Record<string, unknown>
  const auth = record.auth
  let missingProviders = 0
  if (auth && typeof auth === 'object' && !Array.isArray(auth)) {
    const missing = (auth as Record<string, unknown>).missingProvidersInUse
    if (Array.isArray(missing)) missingProviders = missing.length
  }

  return {
    missingProviders,
    model: parseResolvedDefault(record.resolvedDefault),
  }
}

function parseVersion(stdout: string): string | null {
  const firstLine = stdout.split(/\r?\n/u, 1)[0] ?? ''
  return cleanDisplayValue(firstLine)
}

export async function getOpenClawStatus(
  config: OpenClawConfig,
  options: {
    execute?: OpenClawExecutor
    signal?: AbortSignal
  } = {},
): Promise<OpenClawStatus> {
  const execute = options.execute ?? executeOpenClawCommand
  let version: string | undefined

  try {
    const versionStdout = await execute(
      ['--no-color', '--version'],
      config,
      { signal: options.signal },
    )
    version = parseVersion(versionStdout) ?? undefined

    const authStdout = await execute(
      ['--no-color', 'infer', 'model', 'auth', 'status', '--json'],
      config,
      { signal: options.signal },
    )
    const auth = parseAuthStatus(authStdout)
    if (!auth.model || auth.missingProviders > 0) {
      return {
        available: false,
        message: 'Configure a usable default model in OpenClaw, then try again.',
        ...(auth.model ? { model: auth.model } : {}),
        reason: 'not-configured',
        transport: config.transport,
        ...(version ? { version } : {}),
      }
    }

    return {
      available: true,
      model: auth.model,
      transport: config.transport,
      ...(version ? { version } : {}),
    }
  } catch (error) {
    if (error instanceof OpenClawCliError && error.kind === 'not-found') {
      return {
        available: false,
        message: 'Install OpenClaw locally or configure the plugin with its executable path.',
        reason: 'cli-not-found',
        transport: config.transport,
      }
    }
    return {
      available: false,
      message: 'OpenClaw is installed but its model configuration is not ready.',
      reason: 'unavailable',
      transport: config.transport,
      ...(version ? { version } : {}),
    }
  }
}
