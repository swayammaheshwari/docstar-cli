import type {EndpointContract, IndexEntry} from './types.js'

import {apiKeyRowsOf, endpointNeeds} from './http.js'
import {isRootModule} from './paths.js'

export type FlagSpec = {description: string; name: string}

const API_KEY_FLAG_DESCRIPTION = 'Your API key (or save it with `config set`)'

// A credential header's flag says what it is; the value is never shown in help
const headerFlagDescription = (endpoint: EndpointContract, name: string, signInHeader: null | string): string => {
  const {apiKeys, signIn} = endpointNeeds(endpoint, signInHeader)
  if (apiKeys.some((key) => key.toLowerCase() === name.toLowerCase())) return API_KEY_FLAG_DESCRIPTION
  if (signIn && signInHeader && name.toLowerCase() === signInHeader.toLowerCase()) return `Sent from your sign-in (\`docstar-cli login\`); a value here replaces it`
  return 'Header value'
}

// Header names configured in the docs editor (e.g. `authkey`) aren't part of `cli.parameters`, so without a flag they can
// never be overridden from the CLI and requests are stuck with whatever placeholder is in the docs. Skips any name that's
// already a parameter flag (its value already reaches `buildHeaders` via `params[key]`) or isn't a valid flag name.
const headerFlagNames = (endpoint: EndpointContract): string[] => {
  const paramNames = new Set([...endpoint.cli.parameters.optional, ...endpoint.cli.parameters.required])
  return Object.keys(endpoint.headers || {}).filter((name) => /^[A-Za-z][\w-]*$/.test(name) && !paramNames.has(name))
}

// An API key marked on a query param needn't be a documented parameter, yet `credentialNote` tells the user to pass it as
// `--<name>`: give it a flag too (header keys already have one above)
const queryKeyFlagNames = (endpoint: EndpointContract): string[] => {
  const taken = new Set(
    [...endpoint.cli.parameters.optional, ...endpoint.cli.parameters.required, ...headerFlagNames(endpoint)].map((name) => name.toLowerCase()),
  )
  return apiKeyRowsOf(endpoint)
    .filter((row) => row.in === 'query' && /^[A-Za-z][\w-]*$/.test(row.name) && !taken.has(row.name.toLowerCase()))
    .map((row) => row.name)
}

// The shape a body field takes, read from the docs' JSON body template (`--payload` is a JSON object, `--ids` a list)
const shapeOf = (endpoint: EndpointContract, name: string): string => {
  const raw = endpoint.body?.type === 'JSON' ? endpoint.body?.raw?.value : undefined
  if (typeof raw !== 'string') return ''
  let template: unknown
  try {
    template = JSON.parse(raw)
  } catch {
    return ''
  }

  const value = (template as null | Record<string, unknown>)?.[name]
  if (Array.isArray(value)) return ' (a list: JSON array or comma-separated)'
  if (value !== null && typeof value === 'object') return ' (a JSON object, e.g. \'{"key":"value"}\')'
  if (typeof value === 'boolean') return ' (true or false)'
  if (typeof value === 'number') return ' (a number)'
  return ''
}

// `content_type` and `content-type` differ by one character: a body field and an HTTP header. Each one's help names the other.
const squash = (name: string): string => name.toLowerCase().replaceAll(/[_-]/g, '')

const lookalikeOf = (endpoint: EndpointContract, name: string, among: 'headers' | 'params'): string | undefined =>
  (among === 'headers' ? headerFlagNames(endpoint) : [...endpoint.cli.parameters.required, ...endpoint.cli.parameters.optional]).find(
    (other) => other !== name && squash(other) === squash(name),
  )

