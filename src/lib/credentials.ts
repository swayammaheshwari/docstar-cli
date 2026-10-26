import {chmod, readFile, writeFile} from 'node:fs/promises'

import type {CollectionConfig, CredentialMeta, SavedConfig} from './types.js'

import {parseSavedConfig} from './config.js'
import {configPath} from './paths.js'

// Names a credential can have: a header or param name of the endpoints (authkey, Authorization, X-Api-Key)
export const CREDENTIAL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
// The scheme in front of a key in a header, e.g. `Bearer`
export const PREFIX_PATTERN = /^[A-Za-z]{1,20}$/

export const maskKey = (value: string): string => `…${value.slice(-4)}`

const readSavedConfig = async (): Promise<SavedConfig> => {
  try {
    return parseSavedConfig(await readFile(configPath(), 'utf8'))
  } catch {
    throw new Error('No installed modules found. Run `docstar-cli init <slug>` first.')
  }
}

// The config holds credentials, so it is readable by its owner only
export const writeSavedConfig = async (savedConfig: SavedConfig): Promise<void> => {
  await writeFile(configPath(), JSON.stringify(savedConfig, null, 2), {mode: 0o600})
  await chmod(configPath(), 0o600)
}

const findCollection = (savedConfig: SavedConfig, slug: string): CollectionConfig => {
  const collection = savedConfig.collections.find((candidate) => candidate.slug === slug)
  if (!collection) throw new Error(`Collection "${slug}" isn't installed. Run \`docstar-cli init ${slug}\` first.`)
  return collection
}

// Saves a credential under its collection. Returns whether one with that name was already there (and so replaced).
export const storeCredential = async (slug: string, name: string, value: string, meta: CredentialMeta = {}): Promise<boolean> => {
  const savedConfig = await readSavedConfig()
  const collection = findCollection(savedConfig, slug)
  const replaced = collection.credentials !== undefined && name in collection.credentials
  collection.credentials = {...collection.credentials, [name]: value}
  const otherMeta = {...collection.credentialMeta}
  delete otherMeta[name]
  collection.credentialMeta = Object.keys(meta).length > 0 ? {...otherMeta, [name]: meta} : otherMeta
  await writeSavedConfig(savedConfig)
  return replaced
}

export const readCredential = async (slug: string, name: string): Promise<{meta: CredentialMeta; value: string}> => {
  const collection = findCollection(await readSavedConfig(), slug)
  const value = collection.credentials?.[name]
  if (value === undefined) throw new Error(`No credential named "${name}" saved for collection "${slug}".`)
  return {meta: collection.credentialMeta?.[name] ?? {}, value}
}

// What requests send: the saved value, with its scheme in front when `key save` stored one (Authorization: Bearer <key>)
export const sendableCredentials = (collection: CollectionConfig | undefined): Record<string, string> =>
  Object.fromEntries(
    Object.entries(collection?.credentials ?? {}).map(([name, value]) => {
      const prefix = collection?.credentialMeta?.[name]?.prefix
      return [name, prefix ? `${prefix} ${value}` : value]
    }),
  )
