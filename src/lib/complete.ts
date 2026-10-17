import {readFile} from 'node:fs/promises'
import {cliOf} from './cli-meta.js'
import {parseSavedConfig} from './config.js'
import {loadModule} from './http.js'
import {configPath} from './paths.js'
import type {SavedConfig} from './types.js'

const readSavedConfig = async (): Promise<SavedConfig> => {
  try {
    return parseSavedConfig(await readFile(configPath(), 'utf8'))
  } catch {
    return {collections: []}
  }
}

// Suggestions for shell completion — intentionally scoped to module names (given a collection)
// and endpoint command names/aliases (given a collection + module). Never suggests collection
// names or top-level commands (list/init/mcp/...); the user is expected to type the collection
// themselves.
export const completeModules = async (slug: string): Promise<string[]> => {
  const savedConfig = await readSavedConfig()
  const collection = savedConfig.collections.find((c) => c.slug === slug)
  return collection ? collection.modules.map((module) => module.path) : []
}

export const completeEndpoints = async (slug: string, modulePathSegment: string): Promise<string[]> => {
  try {
    const moduleJson = await loadModule(slug, modulePathSegment)
    const names = moduleJson.endpoints.flatMap((endpoint) => [cliOf(endpoint).command.name, ...cliOf(endpoint).command.aliases])
    return [...new Set(names)]
  } catch {
    return []
  }
}
