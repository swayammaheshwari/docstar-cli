import {checkbox} from '@inquirer/prompts'
import {DEFAULT_API, parseSavedConfig} from '../lib/config.js'
import {Args, Command, Flags} from '@oclif/core'
import {mkdir, readFile, rm} from 'node:fs/promises'
import {join} from 'node:path'
import {fetchCollection, fetchModuleIndex} from '../lib/contracts.js'
import {writeSavedConfig} from '../lib/credentials.js'
import {announceShim} from '../lib/shim.js'
import {isReservedSlug, SLUG_PATTERN} from '../lib/slug.js'
import {collectionModulesDir, configDir, isRootModule, ROOT_MODULE_PATH, configPath} from '../lib/paths.js'
import type {CollectionConfig, ModuleSummary, SavedConfig} from '../lib/types.js'

const readSavedConfig = async (): Promise<SavedConfig> => {
  try {
    return parseSavedConfig(await readFile(configPath(), 'utf8'))
  } catch {
    return {collections: []}
  }
}

export default class Init extends Command {
  static override args = {
    slug: Args.string({description: 'Slug of the DocStar collection, e.g. msg91', required: true}),
  }
  static override description = [
    'Pick which modules of a DocStar collection (by its slug) to register, and get a `<slug>` shortcut command for them.',
    'You never have to run this: `docstar-cli <slug> <module> <command>` works for any collection, reading its docs live. Registering only adds the shortcut (`<slug> <module> <command>` without typing `docstar-cli`, skip with --no-alias), shell completion for the chosen modules, and their endpoints as MCP tools.',
    'Nothing is downloaded or generated: every command reads the docs as they are when it runs.',
    'You can register multiple collections — each is kept separate under its own slug. Run `docstar-cli list` to see what is registered.',
  ].join('\n')
  static override examples = ['<%= config.bin %> <%= command.id %> msg91', '<%= config.bin %> <%= command.id %> msg91 --api http://localhost:7072']
  static override flags = {
    api: Flags.string({default: DEFAULT_API, description: 'DocStar API the docs are read from'}),
    'no-alias': Flags.boolean({description: 'Do not create the `<slug>` shortcut command'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Init)

    const {slug: requestedSlug} = args
    if (!SLUG_PATTERN.test(requestedSlug)) {
      this.error(`"${requestedSlug}" is not a collection slug. Use the slug of the docs (lowercase letters, numbers, - and _), e.g. \`${this.config.bin} init msg91\`, not its domain.`)
    }

    if (isReservedSlug(requestedSlug)) this.error(`"${requestedSlug}" is the name of a docstar-cli command, so no collection can use it as a slug.`)

    const api = flags.api.replace(/\/$/, '')
    this.log(`Fetching modules for "${requestedSlug}" from ${api} ...`)

    const listResponse = await fetchCollection(requestedSlug, api)

    if (!listResponse.collection?.slug) {
      this.error('The docs site did not return a slug for this collection. Please update hitman-api/hitman-ui.')
    }

    const modules = listResponse.modules || []
    const rootEndpoints = listResponse.rootEndpoints || []

    if (modules.length === 0 && rootEndpoints.length === 0) {
      this.log('No published modules found.')
      return
    }

    const {slug} = listResponse.collection

    const SELECT_ALL = '__select_all__'

    const rawSelection = await checkbox({
      choices: [
        ...(rootEndpoints.length > 0
          ? [{
            checked: false,
            name: `Root endpoints — ${rootEndpoints.length} endpoint${rootEndpoints.length === 1 ? '' : 's'} (${rootEndpoints.map((endpoint) => endpoint.path).join(', ')})`,
            value: ROOT_MODULE_PATH,
          }]
          : []),
        ...modules.map((module) => {
          const count = module.endpointCount ?? module.endpoints?.length ?? 0
          return {
            checked: false,
            name: `${module.name} (${module.path}) — ${count} endpoint${count === 1 ? '' : 's'}`,
            value: module.path,
          }
        }),
        {checked: false, name: '➤ Select all modules', value: SELECT_ALL},
      ],
      message: `Select modules to register for "${slug}" (space to toggle, enter to confirm)`,
    })

    const selectedPaths = rawSelection.includes(SELECT_ALL) ? [...(rootEndpoints.length > 0 ? [ROOT_MODULE_PATH] : []), ...modules.map((module) => module.path)] : rawSelection

    if (selectedPaths.length === 0) {
      this.log('No modules selected, nothing installed.')
      return
    }

    const selectedModules: ModuleSummary[] = []

    for (const path of selectedPaths) {
      this.log(`Fetching ${path} ...`)
      // Only the module's index is read, for the command names (completion); each command reads its own endpoint when it runs.
      // eslint-disable-next-line no-await-in-loop
      const index = await fetchModuleIndex(slug, path, api)
      const commands: string[] = []

      for (const entry of index.endpoints) {
        // A root command `<slug> <endpoint>` would shadow a module's `<slug> <module>` topic of the same name.
        if (isRootModule(path) && selectedPaths.includes(entry.command)) {
          this.warn(`Skipped root endpoint "${entry.command}": a module with the same name is being registered.`)
          continue
        }

        commands.push(entry.command, ...entry.aliases)
        this.log(`  registered: ${this.config.bin} ${slug}${isRootModule(path) ? '' : ` ${path}`} ${entry.command}`)
      }

      selectedModules.push({commands: [...new Set(commands)], name: isRootModule(path) ? 'Root endpoints' : index.module.name, path})
    }

    // 1.x saved contracts and generated command files; they would only be stale now
    await rm(collectionModulesDir(slug), {force: true, recursive: true})
    await rm(join(this.config.root, 'dist', 'commands', slug), {force: true, recursive: true})

    await mkdir(configDir(), {recursive: true})
    // Keeps what the collection already holds (saved API keys): only the registered modules are replaced
    const savedConfig = await readSavedConfig()
    const existing = savedConfig.collections.find((collection) => collection.slug === slug)
    const collectionConfig: CollectionConfig = {
      ...existing,
      api,
      slug,
      modules: selectedModules,
      name: listResponse.collection.name,
      updatedAt: new Date().toISOString(),
    }

    savedConfig.collections = [...savedConfig.collections.filter((collection) => collection.slug !== slug), collectionConfig]

    await writeSavedConfig(savedConfig)

    this.log(`\nRegistered ${selectedModules.length} module(s) for "${slug}". Config saved to ${configPath()}`)

    if (!flags['no-alias']) await announceShim((message) => this.log(message), (message) => this.warn(message), this.config.bin, slug)
  }
}
