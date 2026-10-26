import {Args, Command, Flags} from '@oclif/core'
import {relative, resolve} from 'node:path'

import {maskKey, readCredential} from '../../lib/credentials.js'
import {ensureGitignored, upsertEnvVar} from '../../lib/env-file.js'
import {ENV_VAR_PATTERN} from '../../lib/key-crypto.js'

// Writes a key that `key save` stored to a project's env file. The key is never printed: AI assistants read this
// command's output, and anything printed would end up in their context.
export default class KeyEmit extends Command {
  // Positional order is part of the command (`key emit <slug> <name>`), so these keys must not be sorted by the linter
  static override args = {
    slug: Args.string({description: 'Installed collection (slug), e.g. msg91', required: true}),
    // eslint-disable-next-line perfectionist/sort-objects
    name: Args.string({description: 'Credential name, e.g. authkey', required: true}),
  }
  static override description = [
    'Write an API key stored by `key save` to a project .env, as the variable the provider chose.',
    'Other lines are kept, the file is made readable by you only and added to .gitignore.',
    'The key is never shown: only its last 4 characters.',
  ].join('\n')
  static override examples = ['<%= config.bin %> <%= command.id %> msg91 authkey --env .env', '<%= config.bin %> <%= command.id %> msg91 authkey --env .env.local --var MSG91_KEY']
  static override flags = {
    env: Flags.string({default: '.env', description: 'Env file to write the key to'}),
    var: Flags.string({description: 'Variable name to write, instead of the one the provider chose'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(KeyEmit)

    let stored: Awaited<ReturnType<typeof readCredential>>
    try {
      stored = await readCredential(args.slug, args.name)
    } catch (error) {
      this.error((error as Error).message)
    }

    const envVar = flags.var ?? stored.meta.envVar
    if (!envVar) this.error(`No variable name is known for "${args.name}": pass --var NAME`)
    if (!ENV_VAR_PATTERN.test(envVar)) this.error(`"${envVar}" is not a valid variable name (uppercase letters, digits and _, starting with a letter)`)

    const envFile = resolve(flags.env)
    const replaced = await upsertEnvVar(envFile, envVar, stored.value)
    const ignored = await ensureGitignored(envFile)
    const where = relative(process.cwd(), envFile) || envFile
    this.log(`✓ ${envVar} ${replaced ? 'replaced' : 'written'} in ${where} (${maskKey(stored.value)})${ignored ? `, and ${where} added to .gitignore` : ''}`)
  }
}
