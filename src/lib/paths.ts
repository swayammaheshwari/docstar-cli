import {homedir} from 'node:os'
import {join} from 'node:path'

export const configDir = (): string => join(homedir(), '.docstar')
export const configPath = (): string => join(configDir(), 'config.json')
export const modulesDir = (): string => join(configDir(), 'modules')
export const collectionModulesDir = (slug: string): string => join(modulesDir(), slug)
export const modulePath = (slug: string, modulePathSegment: string): string => join(collectionModulesDir(slug), `${modulePathSegment}.json`)
