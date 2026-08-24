declare module 'openclaw/plugin-sdk/plugin-entry' {
  interface CliCommand {
    action(
      handler: (options: Record<string, unknown>) => Promise<void> | void,
    ): CliCommand
    description(value: string): CliCommand
    option(
      flags: string,
      description?: string,
      defaultValue?: string,
    ): CliCommand
  }

  interface CliProgram {
    command(name: string): CliCommand
  }

  interface OpenClawPluginApi {
    config: import('./bridge.js').OpenClawBridgeApi['config']
    runtime: import('./bridge.js').OpenClawBridgeApi['runtime']
    registerCli(
      registrar: (context: { program: CliProgram }) => Promise<void> | void,
      options: {
        descriptors: Array<{
          description: string
          hasSubcommands: boolean
          name: string
        }>
      },
    ): void
  }

  interface OpenClawPluginDefinition {
    description: string
    id: string
    name: string
    register(api: OpenClawPluginApi): void
  }

  export function definePluginEntry(
    definition: OpenClawPluginDefinition,
  ): OpenClawPluginDefinition
}

declare module 'openclaw/plugin-sdk/simple-completion-runtime' {
  export function completeWithPreparedSimpleCompletionModel(
    params: unknown,
  ): Promise<unknown>
  export function prepareSimpleCompletionModelForAgent(
    params: unknown,
  ): Promise<unknown>
}

declare module 'openclaw/plugin-sdk/agent-runtime' {
  export function loadAuthProfileStoreForSecretsRuntime(
    agentDir?: string,
    options?: {
      config?: unknown
      externalCliProviderIds?: string[]
    },
  ): unknown
  export function resolveAuthProfileOrder(params: unknown): string[]
  export function resolveAgentDir(
    config: unknown,
    agentId: string,
    environment?: NodeJS.ProcessEnv,
  ): string
  export function resolveAgentWorkspaceDir(
    config: unknown,
    agentId: string,
    environment?: NodeJS.ProcessEnv,
  ): string
  export function resolveDefaultAgentId(config: unknown): string
}

declare module 'openclaw/plugin-sdk/plugin-runtime' {
  export function getGlobalPluginRegistry(): unknown
}
