import type {CliCommandMeta, EndpointContract} from './types.js'

// Names come from a rich-text editor and may be wrapped in `<span text-block="true">...</span>` markup
const stripHtml = (value: string): string => value.replaceAll(/<[^>]*>/g, '')

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')

// Path variables and params are stored either keyed by name ({orgId: {...}}) or by position
// ({"0": {key: "orgId", ...}}) — the entry's own `key` is the real name when it has one.
type Entry = {key?: string; required?: boolean}

const entryNames = (entries: null | Record<string, unknown> | undefined, onlyRequired?: boolean): string[] =>
  Object.entries(entries || {})
    .map(([name, value]) => [name, (value && typeof value === 'object' ? value : {}) as Entry] as const)
    .filter(([, entry]) => onlyRequired === undefined || Boolean(entry.required) === onlyRequired)
    .map(([name, entry]) => stripHtml(entry.key || name).trim())
    .filter(Boolean)

// Top-level keys of a JSON body's example (`body.raw.value`), the only body the CLI sends
const jsonBodyKeys = (body: undefined | {raw?: {value?: string}; type?: string}): string[] => {
  if (body?.type !== 'JSON' || !body?.raw?.value) return []
  try {
    const parsed = JSON.parse(body.raw.value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : []
  } catch {
    return []
  }
}

// The command an endpoint is installed as. Older docs sites send it as `cli`; newer ones don't, and it's
// built from the endpoint itself: the command is named after the endpoint's path, path variables, required
// query params and JSON body fields are required flags, other query params optional ones.
export const cliOf = (endpoint: EndpointContract): CliCommandMeta => {
  if (endpoint.cli) return endpoint.cli

  const lastPathSegment = endpoint.path?.replace(/\/+$/, '').split('/').at(-1)
  const name = slugify(lastPathSegment || endpoint.name || '') || 'endpoint'
  const required = [...entryNames(endpoint.pathVariables), ...entryNames(endpoint.params, true), ...jsonBodyKeys(endpoint.body)]
  const optional = entryNames(endpoint.params, false)

  return {
    command: {aliases: [name], name},
    description: endpoint.description || endpoint.summary || endpoint.name || '',
    name,
    parameters: {optional: [...new Set(optional)].filter((key) => !required.includes(key)), required: [...new Set(required)]},
    version: 1,
  }
}
