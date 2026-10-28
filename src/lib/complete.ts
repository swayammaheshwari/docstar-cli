import {registeredCollection} from './contracts.js'
import {isRootModule} from './paths.js'

// Suggestions for shell completion — intentionally scoped to module names (given a collection)
// and endpoint command names/aliases (given a collection + module). Never suggests collection
// names or top-level commands (list/init/mcp/...); the user is expected to type the collection
// themselves. Only what `init` registered is offered: completion never calls the network.
export const completeModules = async (slug: string): Promise<string[]> => {
  const collection = await registeredCollection(slug)
  return collection ? collection.modules.map((module) => module.path).filter((path) => !isRootModule(path)) : []
}

export const completeEndpoints = async (slug: string, modulePathSegment: string): Promise<string[]> => {
  const collection = await registeredCollection(slug)
  return collection?.modules.find((module) => module.path === modulePathSegment)?.commands ?? []
}
