import {Args, Command} from '@oclif/core'
import {storeCredential} from '../../lib/credentials.js'

export default class ConfigSet extends Command {
  static override args = {
    slug: Args.string({description: 'Installed collection (slug), e.g. msg91', required: true}),
    key: Args.string({description: 'Credential name, matching a header/param name, e.g. authkey', required: true}),
    value: Args.string({description: 'Value to store', required: true}),
  }
  static override description = [
    'Save a per-collection credential (e.g. an API/auth key) so it is injected into every request',
    'Prefer `key request` / `key save`, which get a key without it passing through your terminal or an AI assistant.',
    'automatically, instead of having to pass it as a flag on every command.',
    'An explicit `--<key> value` flag on a command still overrides the saved credential.',
  ].join('\n')
  static override examples = ['<%= config.bin %> <%= command.id %> msg91 authkey 279417Ac93k5fIO5qG6a9e6a8eP1']

  public async run(): Promise<void> {
    const {args} = await this.parse(ConfigSet)

    try {
      await storeCredential(args.slug, args.key, args.value)
    } catch (error) {
      this.error((error as Error).message)
    }

    this.log(`Saved "${args.key}" for collection "${args.slug}".`)
  }
}
