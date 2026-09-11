import {Args, Command} from '@oclif/core'
import {readFile, writeFile} from 'node:fs/promises'
import {configPath} from '../../lib/paths.js'
import type {SavedConfig} from '../../lib/types.js'

export default class ConfigSet extends Command {
  static override args = {
    cliName: Args.string({description: 'Installed collection (CLI name), e.g. msg91', required: true}),
    key: Args.string({description: 'Credential name, matching a header/param name, e.g. authkey', required: true}),
    value: Args.string({description: 'Value to store', required: true}),
  }
  static override description = [
    'Save a per-collection credential (e.g. an API/auth key) so it is injected into every request',
    'automatically, instead of having to pass it as a flag on every command.',
    'An explicit `--<key> value` flag on a command still overrides the saved credential.',
  ].join('\n')
  static override examples = ['<%= config.bin %> <%= command.id %> msg91 authkey 279417Ac93k5fIO5qG6a9e6a8eP1']

  public async run(): Promise<void> {
    const {args} = await this.parse(ConfigSet)

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

    collection.credentials = {...collection.credentials, [args.key]: args.value}

    await writeFile(configPath(), JSON.stringify(savedConfig, null, 2))

    this.log(`Saved "${args.key}" for collection "${args.cliName}".`)
  }
}
