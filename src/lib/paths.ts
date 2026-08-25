import {homedir} from 'node:os'
import {join} from 'node:path'

export const configDir = (): string => join(homedir(), '.docstar')
export const configPath = (): string => join(configDir(), 'config.json')
export const modulesDir = (): string => join(configDir(), 'modules')
export const collectionModulesDir = (cliName: string): string => join(modulesDir(), cliName)
export const modulePath = (cliName: string, modulePathSegment: string): string => join(collectionModulesDir(cliName), `${modulePathSegment}.json`)
