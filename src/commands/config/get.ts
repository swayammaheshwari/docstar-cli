import {Args, Command} from '@oclif/core'
import {parseSavedConfig} from '../../lib/config.js'
import {readFile} from 'node:fs/promises'
import {configPath} from '../../lib/paths.js'
import type {SavedConfig} from '../../lib/types.js'

export default class ConfigGet extends Command {
  static override args = {
    slug: Args.string({description: 'Installed collection (slug), e.g. msg91', required: true}),
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
      savedConfig = parseSavedConfig(await readFile(configPath(), 'utf8'))
    } catch {
      this.error('No installed modules found. Run `docstar-cli init <slug>` first.')
    }

    const collection = savedConfig.collections.find((c) => c.slug === args.slug)
    if (!collection) {
      this.error(`Collection "${args.slug}" isn't installed. Run \`docstar-cli list\` to see installed collections.`)
    }

    const credentials = collection.credentials || {}

    if (args.key) {
      if (!(args.key in credentials)) {
        this.error(`No credential named "${args.key}" saved for collection "${args.slug}".`)
      }

      this.log(credentials[args.key])
      return
    }

    const entries = Object.entries(credentials)
    if (entries.length === 0) {
      this.log(`No credentials saved for collection "${args.slug}".`)
      return
    }

    for (const [key, value] of entries) this.log(`${key}=${value}`)
  }
}