const paramSpec = (endpoint: EndpointContract, name: string, kind: string): FlagSpec => {
  const twin = lookalikeOf(endpoint, name, 'headers')
  return {description: `${kind} parameter${shapeOf(endpoint, name)}${twin ? `; a body field, not the \`--${twin}\` header` : ''}`, name}
}

// Every flag an endpoint command takes: its parameters, then the header and API-key flags
export const flagSpecsOf = (endpoint: EndpointContract, signInHeader: null | string): FlagSpec[] => [
  ...endpoint.cli.parameters.required.map((name) => paramSpec(endpoint, name, 'Required')),
  ...endpoint.cli.parameters.optional.map((name) => paramSpec(endpoint, name, 'Optional')),
  ...headerFlagNames(endpoint).map((name) => ({
    description: `${headerFlagDescription(endpoint, name, signInHeader)}${lookalikeOf(endpoint, name, 'params') ? `; the HTTP header, not the \`--${lookalikeOf(endpoint, name, 'params')}\` body field` : ''}`,
    name,
  })),
  ...queryKeyFlagNames(endpoint).map((name) => ({description: API_KEY_FLAG_DESCRIPTION, name})),
]

// What `--help` says the command needs to authenticate, so nobody has to guess
export const credentialNote = (slug: string, endpoint: EndpointContract, signInHeader: null | string): string => {
  const {apiKeys, signIn} = endpointNeeds(endpoint, signInHeader)
  return [
    ...apiKeys.map((name) => `Needs your ${slug} API key "${name}": --${name} <key>, or save it once with docstar-cli config set ${slug} ${name} <key>`),
    ...(signIn ? [`Runs on your sign-in: docstar-cli login ${slug}`] : []),
  ].join('\n')
}

// The command as the user types it: `msg91 sms send-sms`, or `msg91 ping` for a root endpoint
export const commandLineOf = (bin: string, slug: string, modulePathSegment: string, commandName: string): string =>
  [bin, slug, ...(isRootModule(modulePathSegment) ? [] : [modulePathSegment]), commandName].join(' ')

// One call to copy: the required flags, a body field shown with the docs' own example value
const exampleCall = (bin: string, slug: string, modulePathSegment: string, endpoint: EndpointContract): string => {
  let template: Record<string, unknown> = {}
  try {
    const parsed = endpoint.body?.type === 'JSON' ? JSON.parse(endpoint.body?.raw?.value ?? '') : {}
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) template = parsed
  } catch {
    // no usable example body
  }

  const valueOf = (name: string): string => {
    const value = template[name]
    if (value === undefined) return `<${name}>`
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /^[\w.@:/-]+$/.test(text) ? text : `'${text.replaceAll("'", String.raw`'\''`)}'`
  }

  return [commandLineOf(bin, slug, modulePathSegment, endpoint.cli.command.name), ...endpoint.cli.parameters.required.map((name) => `--${name} ${valueOf(name)}`)].join(' ')
}

// `--help` for one endpoint command
export const endpointHelp = (bin: string, slug: string, modulePathSegment: string, endpoint: EndpointContract, signInHeader: null | string): string[] => {
  const {cli} = endpoint
  const note = credentialNote(slug, endpoint, signInHeader)
  const flags = flagSpecsOf(endpoint, signInHeader)
  const aliases = cli.command.aliases.filter((alias) => alias !== cli.command.name)
  return [
    cli.description || `${cli.name} (${isRootModule(modulePathSegment) ? slug : `${slug} ${modulePathSegment}`})`,
    ...(note ? ['', note] : []),
    '',
    'USAGE',
    `  $ ${commandLineOf(bin, slug, modulePathSegment, cli.command.name)} [flags]`,
    ...(aliases.length > 0 ? ['', `ALIASES: ${aliases.join(', ')}`] : []),
    '',
    'FLAGS',
    ...flags.map((flag) => `  --${flag.name}=<value>  ${flag.description}`),
    '  -h, --help  Show this help',
    '',
    'EXAMPLE',
    `  $ ${exampleCall(bin, slug, modulePathSegment, endpoint)}`,
  ]
}

// What an index entry needs to authenticate: the API keys the owner marked, and whether it sends the sign-in header. (A header
// row with no value is only known once the endpoint is read, so it is asked for when the command runs.)
export const entryNeeds = (entry: IndexEntry, signInHeader: null | string): {apiKeys: string[]; signIn: boolean} => {
  const apiKeys = entry.credentials.map((row) => row.name)
  const signIn =
    signInHeader !== null &&
    entry.headers.some((name) => name.toLowerCase() === signInHeader.toLowerCase()) &&
    !apiKeys.some((name) => name.toLowerCase() === signInHeader.toLowerCase())
  return {apiKeys, signIn}
}

// The note under a command's description for what it needs from the user, from an index entry (`list`, MCP tool descriptions)
export const entryCredentialNote = (slug: string, entry: IndexEntry, signInHeader: null | string): string => {
  const {apiKeys, signIn} = entryNeeds(entry, signInHeader)
  return [
    ...apiKeys.map((name) => `Needs your ${slug} API key "${name}": --${name} <key>, or save it once with docstar-cli config set ${slug} ${name} <key>`),
    ...(signIn ? [`Runs on your sign-in: docstar-cli login ${slug}`] : []),
  ].join('\n')
}

// One endpoint in a listing: name, description, method, parameters and what it needs to authenticate
export const entrySummary = (entry: IndexEntry, signInHeader: null | string): string[] => {
  const aliases = entry.aliases.filter((alias) => alias !== entry.command)
  const {apiKeys, signIn} = entryNeeds(entry, signInHeader)
  const needs = [...apiKeys.map((name) => `API key "${name}"`), ...(signIn ? ['sign-in (docstar-cli login)'] : [])]
  return [
    `${entry.command}${aliases.length > 0 ? ` (aliases: ${aliases.join(', ')})` : ''}`,
    ...(entry.description ? [`  ${entry.description}`] : []),
    `  ${entry.method}`,
    ...(entry.parameters.required.length > 0 ? [`  required: ${entry.parameters.required.join(', ')}`] : []),
    ...(entry.parameters.optional.length > 0 ? [`  optional: ${entry.parameters.optional.join(', ')}`] : []),
    ...(needs.length > 0 ? [`  needs: ${needs.join(', ')}`] : []),
    '',
  ]
}
