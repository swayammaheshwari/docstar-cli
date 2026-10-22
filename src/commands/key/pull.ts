import {Args, Command, Flags} from '@oclif/core'
import {relative, resolve} from 'node:path'

import {ensureGitignored, upsertEnvVar} from '../../lib/env-file.js'

const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]*$/

// Picks up an API key that a DocStar MCP server created for the signed-in user (its API key tool returns this command
// with a one-time code) and writes it to the project's .env. The key is never printed: AI assistants read this
// command's output, and anything printed would end up in their context.
export default class KeyPull extends Command {
  static override args = {
    code: Args.string({description: 'One-time code from the MCP server, e.g. ABCD-EFGH-JKLM', required: true}),
  }
  static override description = [
    'Write an API key created by a DocStar MCP server to your .env, using the one-time code its API key tool gave you.',
    'The key is never shown: only its last 4 characters. The env file is added to .gitignore.',
  ].join('\n')
  static override examples = ['<%= config.bin %> <%= command.id %> ABCD-EFGH-JKLM', '<%= config.bin %> <%= command.id %> ABCD-EFGH-JKLM --env .env.local']
  static override flags = {
    api: Flags.string({default: 'https://api.docstar.io', description: 'DocStar API the key is picked up from'}),
    env: Flags.string({default: '.env', description: 'Env file to write the key to'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(KeyPull)
    const api = flags.api.replace(/\/$/, '')

    let response: Response
    try {
      response = await fetch(`${api}/p/mcp-api-key/pull`, {
        body: JSON.stringify({code: args.code}),
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      })
    } catch (error) {
      this.error(`Couldn't reach ${api}: ${(error as Error).message}`)
    }

    const body = (await response.json().catch(() => ({}))) as {envVar?: string; error?: string; key?: string}
    if (!response.ok) this.error(body.error || `The key pickup failed (HTTP ${response.status})`)
    const {envVar, key} = body
    if (!envVar || !ENV_VAR_PATTERN.test(envVar) || typeof key !== 'string' || !key) {
      this.error('The key pickup answered with something unexpected')
    }

    const envFile = resolve(flags.env)
    const replaced = await upsertEnvVar(envFile, envVar, key)
    const ignored = await ensureGitignored(envFile)
    const where = relative(process.cwd(), envFile) || envFile
    this.log(`✓ ${envVar} ${replaced ? 'replaced' : 'written'} in ${where} (…${key.slice(-4)})${ignored ? `, and ${where} added to .gitignore` : ''}`)
  }
}
