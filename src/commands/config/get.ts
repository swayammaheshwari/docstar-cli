import {Args, Command} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import {configPath} from '../../lib/paths.js'
import type {SavedConfig} from '../../lib/types.js'

export default class ConfigGet extends Command {
  static override args = {
    cliName: Args.string({description: 'Installed collection (CLI name), e.g. msg91', required: true}),
    key: Args.string({description: 'Credential name to look up, e.g. authkey. Omit to show all saved credentials.', required: false}),
  }
  static override description = 'Show saved credentials for a collection, or a single credential value'
  static override examples = [
    '<%= config.bin %> <%= command.id %> msg91           # show all credentials saved for "msg91"',
    '<%= config.bin %> <%= command.id %> msg91 authkey    # show just the "authkey" value',
  ]

  public async run(): Promise<void> {
    const {args} = await this.parse(ConfigGet)

    let savedConfig: SavedConfig
    try {
      savedConfig = JSON.parse(await readFile(configPath(), 'utf8')) as SavedConfig
    } catch {
      this.error('No installed modules found. Run `docstar-cli init <domain>` first.')
    }

    const collection = savedConfig.collections.find((c) => c.cliName === args.cliName)
    if (!collection) {
      this.error(`Collection "${args.cliName}" isn't installed. Run \`docstar-cli list\` to see installed collections.`)
    }

    const credentials = collection.credentials || {}

    if (args.key) {
      if (!(args.key in credentials)) {
        this.error(`No credential named "${args.key}" saved for collection "${args.cliName}".`)
      }

      this.log(credentials[args.key])
      return
    }

    const entries = Object.entries(credentials)
    if (entries.length === 0) {
      this.log(`No credentials saved for collection "${args.cliName}".`)
      return
    }

    for (const [key, value] of entries) this.log(`${key}=${value}`)
  }
}
