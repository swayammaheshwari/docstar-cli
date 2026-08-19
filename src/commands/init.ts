import {checkbox} from '@inquirer/prompts'
import {Args, Command, Flags} from '@oclif/core'
import {mkdir, writeFile} from 'node:fs/promises'
import {generateCommandFile, generateListCommandFile} from '../lib/codegen.js'
import {configDir, configPath, modulePath} from '../lib/paths.js'
import type {ModuleJson, ModuleSummary, SavedConfig} from '../lib/types.js'

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

export default class Init extends Command {
  static override args = {
    domain: Args.string({description: 'DocStar docs domain, e.g. docs.msg91.com or localhost:3000', required: true}),
  }
  static override description = 'Discover published modules for a DocStar docs site, pick which ones to install, and register their CLI commands'
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

    const listResponse = await fetchJson<{collection?: {id: string; name: string}; modules: ModuleSummary[]}>(listUrl.toString())

    if (!listResponse.modules || listResponse.modules.length === 0) {
      this.log('No published modules found.')
      return
    }

    const selectedPaths = await checkbox({
      choices: listResponse.modules.map((module) => ({checked: true, name: `${module.name} (${module.path})`, value: module.path})),
      message: 'Select modules to install (space to toggle, enter to confirm)',
    })

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
      const moduleJson = await fetchJson<ModuleJson>(moduleUrl.toString())

      await mkdir(configDir() + '/modules', {recursive: true})
      await writeFile(modulePath(path), JSON.stringify(moduleJson, null, 2))

      for (const endpoint of moduleJson.endpoints) {
        const filePath = await generateCommandFile(this.config.root, path, endpoint)
        this.log(`  registered command: ${this.config.bin} ${path} ${endpoint.cli.command.name} -> ${filePath}`)
      }

      await generateListCommandFile(this.config.root, path)
      this.log(`  registered command: ${this.config.bin} ${path} list`)

      selectedModules.push({name: moduleJson.module.name, path})
    }

    const savedConfig: SavedConfig = {
      baseUrl,
      collection: listResponse.collection ?? null,
      collectionId: flags.collectionId ?? null,
      domain: args.domain,
      modules: selectedModules,
      updatedAt: new Date().toISOString(),
    }

    await writeFile(configPath(), JSON.stringify(savedConfig, null, 2))

    this.log(`\nInstalled ${selectedModules.length} module(s). Config saved to ${configPath()}`)
  }
}
