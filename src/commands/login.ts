import {Args, Command, Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'

import {
  apiUrlOf,
  type PendingSignIn,
  readPendingSignIns,
  removePendingSignIn,
  savePendingSignIn,
  saveSignIn,
  signInFromTokens,
  startSignIn,
  type TokenAnswer,
  waitForSignIn,
} from '../lib/auth.js'
import {openInBrowser} from '../lib/browser.js'
import {parseSavedConfig} from '../lib/config.js'
import {configPath} from '../lib/paths.js'

// The collection id saved by `init --collectionId` (a docs site without its own domain, e.g. localhost)
const installedCollectionId = async (slug: string): Promise<null | string> => {
  try {
    const savedConfig = parseSavedConfig(await readFile(configPath(), 'utf8'))
    return savedConfig.collections.find((collection) => collection.slug === slug)?.collectionId || null
  } catch {
    return null
  }
}

export default class Login extends Command {
  static override args = {
    collection: Args.string({description: 'The collection (slug) to sign in to, e.g. msg91', required: true}),
  }
  static override description = [
    "Sign in to a collection's platform in your browser, so its API calls (commands and MCP tools) use your account.",
    'Works for docs sites whose owner set up sign-in (OAuth) for their DocStar MCP server. Your tokens are saved in',
    '~/.docstar/credentials.json (readable by you only), refreshed automatically, and never printed.',
    'AI assistants that run one command at a time can use `--no-wait`, show you the link, then run `--continue`.',
  ].join('\n')
  static override examples = [
    '<%= config.bin %> <%= command.id %> msg91',
    '<%= config.bin %> <%= command.id %> msg91 --no-browser          # only print the link',
    '<%= config.bin %> <%= command.id %> msg91 --no-wait             # print the link and exit',
    '<%= config.bin %> <%= command.id %> msg91 --continue            # then finish once you signed in',
  ]
  static override flags = {
    api: Flags.string({description: 'DocStar API to sign in through (default: $DOCSTAR_API_URL or https://api.docstar.io)'}),
    continue: Flags.boolean({description: 'Finish a sign-in started with --no-wait', exclusive: ['no-wait']}),
    'no-browser': Flags.boolean({description: "Don't open a browser, only print the sign-in link"}),
    'no-wait': Flags.boolean({description: 'Print the sign-in link and exit; finish with --continue'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Login)
    const slug = args.collection

    try {
      if (flags.continue) {
        const pending = (await readPendingSignIns())[slug]
        if (!pending) this.error(`No sign-in to "${slug}" is waiting. Run \`${this.config.bin} login ${slug}\` first.`)
        this.log(`Waiting for you to sign in to ${pending.collection.name}... (Ctrl+C to cancel)`)
        await this.finish(slug, pending, await waitForSignIn(pending.api, pending))
        return
      }

      const api = apiUrlOf(flags.api)
      const start = await startSignIn(api, {collectionId: await installedCollectionId(slug), slug})
      const pending: PendingSignIn = {...start, api, expiresAt: Date.now() + start.expiresIn * 1000}

      this.log(`Sign in to ${start.collection.name} in your browser:\n\n  ${start.loginUrl}\n`)
      if (flags['no-wait']) {
        await savePendingSignIn(slug, pending)
        this.log(`The link works for ${Math.round(start.expiresIn / 60)} minutes. After signing in, run:\n\n  ${this.config.bin} login ${slug} --continue`)
        return
      }

      if (!flags['no-browser'] && openInBrowser(start.loginUrl)) this.log('Opened it in your browser.')
      this.log('Waiting for you to sign in... (Ctrl+C to cancel)')
      await this.finish(slug, pending, await waitForSignIn(api, pending))
    } catch (error) {
      if ((error as {oclif?: unknown}).oclif) throw error
      this.error((error as Error).message)
    }
  }

  private async finish(slug: string, pending: PendingSignIn, tokens: TokenAnswer): Promise<void> {
    await saveSignIn(pending.collection.slug || slug, signInFromTokens(pending.api, pending.collection, tokens))
    await removePendingSignIn(slug)
    this.log(`✓ Signed in to ${pending.collection.name} (${pending.collection.slug || slug}). Its API calls now use your account.`)
  }
}

