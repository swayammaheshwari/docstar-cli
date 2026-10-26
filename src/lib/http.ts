import {readFile} from 'node:fs/promises'
import {refreshSignIn, usableSignIn, withToken} from './auth.js'
import {parseSavedConfig} from './config.js'
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

export const loadModule = async (slug: string, modulePathSegment: string): Promise<ModuleJson> => {
  const raw = await readFile(modulePath(slug, modulePathSegment), 'utf8')
  return JSON.parse(raw) as ModuleJson
}

// Lets a value like `authkey` be saved once (`docstar-cli config set <slug> authkey <value>`)
// instead of being passed on every command line; an explicit flag for the same name still wins.
const loadCredentials = async (slug: string): Promise<Record<string, string>> => {
  try {
    const savedConfig = parseSavedConfig(await readFile(configPath(), 'utf8'))
    return savedConfig.collections.find((collection) => collection.slug === slug)?.credentials || {}
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
  slug: string,
  modulePathSegment: string,
  commandName: string,
  params: Record<string, string>,
): Promise<{body: unknown; hint?: string; status: number}> => {
  const moduleJson = await loadModule(slug, modulePathSegment)
  const endpoint = findEndpoint(moduleJson, commandName)

  if (!endpoint) {
    throw new Error(`No endpoint found for command "${commandName}" in module "${slug} ${modulePathSegment}"`)
  }

  const credentials = await loadCredentials(slug)
  const effectiveParams = {...credentials, ...params}

  const url = buildUrl(endpoint, effectiveParams)
  const headers = buildHeaders(endpoint, effectiveParams)
  const body = buildBody(endpoint, effectiveParams)

  // Signed in (`docstar-cli login <slug>`): the user's token goes in the endpoint's token header. An expired token is
  // refreshed first; one the API still refuses (401) is refreshed once more and the call retried.
  let signIn = await usableSignIn(slug)
  const send = async () => {
    const authorized = withToken(headers, endpoint.auth, signIn, Object.keys(effectiveParams))
    return {response: await fetch(url, {body, headers: authorized.headers, method: endpoint.method}), sent: authorized.sent}
  }

  let {response, sent} = await send()
  if (response.status === 401 && sent && signIn?.refreshToken) {
    signIn = await refreshSignIn(slug, signIn)
    ;({response, sent} = await send())
  }

  const contentType = response.headers.get('content-type') || ''
  const responseBody = contentType.includes('application/json') ? await response.json() : await response.text()

  // An API that refuses the call says why in its body; the hint says what to do about it
  if (response.status === 401) {
    const hint = signIn
      ? sent
        ? `Your sign-in to ${slug} was refused. Run \`docstar-cli login ${slug}\` to sign in again.`
        : undefined
      : `Not signed in. If ${slug} offers sign-in, run \`docstar-cli login ${slug}\`; otherwise save its API key with \`docstar-cli config set ${slug} <header> <key>\`.`
    if (hint) return {body: responseBody, hint, status: response.status}
  }

  return {body: responseBody, status: response.status}
}
