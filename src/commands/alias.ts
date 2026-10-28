import {Args, Command, Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import {parseSavedConfig} from '../lib/config.js'
import {configPath} from '../lib/paths.js'
import {announceShim, removeShim} from '../lib/shim.js'

export default class Alias extends Command {
  static override args = {
    collection: Args.string({description: 'The installed collection (slug) to make a command for, e.g. msg91', required: true}),
  }
  static override description = [
    'Make an installed collection available as its own command, so `msg91 <module> <endpoint>` works instead of `docstar-cli msg91 <module> <endpoint>`.',
    '`init` does this for you; use `alias` for collections installed before, or after `--remove`.',
  ].join('\n')
  static override examples = ['<%= config.bin %> <%= command.id %> msg91', '<%= config.bin %> <%= command.id %> msg91 --remove']
  static override flags = {
    remove: Flags.boolean({description: 'Remove the shortcut command instead of creating it'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Alias)

    if (flags.remove) {
      const removed = await removeShim(args.collection)
      this.log(removed.length > 0 ? `Removed: ${removed.join(', ')}` : `No shortcut for "${args.collection}" found.`)
      return
    }

    const saved = parseSavedConfig(await readFile(configPath(), 'utf8').catch(() => '{"collections":[]}'))
    if (!saved.collections.some((collection) => collection.slug === args.collection)) {
      this.error(`Collection "${args.collection}" isn't installed. Run \`${this.config.bin} init ${args.collection}\` first.`)
    }

    await announceShim((message) => this.log(message), (message) => this.warn(message), this.config.bin, args.collection)
  }
}
