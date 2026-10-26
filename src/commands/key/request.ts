import {Command} from '@oclif/core'

import {createKeyRequest, PENDING_KEY_TTL_MS} from '../../lib/key-crypto.js'

// First half of getting an API key into a project: makes a keypair, keeps the private key on this machine and prints
// the public key, which the assistant gives to the MCP tool so the key is encrypted for this machine only.
export default class KeyRequest extends Command {
  static override description = [
    'Start getting an API key from a DocStar MCP server into your .env.',
    'Prints a public key to give to the MCP tool; the key it returns is encrypted so only this machine can open it.',
    'Then run the `key save` command the tool gives you.',
  ].join('\n')
  static override examples = ['<%= config.bin %> <%= command.id %>']

  public async run(): Promise<void> {
    await this.parse(KeyRequest)
    const {publicKey} = await createKeyRequest()
    this.log(`publicKey: ${publicKey}`)
    this.log(`Give the publicKey to the MCP tool, then run the key save command it returns (valid for ${PENDING_KEY_TTL_MS / 60_000} minutes).`)
  }
}
