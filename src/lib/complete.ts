import {readFile} from 'node:fs/promises'
import {loadModule} from './http.js'
import {configPath} from './paths.js'
import type {SavedConfig} from './types.js'

const readSavedConfig = async (): Promise<SavedConfig> => {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8')) as SavedConfig
  } catch {
    return {collections: []}
  }
}

// Suggestions for shell completion — intentionally scoped to module names (given a collection)
// and endpoint command names/aliases (given a collection + module). Never suggests collection
// names or top-level commands (list/init/mcp/...); the user is expected to type the collection
// themselves.
export const completeModules = async (cliName: string): Promise<string[]> => {
  const savedConfig = await readSavedConfig()
  const collection = savedConfig.collections.find((c) => c.cliName === cliName)
  return collection ? collection.modules.map((module) => module.path) : []
}

export const completeEndpoints = async (cliName: string, modulePathSegment: string): Promise<string[]> => {
  try {
    const moduleJson = await loadModule(cliName, modulePathSegment)
    const names = moduleJson.endpoints.flatMap((endpoint) => [endpoint.cli.command.name, ...endpoint.cli.command.aliases])
    return [...new Set(names)]
  } catch {
    return []
  }
}
