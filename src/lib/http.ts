import {readFile} from 'node:fs/promises'
import {configPath, modulePath} from './paths.js'
import type {EndpointContract, ModuleJson, SavedConfig} from './types.js'

// Endpoint fields come from a rich-text editor and may be wrapped in
// `<span text-block="true">...</span>`-style markup; unwrap to the raw value.
export const stripHtml = (value: string | null | undefined): string => (value ?? '').replaceAll(/<[^>]*>/g, '')

const substitutePlaceholders = (template: string, params: Record<string, string>): string =>
  Object.entries(params).reduce(
    (result, [key, value]) => result.replaceAll(`:${key}`, value).replaceAll(`{${key}}`, value).replaceAll(`{{${key}}}`, value),
    template,
  )

export const loadModule = async (cliName: string, modulePathSegment: string): Promise<ModuleJson> => {
  const raw = await readFile(modulePath(cliName, modulePathSegment), 'utf8')
  return JSON.parse(raw) as ModuleJson
}

// Lets a value like `authkey` be saved once (`docstar-cli config set <cliName> authkey <value>`)
// instead of being passed on every command line; an explicit flag for the same name still wins.
const loadCredentials = async (cliName: string): Promise<Record<string, string>> => {
  try {
    const savedConfig = JSON.parse(await readFile(configPath(), 'utf8')) as SavedConfig
    return savedConfig.collections.find((collection) => collection.cliName === cliName)?.credentials || {}
  } catch {
    return {}
  }
}

export const findEndpoint = (moduleJson: ModuleJson, commandName: string): EndpointContract | undefined =>
  moduleJson.endpoints.find(
    (endpoint) => endpoint.cli.command.name === commandName || endpoint.cli.command.aliases.includes(commandName),
  )

const buildUrl = (endpoint: EndpointContract, params: Record<string, string>): string => {
  const baseUrl = stripHtml(endpoint.baseUrl)
  const path = substitutePlaceholders(stripHtml(endpoint.url), params)
  if (/^https?:\/\//.test(path)) return path
  return `${baseUrl}${path}`
}

const buildHeaders = (endpoint: EndpointContract, params: Record<string, string>): Record<string, string> => {
  // Header names are case-insensitive; the docs editor can end up storing two entries that only
  // differ by case (e.g. "Content-Type" and "content-type"). Sending both as separate header
  // lines has been observed to break body parsing on the receiving server, so dedupe by
  // lowercased name — first entry wins, using its original casing for readability.
  const seenLowerNames = new Set<string>()
  const headers: Record<string, string> = {}

  for (const [rawKey, rawValue] of Object.entries(endpoint.headers || {})) {
    const key = stripHtml(rawKey)
    const lowerKey = key.toLowerCase()
    if (seenLowerNames.has(lowerKey)) continue
    seenLowerNames.add(lowerKey)

    const value = stripHtml((rawValue as any)?.value ?? rawValue)
    headers[key] = params[key] ?? value
  }

  return headers
}

// CLI flag values always arrive as strings, but the JSON body template's existing value for a
// key tells us its real type (boolean/number/array) — coerce back to that shape instead of
// clobbering e.g. `getUrl: true` with the literal string "true", or `collectionIds: []` with a
// plain string.
const coerceToTemplateType = (existingValue: unknown, rawValue: string): unknown => {
  if (typeof existingValue === 'boolean') return rawValue === 'true'
  if (typeof existingValue === 'number') {
    const parsedNumber = Number(rawValue)
    return Number.isNaN(parsedNumber) ? rawValue : parsedNumber
  }

  if (Array.isArray(existingValue)) {
    try {
      const parsed = JSON.parse(rawValue)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // not a JSON array literal — fall through to comma-splitting
    }

    return rawValue.split(',').map((item) => item.trim())
  }

  if (existingValue !== null && typeof existingValue === 'object') {
    try {
      const parsed = JSON.parse(rawValue)
      if (typeof parsed === 'object' && parsed !== null) return parsed
    } catch {
      // not a JSON object literal — fall through to the raw string
    }
  }

  return rawValue
}

const buildBody = (endpoint: EndpointContract, params: Record<string, string>): string | undefined => {
  const rawValue = endpoint.body?.raw?.value
  if (endpoint.body?.type !== 'JSON' || !rawValue) return undefined

  let parsed: Record<string, any>
  try {
    parsed = JSON.parse(rawValue)
  } catch {
    return rawValue
  }

  for (const [key, value] of Object.entries(params)) {
    if (key in parsed) parsed[key] = coerceToTemplateType(parsed[key], value)
  }

  return JSON.stringify(parsed)
}

export const executeCliCommand = async (
  cliName: string,
  modulePathSegment: string,
  commandName: string,
  params: Record<string, string>,
): Promise<{status: number; body: unknown}> => {
  const moduleJson = await loadModule(cliName, modulePathSegment)
  const endpoint = findEndpoint(moduleJson, commandName)

  if (!endpoint) {
    throw new Error(`No endpoint found for command "${commandName}" in module "${cliName} ${modulePathSegment}"`)
  }

  const credentials = await loadCredentials(cliName)
  const effectiveParams = {...credentials, ...params}

  const url = buildUrl(endpoint, effectiveParams)
  const headers = buildHeaders(endpoint, effectiveParams)
  const body = buildBody(endpoint, effectiveParams)

  const response = await fetch(url, {
    body,
    headers,
    method: endpoint.method,
  })

  const contentType = response.headers.get('content-type') || ''
  const responseBody = contentType.includes('application/json') ? await response.json() : await response.text()

  return {body: responseBody, status: response.status}
}
