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
