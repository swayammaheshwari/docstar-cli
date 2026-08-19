import {homedir} from 'node:os'
import {join} from 'node:path'

export const configDir = (): string => join(homedir(), '.docstar')
export const configPath = (): string => join(configDir(), 'config.json')
export const modulesDir = (): string => join(configDir(), 'modules')
export const modulePath = (modulePathSegment: string): string => join(modulesDir(), `${modulePathSegment}.json`)
