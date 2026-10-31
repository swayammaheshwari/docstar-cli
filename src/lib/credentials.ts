import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {CollectionConfig, CredentialMeta, SavedConfig} from './types.js'

import {parseSavedConfig} from './config.js'
import {readEnvFile} from './env-file.js'
import {configDir, configPath} from './paths.js'

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
  await mkdir(configDir(), {recursive: true})
  await writeFile(configPath(), JSON.stringify(savedConfig, null, 2), {mode: 0o600})
  await chmod(configPath(), 0o600)
}

// Saving a key doesn't need `init`: commands run without it, so the collection is made on the spot (with no modules)
const readSavedConfigOrEmpty = async (): Promise<SavedConfig> => {
  try {
    return parseSavedConfig(await readFile(configPath(), 'utf8'))
  } catch {
    return {collections: []}
  }
}

const findCollection = (savedConfig: SavedConfig, slug: string): CollectionConfig => {
  const collection = savedConfig.collections.find((candidate) => candidate.slug === slug)
  if (!collection) throw new Error(`Collection "${slug}" isn't installed. Run \`docstar-cli init ${slug}\` first.`)
  return collection
}

// Saves a credential under its collection. Returns whether one with that name was already there (and so replaced).
export const storeCredential = async (slug: string, name: string, value: string, meta: CredentialMeta = {}): Promise<boolean> => {
  const savedConfig = await readSavedConfigOrEmpty()
  let collection = savedConfig.collections.find((candidate) => candidate.slug === slug)
  if (!collection) {
    collection = {modules: [], name: slug, slug, updatedAt: new Date().toISOString()}
    savedConfig.collections.push(collection)
  }

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
export const sendableCredentials = (collection: CollectionConfig | undefined, env: Record<string, string | undefined> = process.env): Record<string, string> =>
  Object.fromEntries(
    Object.entries(collection?.credentials ?? {}).map(([name, stored]) => {
      const meta = collection?.credentialMeta?.[name]
      // A reference (`config set --env`) holds no value: it is read from the variable now, and left empty (so it counts as
      // missing) when the variable isn't set
      const value = meta?.env ? env[meta.env] ?? '' : stored
      return [name, value && meta?.prefix ? `${meta.prefix} ${value}` : value]
    }),
  )

// The collection's saved credentials as requests send them ({} when nothing is installed or saved)
export const savedCredentialsOf = async (slug: string): Promise<Record<string, string>> => {
  try {
    const savedConfig = parseSavedConfig(await readFile(configPath(), 'utf8'))
    return sendableCredentials(savedConfig.collections.find((collection) => collection.slug === slug), {...(await readEnvFile(join(process.cwd(), '.env'))), ...process.env})
  } catch {
    return {}
  }
}

// A value by name; header names match in any case
export const valueByName = (values: Record<string, string>, name: string, anyCase = true): string | undefined => {
  if (values[name] !== undefined && values[name] !== '') return values[name]
  if (!anyCase) return undefined
  const key = Object.keys(values).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
  return key && values[key] !== '' ? values[key] : undefined
}

// Puts a value in a header (replacing the docs' row in any case)
export const setHeader = (headers: Record<string, string>, name: string, value: string): Record<string, string> => {
  const lower = name.toLowerCase()
  return {...Object.fromEntries(Object.entries(headers).filter(([header]) => header.toLowerCase() !== lower)), [name]: value}
}

// Puts a value in a query param of the URL
export const setQueryParam = (url: string, name: string, value: string): string => {
  try {
    const parsed = new URL(url)
    parsed.searchParams.set(name, value)
    return parsed.toString()
  } catch {
    return `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(name)}=${encodeURIComponent(value)}`
  }
}

// What's missing before a call can be made, written for a person at a terminal and for an AI assistant reading it
export class MissingCredentialError extends Error {
  constructor(
    public readonly slug: string,
    public readonly kind: 'apiKey' | 'signIn',
    public readonly name: string,
    public readonly expired = false,
  ) {
    super(missingMessage(slug, kind, name, expired))
  }
}

const missingMessage = (slug: string, kind: 'apiKey' | 'signIn', name: string, expired: boolean): string => {
  if (kind === 'signIn') {
    return [
      expired ? `Your sign-in to ${slug} has expired.` : `This call needs you to sign in to ${slug}.`,
      `  Sign in, in your terminal:  docstar-cli login ${slug}`,
      `  From an AI assistant:       docstar-cli login ${slug} --no-wait  (open the link, then: docstar-cli login ${slug} --continue)`,
    ].join('\n')
  }

  return [
    `This call needs your ${slug} API key (sent as "${name}"), and none is saved.`,
    `  Save it once, in your own terminal:  docstar-cli config set ${slug} ${name} <your key>`,
    `  Or pass it on this call:            --${name} <your key>`,
    `  Never paste the key into an AI chat.`,
  ].join('\n')
}
