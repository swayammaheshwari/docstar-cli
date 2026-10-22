import {checkbox} from '@inquirer/prompts'
import {parseSavedConfig} from '../lib/config.js'
import {Args, Command, Flags} from '@oclif/core'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {generateCommandFile} from '../lib/codegen.js'
import {configDir, configPath, isRootModule, modulePath, ROOT_MODULE_PATH} from '../lib/paths.js'
import type {CollectionConfig, CollectionSummary, ModuleJson, ModuleSummary, RootEndpointSummary, SavedConfig} from '../lib/types.js'

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

// Docs are normally served at <base>/p/..., but a site hosted under a sub-path (e.g. giddh.com/api) serves them at <base>/...
const candidateUrls = (baseUrl: string, path: string, params: Record<string, string | undefined> = {}): string[] =>
  ['/p', ''].map((prefix) => {
    const url = new URL(`${baseUrl}${prefix}${path}`)
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value)
    }

    return url.toString()
  })

const fetchFirstJson = async <T>(urls: string[]): Promise<{data: T; url: string}> => {
  const failures: string[] = []
  for (const url of urls) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return {data: await fetchJson<T>(url), url}
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  throw new Error(
    [
      'Could not find the DocStar docs. Tried:',
      ...failures.map((failure) => `  ${failure}`),
      'If the docs live under a sub-path, include it, e.g. docstar-cli init giddh.com/api',
    ].join('\n'),
  )
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
    '<%= config.bin %> <%= command.id %> giddh.com/api',
    '<%= config.bin %> <%= command.id %> localhost:3000 --collectionId paM4R4A26Hvb',
  ]
  static override flags = {
    collectionId: Flags.string({description: 'Collection id (required when the domain is not a custom domain, e.g. localhost)'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Init)

    const baseUrl = buildBaseUrl(args.domain)
    this.log(`Fetching modules from ${baseUrl} ...`)

    const {data: listResponse, url: listUrl} = await fetchFirstJson<{collection?: CollectionSummary; modules: ModuleSummary[]; rootEndpoints?: RootEndpointSummary[]}>(
      candidateUrls(baseUrl, '/module.json', {collectionId: flags.collectionId}),
    ).catch((error: Error) => this.error(error.message))

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
    // modules live under the same layout as the module list
    const usesPrefix = new URL(listUrl).pathname.endsWith('/p/module.json')

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
      message: `Select modules to install for "${slug}" (space to toggle, enter to confirm)`,
    })

    const selectedPaths = rawSelection.includes(SELECT_ALL) ? [...(rootEndpoints.length > 0 ? [ROOT_MODULE_PATH] : []), ...modules.map((module) => module.path)] : rawSelection

    if (selectedPaths.length === 0) {
      this.log('No modules selected, nothing installed.')
      return
    }

    await mkdir(configDir(), {recursive: true})

    const selectedModules: ModuleSummary[] = []

    for (const path of selectedPaths) {
      this.log(`Fetching ${path} ...`)
      // eslint-disable-next-line no-await-in-loop
      const {data: moduleJson} = await fetchFirstJson<ModuleJson>(
        candidateUrls(
          baseUrl,
          isRootModule(path) ? '/module.json' : `/${path}/module.json`,
          {collectionId: flags.collectionId, scope: isRootModule(path) ? 'root' : undefined},
        ).filter((url) => new URL(url).pathname.includes('/p/') === usesPrefix),
      ).catch((error: Error) => this.error(error.message))

      // eslint-disable-next-line no-await-in-loop
      await mkdir(configDir() + `/modules/${slug}`, {recursive: true})
      // eslint-disable-next-line no-await-in-loop
      await writeFile(modulePath(slug, path), JSON.stringify(moduleJson, null, 2))

      for (const endpoint of moduleJson.endpoints) {
        // A root command `<slug> <endpoint>` would shadow a module's `<slug> <module>` topic of the same name.
        if (isRootModule(path) && selectedPaths.includes(endpoint.cli.command.name)) {
          this.warn(`Skipped root endpoint "${endpoint.cli.command.name}": a module with the same name is being installed.`)
          continue
        }

        // eslint-disable-next-line no-await-in-loop
        await generateCommandFile(this.config.root, slug, path, endpoint)
        this.log(`  registered command: ${this.config.bin} ${slug}${isRootModule(path) ? '' : ` ${path}`} ${endpoint.cli.command.name}`)
      }

      selectedModules.push({name: isRootModule(path) ? 'Root endpoints' : moduleJson.module.name, path})
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
