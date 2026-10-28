import {homedir} from 'node:os'
import {join} from 'node:path'

export const configDir = (): string => join(homedir(), '.docstar')
export const configPath = (): string => join(configDir(), 'config.json')
// Sign-ins (`docstar-cli login`): the user's tokens per collection, kept apart from config.json and readable by the owner only
export const credentialsPath = (): string => join(configDir(), 'credentials.json')
// Sign-ins started with `login --no-wait`, finished by `login --continue`
export const pendingSignInsPath = (): string => join(configDir(), 'pending-sign-ins.json')
// Contracts are no longer saved (they're fetched on every call); 1.x saved them here, and `init`/`clean` remove what's left
export const collectionModulesDir = (slug: string): string => join(configDir(), 'modules', slug)

// Endpoints at the collection root (outside every module) are stored as a pseudo-module under this key so they share
// the module.json plumbing; unlike real modules their commands live directly under the collection: `<collection> <endpoint>`.
export const ROOT_MODULE_PATH = '__root__'
export const isRootModule = (modulePathSegment: string): boolean => modulePathSegment === ROOT_MODULE_PATH
