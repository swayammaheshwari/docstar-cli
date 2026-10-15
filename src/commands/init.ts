import {checkbox} from '@inquirer/prompts'
import {parseSavedConfig} from '../lib/config.js'
import {Args, Command, Flags} from '@oclif/core'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {generateCommandFile} from '../lib/codegen.js'
import {configDir, configPath, modulePath} from '../lib/paths.js'
import type {CollectionConfig, CollectionSummary, ModuleJson, ModuleSummary, SavedConfig} from '../lib/types.js'

const buildBaseUrl = (domain: string): string => {
  if (domain.startsWith('http://') || domain.startsWith('https://')) return domain.replace(/\/$/, '')
  const isLocal = domain.includes('localhost') || domain.includes('127.0.0.1')
  return `${isLocal ? 'http' : 'https'}://${domain}`
}

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Request to ${url} failed (${response.status} ${response.statusText})`)
  return (await response.json()) as T
}

const readSavedConfig = async (): Promise<SavedConfig> => {
  try {
    return parseSavedConfig(await readFile(configPath(), 'utf8'))
  } catch {
    return {collections: []}
  }
}

export default class Init extends Command {
  static override args = {
    domain: Args.string({description: 'DocStar docs domain, e.g. docs.msg91.com or localhost:3000', required: true}),
  }
  static override description = [
    'Discover published modules for a DocStar docs site, pick which ones to install, and register their CLI commands.',
    'You can run this against multiple docs sites/collections — each is kept separate under its own slug (`docstar-cli <slug> <module> <command>`).',
    'After installing, run `docstar-cli list` to see what got installed.',
  ].join('\n')
  static override examples = [
    '<%= config.bin %> <%= command.id %> docs.msg91.com',
    '<%= config.bin %> <%= command.id %> localhost:3000 --collectionId paM4R4A26Hvb',
  ]
  static override flags = {
    collectionId: Flags.string({description: 'Collection id (required when the domain is not a custom domain, e.g. localhost)'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Init)

    const baseUrl = buildBaseUrl(args.domain)
    const listUrl = new URL('/p/module.json', baseUrl)
    if (flags.collectionId) listUrl.searchParams.set('collectionId', flags.collectionId)

    this.log(`Fetching modules from ${listUrl.toString()} ...`)

    const listResponse = await fetchJson<{collection?: CollectionSummary; modules: ModuleSummary[]}>(listUrl.toString())

    if (!listResponse.collection?.slug) {
      this.error('The docs site did not return a slug for this collection. Please update hitman-api/hitman-ui.')
    }

    if (!listResponse.modules || listResponse.modules.length === 0) {
      this.log('No published modules found.')
      return
    }

    const {slug} = listResponse.collection

    const SELECT_ALL = '__select_all__'

    const rawSelection = await checkbox({
      choices: [
        ...listResponse.modules.map((module) => {
          const count = module.endpointCount ?? module.endpoints?.length ?? 0
          return {
            checked: false,
            name: `${module.name} (${module.path}) — ${count} endpoint${count === 1 ? '' : 's'}`,
            value: module.path,
          }
        }),
        {checked: false, name: '➤ Select all modules', value: SELECT_ALL},
      ],
      message: `Select modules to install for "${slug}" (space to toggle, enter to confirm)`,
    })

    const selectedPaths = rawSelection.includes(SELECT_ALL) ? listResponse.modules.map((module) => module.path) : rawSelection

    if (selectedPaths.length === 0) {
      this.log('No modules selected, nothing installed.')
      return
    }

    await mkdir(configDir(), {recursive: true})

    const selectedModules: ModuleSummary[] = []

    for (const path of selectedPaths) {
      const moduleUrl = new URL(`/p/${path}/module.json`, baseUrl)
      if (flags.collectionId) moduleUrl.searchParams.set('collectionId', flags.collectionId)

      this.log(`Fetching ${path} ...`)
      // eslint-disable-next-line no-await-in-loop
      const moduleJson = await fetchJson<ModuleJson>(moduleUrl.toString())

      // eslint-disable-next-line no-await-in-loop
      await mkdir(configDir() + `/modules/${slug}`, {recursive: true})
      // eslint-disable-next-line no-await-in-loop
      await writeFile(modulePath(slug, path), JSON.stringify(moduleJson, null, 2))

      for (const endpoint of moduleJson.endpoints) {
        // eslint-disable-next-line no-await-in-loop
        await generateCommandFile(this.config.root, slug, path, endpoint)
        this.log(`  registered command: ${this.config.bin} ${slug} ${path} ${endpoint.cli.command.name}`)
      }

      selectedModules.push({name: moduleJson.module.name, path})
    }

    const collectionConfig: CollectionConfig = {
      baseUrl,
      slug,
      collectionId: flags.collectionId ?? null,
      domain: args.domain,
      modules: selectedModules,
      name: listResponse.collection.name,
      updatedAt: new Date().toISOString(),
    }

    const savedConfig = await readSavedConfig()
    const otherCollections = savedConfig.collections.filter((collection) => collection.slug !== slug)
    savedConfig.collections = [...otherCollections, collectionConfig]

    await writeFile(configPath(), JSON.stringify(savedConfig, null, 2))

    this.log(`\nInstalled ${selectedModules.length} module(s) for "${slug}". Config saved to ${configPath()}`)
  }
}
