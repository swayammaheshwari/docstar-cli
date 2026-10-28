import {Args, Command, Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'

import type {SavedConfig} from '../lib/types.js'

import {parseSavedConfig} from '../lib/config.js'
import {fetchCollection, fetchModuleIndex, registeredCollection} from '../lib/contracts.js'
import {entrySummary} from '../lib/endpoint-flags.js'
import {signInHeaderOf} from '../lib/http.js'
import {configPath} from '../lib/paths.js'

export default class List extends Command {
  static override args = {
    collection: Args.string({description: 'Show the modules of this collection (slug), e.g. msg91', required: false}),
    module: Args.string({description: 'Show all endpoints of this module within the collection, e.g. slack', required: false}),
  }
  static override description = [
    'List the registered collections, the modules of any collection, or every endpoint of one module.',
    'A collection or module is read live from its docs, so it works without `init`.',
  ].join('\n')
  static override examples = [
    '<%= config.bin %> <%= command.id %>              # list every registered collection',
    '<%= config.bin %> <%= command.id %> --all        # same as above',
    '<%= config.bin %> <%= command.id %> msg91         # list the modules of the "msg91" collection',
    '<%= config.bin %> <%= command.id %> msg91 slack   # list all of Slack\'s endpoints in "msg91"',
  ]
  static override flags = {
    all: Flags.boolean({description: 'List every registered collection (default when no arguments are given)'}),
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(List)

    if (!args.collection) {
      let savedConfig: SavedConfig = {collections: []}
      try {
        savedConfig = parseSavedConfig(await readFile(configPath(), 'utf8'))
      } catch {
        // nothing registered
      }

      const registered = savedConfig.collections.filter((collection) => collection.modules.length > 0)
      if (registered.length === 0) {
        this.log(`No collections registered. Any collection works without it (\`${this.config.bin} <slug> <module> <command>\`); \`${this.config.bin} init <slug>\` adds a shortcut.`)
        return
      }

      for (const collection of registered) {
        this.log(`${collection.name} (${collection.slug}) — ${collection.api ?? collection.domain} — ${collection.modules.length} module${collection.modules.length === 1 ? '' : 's'}`)
      }

      return
    }

    try {
      const note = (await registeredCollection(args.collection))?.modules.length ? '' : ' (not registered)'
      if (!args.module) {
        const listing = await fetchCollection(args.collection)
        this.log(`${listing.collection?.name ?? args.collection} (${args.collection})${note}`)
        for (const module of listing.modules) {
          const count = module.endpointCount ?? module.endpoints?.length ?? 0
          this.log(`${module.name} (${module.path}) — ${count} endpoint${count === 1 ? '' : 's'}`)
        }

        if ((listing.rootEndpoints?.length ?? 0) > 0) this.log(`Root endpoints — run as \`<collection> <endpoint>\`, list with \`list ${args.collection} __root__\``)
        return
      }

      const index = await fetchModuleIndex(args.collection, args.module)
      if (index.endpoints.length === 0) {
        this.log(`No endpoints found for module "${args.module}".`)
        return
      }

      const signInHeader = signInHeaderOf(index.auth)
      for (const entry of index.endpoints) for (const line of entrySummary(entry, signInHeader)) this.log(line)
    } catch (error) {
      this.error((error as Error).message)
    }
  }
}
