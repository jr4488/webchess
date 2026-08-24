import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'

import { launchWebChess, parseLaunchOptions } from './launcher.js'

export default definePluginEntry({
  id: 'webchess',
  name: 'WebChess',
  description:
    'Launches visual local WebChess through your selected OpenAI account/OAuth model and official Codex Hosted Search.',
  register(api) {
    api.registerCli(
      ({ program }) => {
        program
          .command('webchess')
          .description(
            'Play visual WebChess locally through your OpenAI account/OAuth profile',
          )
          .option(
            '--port <port>',
            'Loopback port for the local WebChess interface',
            '3210',
          )
          .option('--no-open', 'Print the URL without opening a browser')
          .action(async (options) => {
            await launchWebChess(parseLaunchOptions(options), undefined, api)
          })
      },
      {
        descriptors: [
          {
            name: 'webchess',
            description:
              'Play visual WebChess locally through your OpenAI account/OAuth profile',
            hasSubcommands: false,
          },
        ],
      },
    )
  },
})
