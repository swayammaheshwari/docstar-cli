import {Args, Command, Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import {loadModule} from '../lib/http.js'
import {configPath} from '../lib/paths.js'
import type {SavedConfig} from '../lib/types.js'

export default class List extends Command {
  static override args = {
    module: Args.string({description: 'Show all endpoints for this installed module, e.g. slack', required: false}),
  }
  static override description = 'List installed modules, or every endpoint of one module'
  static override examples = [
    '<%= config.bin %> <%= command.id %>            # list every installed module',
    '<%= config.bin %> <%= command.id %> --all      # same as above',
    '<%= config.bin %> <%= command.id %> slack       # list all of Slack\'s installed endpoints',
  ]
  static override flags = {
    all: Flags.boolean({description: 'List every installed module (default when no module is given)'}),
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(List)

    let savedConfig: SavedConfig
    try {
      savedConfig = JSON.parse(await readFile(configPath(), 'utf8')) as SavedConfig
    } catch {
      this.error('No installed modules found. Run `docstar-cli init <domain>` first.')
    }

    if (args.module) {
      const moduleJson = await loadModule(args.module)

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

      return
    }

    if (savedConfig.modules.length === 0) {
      this.log('No modules installed. Run `docstar-cli init <domain>` to install one.')
      return
    }

    for (const module of savedConfig.modules) {
      // eslint-disable-next-line no-await-in-loop
      const moduleJson = await loadModule(module.path)
      const count = moduleJson.endpoints.length
      this.log(`${module.name} (${module.path}) — ${count} endpoint${count === 1 ? '' : 's'}`)
    }
  }
}
