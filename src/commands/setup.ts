import {confirm} from '@inquirer/prompts'
import {Args, Command, Flags} from '@oclif/core'
import {spawnSync} from 'node:child_process'

import type {CollectionListResponse} from '../lib/types.js'

import {installMcp, onPath} from '../lib/agents.js'
import {apiUrlOf, getSignIn} from '../lib/auth.js'
import {fetchCollection} from '../lib/contracts.js'
import {skillNameOf, writeSkill} from '../lib/skill.js'
import {isReservedSlug, SLUG_PATTERN} from '../lib/slug.js'

// viaSocket MCP, where every collection's MCP server is hosted (hitman-api utils/mcpUtils.js)
export const MCP_HOST = (process.env.DOCSTAR_MCP_URL || 'https://mcp.docstar.io').replace(/\/$/, '')

// The collection's MCP server answers an `initialize` (200), or asks for sign-in (401): either way it is there.
// Anything else (an unknown slug answers 503) means it can't be confirmed.
export const probeMcp = async (url: string): Promise<boolean> => {
  try {
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- fetch is in every Node 18+, as contracts.ts uses it
    const response = await fetch(url, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'initialize',
        params: {capabilities: {}, clientInfo: {name: 'docstar-cli-setup', version: '1'}, protocolVersion: '2025-06-18'},
      }),
      headers: {Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json'},
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
    })
    await response.body?.cancel()
    return response.status === 200 || response.status === 401
  } catch {
    return false
  }
}

const runningFromNpx = (): boolean => /[/\\]_npx[/\\]/.test(process.argv[1] ?? '') || !onPath('docstar-cli')
const isInteractive = (): boolean => Boolean(process.stdin.isTTY && process.stdout.isTTY)

