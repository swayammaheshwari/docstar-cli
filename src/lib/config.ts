import type {SavedConfig} from './types.js'

// Configs saved before collections had a slug identify them by `cliName`; read those as `slug`.
export const parseSavedConfig = (raw: string): SavedConfig => {
  const savedConfig = JSON.parse(raw) as SavedConfig
  savedConfig.collections = (savedConfig.collections || []).map((collection) => {
    const {cliName, ...rest} = collection as typeof collection & {cliName?: string}
    return {...rest, slug: rest.slug || cliName || ''}
  })
  return savedConfig
}
