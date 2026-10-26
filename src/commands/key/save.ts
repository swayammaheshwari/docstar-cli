import {Command, Flags} from '@oclif/core'
import {relative, resolve} from 'node:path'

import {ensureGitignored, upsertEnvVar} from '../../lib/env-file.js'
import {decryptKeyPayload} from '../../lib/key-crypto.js'

// Second half: opens the encrypted key an MCP tool returned and writes it to the project's .env. The key is never
// printed: AI assistants read this command's output, and anything printed would end up in their context.
export default class KeySave extends Command {
  static override description = [
    'Write an API key to your .env, from the encrypted payload a DocStar MCP tool returned after `key request`.',
    'The key is never shown: only its last 4 characters. The env file is added to .gitignore.',
  ].join('\n')
  static override examples = ['<%= config.bin %> <%= command.id %> --payload eyJ2Ijox... --env .env.local']
  static override flags = {
    env: Flags.string({default: '.env', description: 'Env file to write the key to'}),
    payload: Flags.string({description: 'Encrypted key from the MCP tool', required: true}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(KeySave)

    let opened: Awaited<ReturnType<typeof decryptKeyPayload>>
    try {
      opened = await decryptKeyPayload(flags.payload)
    } catch (error) {
      this.error((error as Error).message)
    }

    const {envVar, key} = opened.body
    const envFile = resolve(flags.env)
    const replaced = await upsertEnvVar(envFile, envVar, key)
    const ignored = await ensureGitignored(envFile)
    // The private key goes only after the key is saved, so a failed write can be retried with the same payload
    await opened.forget()
    const where = relative(process.cwd(), envFile) || envFile
    this.log(`✓ ${envVar} ${replaced ? 'replaced' : 'written'} in ${where} (…${key.slice(-4)})${ignored ? `, and ${where} added to .gitignore` : ''}`)
  }
}
