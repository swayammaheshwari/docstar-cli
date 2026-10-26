import {Command, Flags} from '@oclif/core'

import {maskKey, storeCredential} from '../../lib/credentials.js'
import {decryptKeyPayload} from '../../lib/key-crypto.js'

// Second half: opens the encrypted key an MCP tool returned and stores it in docstar-cli, under its collection. It is not
// written to any project yet: `key emit` does that. The key is never printed: AI assistants read this command's output,
// and anything printed would end up in their context.
export default class KeySave extends Command {
  static override description = [
    'Store an API key, from the encrypted payload a DocStar MCP tool returned after `key request`, in docstar-cli.',
    'Commands of that collection then send it automatically. Use `key emit` to write it to a project .env.',
    'The key is never shown: only its last 4 characters.',
  ].join('\n')
  static override examples = ['<%= config.bin %> <%= command.id %> --payload eyJ2Ijox...']
  static override flags = {
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

    const {envVar, key, name, prefix, slug} = opened.body
    let replaced: boolean
    try {
      replaced = await storeCredential(slug, name, key, {envVar, ...(prefix ? {prefix} : {})})
    } catch (error) {
      // The private key stays, so the same payload can be saved once the collection is installed
      this.error((error as Error).message)
    }

    await opened.forget()
    this.log(`✓ ${name} ${replaced ? 'replaced' : 'saved'} for "${slug}" (${maskKey(key)})`)
    this.log(`To write it to a project's .env: ${this.config.bin} key emit ${slug} ${name} --env .env`)
  }
}
