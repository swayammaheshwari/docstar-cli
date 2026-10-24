import {Args, Command, Flags} from '@oclif/core'
import {relative, resolve} from 'node:path'

import {ensureGitignored, upsertEnvVar} from '../../lib/env-file.js'

const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]*$/

// Picks up the API keys (and other values, such as a secret or a project id) that a DocStar MCP server created for the
// signed-in user (its API key tool returns this command with a one-time code) and writes them to the project's .env.
// The values are never printed: AI assistants read this command's output, and anything printed would end up in their
// context.
export default class KeyPull extends Command {
  static override args = {
    code: Args.string({description: 'One-time code from the MCP server, e.g. ABCD-EFGH-JKLM', required: true}),
  }
  static override description = [
    'Write the API keys a DocStar MCP server created for you to your .env, using the one-time code its API key tool gave you.',
    'The values are never shown: only their last 4 characters. The env file is added to .gitignore.',
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

    const body = (await response.json().catch(() => ({}))) as {error?: string; vars?: Record<string, unknown>}
    if (!response.ok) this.error(body.error || `The key pickup failed (HTTP ${response.status})`)
    const entries = Object.entries(body.vars || {})
    if (entries.length === 0 || !entries.every(([name, value]) => ENV_VAR_PATTERN.test(name) && typeof value === 'string' && value)) {
      this.error('The key pickup answered with something unexpected')
    }

    const envFile = resolve(flags.env)
    const written: string[] = []
    for (const [name, value] of entries as Array<[string, string]>) {
      // eslint-disable-next-line no-await-in-loop
      const replaced = await upsertEnvVar(envFile, name, value)
      written.push(`${name} (…${value.slice(-4)}${replaced ? ', replaced' : ''})`)
    }

    const ignored = await ensureGitignored(envFile)
    const where = relative(process.cwd(), envFile) || envFile
    this.log(`✓ ${written.join(', ')} written in ${where}${ignored ? `, and ${where} added to .gitignore` : ''}`)
  }
}
