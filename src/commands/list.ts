import {Args, Command, Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import {loadModule} from '../lib/http.js'
import {configPath} from '../lib/paths.js'
import type {SavedConfig} from '../lib/types.js'

export default class List extends Command {
  static override args = {
    collection: Args.string({description: 'Show modules installed for this collection (CLI name), e.g. msg91', required: false}),
    module: Args.string({description: 'Show all endpoints for this module within the collection, e.g. slack', required: false}),
  }
  static override description = 'List installed collections, the modules within one, or every endpoint of one module'
  static override examples = [
    '<%= config.bin %> <%= command.id %>              # list every installed collection',
    '<%= config.bin %> <%= command.id %> --all        # same as above',
    '<%= config.bin %> <%= command.id %> msg91         # list modules installed for the "msg91" collection',
    '<%= config.bin %> <%= command.id %> msg91 slack   # list all of Slack\'s installed endpoints in "msg91"',
  ]
  static override flags = {
    all: Flags.boolean({description: 'List every installed collection (default when no arguments are given)'}),
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(List)

    let savedConfig: SavedConfig
    try {
      savedConfig = JSON.parse(await readFile(configPath(), 'utf8')) as SavedConfig
    } catch {
      this.error('No installed modules found. Run `docstar-cli init <domain>` first.')
    }

    if (savedConfig.collections.length === 0) {
      this.log('No collections installed. Run `docstar-cli init <domain>` to install one.')
      return
    }

    if (!args.collection) {
      for (const collection of savedConfig.collections) {
        this.log(`${collection.name} (${collection.cliName}) — ${collection.domain} — ${collection.modules.length} module${collection.modules.length === 1 ? '' : 's'}`)
      }

      return
    }

    const collection = savedConfig.collections.find((c) => c.cliName === args.collection)
    if (!collection) {
      this.error(`Collection "${args.collection}" isn't installed. Run \`docstar-cli list\` to see installed collections.`)
    }

    if (!args.module) {
      for (const module of collection.modules) {
        // eslint-disable-next-line no-await-in-loop
        const moduleJson = await loadModule(collection.cliName, module.path)
        const count = moduleJson.endpoints.length
        this.log(`${module.name} (${module.path}) — ${count} endpoint${count === 1 ? '' : 's'}`)
      }

      return
    }

    const moduleJson = await loadModule(collection.cliName, args.module)

    if (moduleJson.endpoints.length === 0) {
      this.log(`No endpoints found for module "${args.module}".`)
      return
    }

    for (const endpoint of moduleJson.endpoints) {
      const {cli} = endpoint
      const aliases = cli.command.aliases.filter((alias) => alias !== cli.command.name)
      this.log(`${cli.command.name}${aliases.length > 0 ? ` (aliases: ${aliases.join(', ')})` : ''}`)
      if (cli.description) this.log(`  ${cli.description}`)
      this.log(`  ${endpoint.method}`)
      if (cli.parameters.required.length > 0) this.log(`  required: ${cli.parameters.required.join(', ')}`)
      if (cli.parameters.optional.length > 0) this.log(`  optional: ${cli.parameters.optional.join(', ')}`)
      this.log('')
    }
  }
}