export default class Setup extends Command {
  static override args = {
    slug: Args.string({description: 'Slug of the DocStar collection, e.g. msg91', required: true}),
  }
  static override description = [
    "One command to use a DocStar collection's API from every AI tool on this computer:",
    '  1. installs docstar-cli (npm install -g), when run through npx',
    '  2. registers the collection (all modules) and its `<slug>` shortcut',
    "  3. adds the collection's MCP server to Claude Code, Cursor, Codex, OpenCode, GitHub Copilot CLI and Factory Droid, where installed",
    '  4. adds a skill for the collection to your AI agents',
    '  5. signs you in, when the collection has a sign-in',
    'Nothing already set up is changed. Use --dry-run to see what would change first.',
  ].join('\n')
  static override examples = [
    '<%= config.bin %> <%= command.id %> msg91',
    '<%= config.bin %> <%= command.id %> msg91 --dry-run',
    'npx docstar-cli <%= command.id %> msg91 -y          # sign in without asking first',
  ]
  static override flags = {
    api: Flags.string({description: 'DocStar API the docs are read from (default: $DOCSTAR_API_URL, else https://api.docstar.io)'}),
    'dry-run': Flags.boolean({description: 'Show what would change, change nothing'}),
    'mcp-url': Flags.string({description: "The collection's MCP server URL, if it isn't https://mcp.docstar.io/connector/<slug> (e.g. the owner's own domain)"}),
    'no-login': Flags.boolean({description: "Don't sign in"}),
    'skip-init': Flags.boolean({description: "Don't register the collection"}),
    'skip-install': Flags.boolean({description: "Don't install docstar-cli globally"}),
    'skip-mcp': Flags.boolean({description: "Don't add the MCP server"}),
    'skip-skill': Flags.boolean({description: "Don't add the skill"}),
    yes: Flags.boolean({char: 'y', description: 'Sign in without asking first'}),
  }
  private problems = 0

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Setup)
    const {slug} = args
    const dry = flags['dry-run']
    if (!SLUG_PATTERN.test(slug)) this.error(`"${slug}" is not a collection slug. Use the slug of the docs (lowercase letters, numbers, - and _), e.g. \`${this.config.bin} setup msg91\`.`)
    if (isReservedSlug(slug)) this.error(`"${slug}" is the name of a docstar-cli command, so no collection can use it as a slug.`)

    const api = apiUrlOf(flags.api)
    let collection: CollectionListResponse
    try {
      collection = await fetchCollection(slug, api)
    } catch (error) {
      this.error((error as Error).message)
    }

    const name = collection.collection?.name || slug
    this.log(`Setting up ${name} (${slug})${dry ? ' — dry run, nothing will change' : ''}\n`)

    this.installCli(flags['skip-install'], dry)
    await this.register(slug, api, flags['skip-init'], dry)
    await this.addMcp(slug, collection, {dry, mcpUrl: flags['mcp-url'], skip: flags['skip-mcp']})
    await this.addSkill(slug, collection, flags['skip-skill'], dry)
    await this.signIn(slug, collection, {dry, noLogin: flags['no-login'], yes: flags.yes})

    this.log('')
    if (dry) this.log('Dry run done. Run it without --dry-run to apply.')
    else if (this.problems > 0) this.log(`Done, with ${this.problems} problem(s) above.`)
    else this.log(`Done. Ask your AI agent to use ${name}, or run: ${this.config.bin} ${slug}`)
    if (this.problems > 0 && !dry) this.exit(1)
  }

  private async addMcp(
    slug: string,
    collection: CollectionListResponse,
    {dry, mcpUrl, skip}: {dry: boolean; mcpUrl?: string; skip: boolean},
  ): Promise<void> {
    this.step('MCP server')
    if (skip) return this.say(null, 'skipped (--skip-mcp)')

    const url = mcpUrl || collection.mcp?.url || `${MCP_HOST}/connector/${slug}`
    // A URL given with --mcp-url is trusted as it is
    if (!mcpUrl && !(await probeMcp(url))) {
      this.say(null, `${url} didn't answer, so no MCP server was added. If the docs site shows an MCP URL, run again with --mcp-url <url>.`)
      return
    }

    const results = installMcp(slug, url, {dryRun: dry})
    if (results.length === 0) this.say(null, 'no MCP-capable AI tool found (looked for Claude Code, Cursor, Codex, OpenCode, Copilot CLI, Factory Droid)')
    for (const result of results) {
      switch (result.status) {
        case 'added': {
          this.say(true, `${result.tool}: added "${slug}" (${url})`)
          break
        }

        case 'already': {
          this.say(true, `${result.tool}: already has an MCP server named "${slug}", left as it is`)
          break
        }

        case 'would-add': {
          this.say(null, `${result.tool}: would add "${slug}" (${result.detail})`)
          break
        }

        default: {
          this.fail(`${result.tool}: ${result.detail}`)
        }
      }
    }

    this.say(null, `Claude, ChatGPT and other chat apps: add ${url} as a custom connector in their settings`)
  }

  private async addSkill(slug: string, collection: CollectionListResponse, skip: boolean, dry: boolean): Promise<void> {
    this.step('Skill')
    if (skip) return this.say(null, 'skipped (--skip-skill)')
    if (dry) return this.say(null, `would write the "${skillNameOf(slug)}" skill and add it to your AI agents (npx skills add ... -g -y --copy)`)

    const dir = await writeSkill(slug, collection, this.config.bin)
    const answer = spawnSync('npx', ['-y', 'skills', 'add', dir, '-g', '-y', '--copy'], {
      encoding: 'utf8',
      env: {...process.env, AI_AGENT: process.env.AI_AGENT || 'docstar-cli-setup'},
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (answer.status === 0) this.say(true, `added "${skillNameOf(slug)}" to the AI agents found on this computer`)
    else this.fail(`couldn't add the skill. Run it yourself: npx skills add ${dir} -g\n      ${lastLines(answer.stderr || answer.stdout || '')}`)
  }

  private fail(message: string): void {
    this.problems++
    this.say(false, message)
  }

  private installCli(skip: boolean, dry: boolean): void {
    this.step('CLI')
    if (skip) return this.say(null, 'skipped (--skip-install)')
    if (!runningFromNpx()) return this.say(true, `${this.config.bin} is installed`)
    if (dry) return this.say(null, 'would run: npm install -g docstar-cli@latest')

    const answer = spawnSync('npm', ['install', '-g', 'docstar-cli@latest'], {encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'ignore', 'pipe']})
    if (answer.status === 0) this.say(true, 'installed: the `docstar-cli` command is ready')
    else this.fail(`npm install -g docstar-cli@latest failed; keep using npx docstar-cli, or install it yourself.\n      ${lastLines(answer.stderr || '')}`)
  }

  private async register(slug: string, api: string, skip: boolean, dry: boolean): Promise<void> {
    this.step('Collection')
    if (skip) return this.say(null, 'skipped (--skip-init)')
    if (dry) return this.say(null, `would run: ${this.config.bin} init ${slug} --all`)
    try {
      await this.config.runCommand('init', [slug, '--all', '--api', api])
      this.say(true, `registered every module of "${slug}"`)
    } catch (error) {
      this.fail(`couldn't register "${slug}": ${(error as Error).message}`)
    }
  }

  private say(ok: boolean | null, message: string): void {
    this.log(`  ${ok === true ? '✓' : ok === false ? '✗' : '·'} ${message}`)
  }

  private async signIn(slug: string, collection: CollectionListResponse, {dry, noLogin, yes}: {dry: boolean; noLogin: boolean; yes: boolean}): Promise<void> {
    this.step('Sign in')
    // null = the docs owner set up no sign-in; absent = an older API that doesn't say, so offer it anyway
    if (collection.auth === null) return this.say(true, 'not needed: this collection has no sign-in')
    if (await getSignIn(slug)) return this.say(true, `already signed in (check with: ${this.config.bin} auth status)`)
    if (noLogin) return this.say(null, `skipped. Sign in any time with: ${this.config.bin} login ${slug}`)
    if (dry) return this.say(null, `would run: ${this.config.bin} login ${slug}`)
    // An AI agent running this can't answer a prompt: never hang, say what to run instead
    if (!yes && !isInteractive()) {
      return this.say(null, `not signed in. Run \`${this.config.bin} login ${slug} --no-wait\`, open the link, then \`${this.config.bin} login ${slug} --continue\``)
    }

    if (!yes && !(await confirm({default: true, message: `Sign in to ${collection.collection?.name || slug} in your browser now?`}))) {
      return this.say(null, `skipped. Sign in any time with: ${this.config.bin} login ${slug}`)
    }

    try {
      await this.config.runCommand('login', [slug])
    } catch (error) {
      this.fail(`sign-in didn't finish: ${(error as Error).message}`)
    }
  }

  private step(title: string): void {
    this.log(`==> ${title}`)
  }
}

const lastLines = (text: string, count = 4): string => text.trim().split('\n').slice(-count).join('\n      ')
