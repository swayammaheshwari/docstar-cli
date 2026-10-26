import type {SavedConfig} from './types.js'

// The DocStar API a collection's docs are read from, unless `--api` says otherwise (a local or dev API)
export const DEFAULT_API = 'https://api.docstar.io'

// Configs saved before collections had a slug identify them by `cliName`; read those as `slug`.
export const parseSavedConfig = (raw: string): SavedConfig => {
  const savedConfig = JSON.parse(raw) as SavedConfig
  savedConfig.collections = (savedConfig.collections || []).map((collection) => {
    const {cliName, ...rest} = collection as typeof collection & {cliName?: string}
    return {...rest, slug: rest.slug || cliName || ''}
  })
  return savedConfig
}
