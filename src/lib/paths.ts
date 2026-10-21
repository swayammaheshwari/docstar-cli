import {homedir} from 'node:os'
import {join} from 'node:path'

export const configDir = (): string => join(homedir(), '.docstar')
export const configPath = (): string => join(configDir(), 'config.json')
export const modulesDir = (): string => join(configDir(), 'modules')
export const collectionModulesDir = (slug: string): string => join(modulesDir(), slug)
export const modulePath = (slug: string, modulePathSegment: string): string => join(collectionModulesDir(slug), `${modulePathSegment}.json`)

// Endpoints at the collection root (outside every module) are stored as a pseudo-module under this key so they share
// the module.json plumbing; unlike real modules their commands live directly under the collection: `<collection> <endpoint>`.
export const ROOT_MODULE_PATH = '__root__'
export const isRootModule = (modulePathSegment: string): boolean => modulePathSegment === ROOT_MODULE_PATH
