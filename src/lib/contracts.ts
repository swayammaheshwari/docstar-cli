import {readFile} from 'node:fs/promises'

import type {CollectionConfig, CollectionListResponse, EndpointResponse, IndexEntry, ModuleIndex} from './types.js'

import {apiUrlOf} from './auth.js'
import {parseSavedConfig} from './config.js'
import {configPath, isRootModule} from './paths.js'

// Both the module list and a module's contract come from one route, told apart by its query. Contracts are never saved:
// every command reads the docs as they are now.
export const contractUrl = (api: string, slug: string, query: Record<string, string> = {}): string => {
  const url = new URL(`${api.replace(/\/$/, '')}/p/generate-module-json`)
  url.searchParams.set('slug', slug)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return url.toString()
}

export class ContractNotFoundError extends Error {}

// A 404 from the API says which thing is missing in its `error` ("Collection not found" / "Module not found")
const fetchJson = async <T>(url: string, notFound: {collection: string; other: string}): Promise<T> => {
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    throw new Error(`Couldn't reach ${new URL(url).origin}: ${(error as Error).message}`)
  }

  if (response.status === 404) {
    const body = (await response.json().catch(() => ({}))) as {error?: string}
    throw new ContractNotFoundError(/collection/i.test(body.error || '') ? notFound.collection : notFound.other)
  }

  if (!response.ok) throw new Error(`Request to ${url} failed (${response.status} ${response.statusText})`)
  return (await response.json()) as T
}

// What `init` registered for the collection, if anything
export const registeredCollection = async (slug: string): Promise<CollectionConfig | undefined> => {
  try {
    return parseSavedConfig(await readFile(configPath(), 'utf8')).collections.find((collection) => collection.slug === slug)
  } catch {
    return undefined
  }
}

// The DocStar API a collection's docs are read from: $DOCSTAR_API_URL, else the one `init --api` registered, else the default
export const apiOfCollection = async (slug: string): Promise<string> => {
  return apiUrlOf(undefined, (await registeredCollection(slug))?.api)
}

export const fetchCollection = async (slug: string, api?: string): Promise<CollectionListResponse> => {
  const base = api ?? (await apiOfCollection(slug))
  const missing = `No collection "${slug}" found on ${base}`
  return fetchJson<CollectionListResponse>(contractUrl(base, slug), {collection: missing, other: missing})
}

// A module's index: its endpoints' commands and parameters, and the link to each one's OpenAPI file. ROOT_MODULE_PATH
// gets the endpoints at the collection root.
export const fetchModuleIndex = async (slug: string, moduleSegment: string, api?: string): Promise<ModuleIndex> => {
  const base = api ?? (await apiOfCollection(slug))
  const query: Record<string, string> = isRootModule(moduleSegment) ? {scope: 'root'} : {path: moduleSegment}
  return fetchJson<ModuleIndex>(contractUrl(base, slug, query), {
    collection: `No collection "${slug}" found on ${base}`,
    other: `No module "${moduleSegment}" found in collection "${slug}"`,
  })
}

export const findEntry = (index: ModuleIndex, commandName: string): IndexEntry | undefined =>
  index.endpoints.find((entry) => entry.command === commandName || entry.aliases.includes(commandName))

// One endpoint's full contract: `path=<module>/<command>` (`path=<command>` for an endpoint at the collection root). The
// server finds the endpoint by its page path or by the command name or alias typed, so no index is read first. Resolves to the
// endpoint as the request is built from, and the collection's sign-in header (`auth`).
export const fetchEndpoint = async (slug: string, moduleSegment: string, commandName: string, api?: string): Promise<EndpointResponse> => {
  const base = api ?? (await apiOfCollection(slug))
  const where = isRootModule(moduleSegment) ? `"${commandName}" in collection "${slug}"` : `"${commandName}" in module "${slug} ${moduleSegment}"`
  const response = await fetchJson<Partial<EndpointResponse>>(contractUrl(base, slug, {path: isRootModule(moduleSegment) ? commandName : `${moduleSegment}/${commandName}`}), {
    collection: `No collection "${slug}" found on ${base}`,
    other: `No endpoint ${where}`,
  })
  // A root endpoint's name that is also a module's gets the module's index: not an endpoint
  if (!response.endpoint) throw new ContractNotFoundError(`No endpoint ${where}`)
  return response as EndpointResponse
}
