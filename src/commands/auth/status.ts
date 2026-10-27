import {Args, Command} from '@oclif/core'
import {readFile} from 'node:fs/promises'

import type {CollectionConfig} from '../../lib/types.js'

import {readSignIns, type SignIn} from '../../lib/auth.js'
import {parseSavedConfig} from '../../lib/config.js'
import {maskKey, sendableCredentials, valueByName} from '../../lib/credentials.js'
import {endpointNeeds, loadModule} from '../../lib/http.js'
import {configPath} from '../../lib/paths.js'

const expiryText = (signIn: SignIn, now: number): string => {
  if (!signIn.expiresAt) return 'signed in'
  const minutes = Math.round((signIn.expiresAt - now) / 60_000)
  if (minutes > 0) return `signed in, token expires in ${minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${minutes} min`}${signIn.refreshToken ? ' (refreshed automatically)' : ''}`
  return signIn.refreshToken ? 'signed in, token expired (refreshed on the next call)' : 'sign-in expired'
}

// What the collection's installed endpoints need: every API key name (once), and whether any runs on the sign-in
const neededBy = async (collection: CollectionConfig, signInHeader?: string): Promise<{apiKeys: string[]; signIn: boolean}> => {
  const apiKeys = new Map<string, string>()
  let signIn = false
  for (const module of collection.modules) {
    // eslint-disable-next-line no-await-in-loop
    const moduleJson = await loadModule(collection.slug, module.path).catch(() => null)
    for (const endpoint of moduleJson?.endpoints || []) {
      const needs = endpointNeeds(endpoint, signInHeader)
      for (const name of needs.apiKeys) if (!apiKeys.has(name.toLowerCase())) apiKeys.set(name.toLowerCase(), name)
      signIn ||= needs.signIn
    }
  }

  return {apiKeys: [...apiKeys.values()], signIn}
}

export default class AuthStatus extends Command {
  static override args = {
    collection: Args.string({description: 'Only this collection (slug), e.g. msg91'}),
  }
  static override description = [
    'Show what each installed collection needs to call its API (API keys, sign-in) and whether it is set up.',
    'Keys and tokens are never shown: only the last 4 characters of a saved key.',
  ].join('\n')
  static override examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> msg91']

  public async run(): Promise<void> {
    const {args} = await this.parse(AuthStatus)
    const signIns = await readSignIns()
    let collections: CollectionConfig[] = []
    try {
      collections = parseSavedConfig(await readFile(configPath(), 'utf8')).collections
    } catch {
      // nothing installed
    }

    if (args.collection) collections = collections.filter((collection) => collection.slug === args.collection)
    if (collections.length === 0) {
      this.log(args.collection ? `"${args.collection}" isn't installed. Run \`${this.config.bin} init ${args.collection}\`.` : `Nothing installed yet. Run \`${this.config.bin} init <collection>\`.`)
      return
    }

    const now = Date.now()
    for (const collection of collections) {
      this.log(`${collection.slug} (${collection.name})`)
      const signIn = signIns[collection.slug]
      // eslint-disable-next-line no-await-in-loop
      const needed = await neededBy(collection, signIn?.tokenHeader)
      const saved = sendableCredentials(collection)
      if (needed.apiKeys.length === 0 && !needed.signIn) this.log('  No API key or sign-in needed by the installed endpoints')

      for (const name of needed.apiKeys) {
        const value = valueByName(saved, name)
        this.log(value ? `  ✓ API key "${name}": saved (${maskKey(value)})` : `  ✗ API key "${name}": not saved. Run: ${this.config.bin} config set ${collection.slug} ${name} <key>`)
      }

      if (needed.signIn) {
        this.log(signIn ? `  ✓ Sign-in: ${expiryText(signIn, now)}` : `  ✗ Sign-in: not signed in. Run: ${this.config.bin} login ${collection.slug}`)
      }

      this.log('')
    }
  }
}
