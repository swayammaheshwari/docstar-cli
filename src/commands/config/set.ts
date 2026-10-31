import {Args, Command, Flags} from '@oclif/core'
import {CREDENTIAL_NAME_PATTERN, PREFIX_PATTERN, storeCredential} from '../../lib/credentials.js'

export default class ConfigSet extends Command {
  static override args = {
    slug: Args.string({description: 'Installed collection (slug), e.g. msg91', required: true}),
    key: Args.string({description: 'Credential name, matching a header/param name, e.g. authkey', required: true}),
    value: Args.string({description: 'Value to store (leave out with --env)', required: false}),
  }
  static override flags = {
    env: Flags.string({description: 'Read the value from this environment variable (or the project\'s .env) on every call, instead of storing it'}),
    prefix: Flags.string({description: 'Scheme put in front of the value in the header, e.g. Bearer'}),
  }
  static override description = [
    'Save a per-collection credential (e.g. an API/auth key) so it is injected into every request',
    'Prefer `key request` / `key save`, which get a key without it passing through your terminal or an AI assistant.',
    'automatically, instead of having to pass it as a flag on every command.',
    'An explicit `--<key> value` flag on a command still overrides the saved credential.',
  ].join('\n')
  static override examples = [
    '<%= config.bin %> <%= command.id %> msg91 authkey 279417Ac93k5fIO5qG6a9e6a8eP1',
    '<%= config.bin %> <%= command.id %> hm_demo Authorization --env HM_TOKEN --prefix Bearer   # nothing is stored: the key stays in .env',
  ]

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ConfigSet)
    if (flags.env && args.value) this.error('Give either a value or --env, not both.')
    if (!flags.env && !args.value) this.error('Give the value to store, or --env <VARIABLE> to read it from the environment.')
    if (flags.env && !CREDENTIAL_NAME_PATTERN.test(flags.env)) this.error(`"${flags.env}" is not an environment variable name.`)
    if (flags.prefix && !PREFIX_PATTERN.test(flags.prefix)) this.error('--prefix is a scheme word such as Bearer.')

    try {
      await (flags.env
        ? storeCredential(args.slug, args.key, '', {env: flags.env, ...(flags.prefix ? {prefix: flags.prefix} : {})})
        : storeCredential(args.slug, args.key, args.value as string, flags.prefix ? {prefix: flags.prefix} : {}))
    } catch (error) {
      this.error((error as Error).message)
    }

    this.log(flags.env ? `"${args.key}" for collection "${args.slug}" will be read from $${flags.env} on every call; no value is stored.` : `Saved "${args.key}" for collection "${args.slug}".`)
  }
}
