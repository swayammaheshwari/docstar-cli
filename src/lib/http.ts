import {readFile} from 'node:fs/promises'

import type {ApiKeyRow, EndpointContract, ModuleJson} from './types.js'

import {getSignIn, refreshSignIn, type SignIn, SignInExpiredError, usableSignIn} from './auth.js'
import {MissingCredentialError, savedCredentialsOf, setHeader, setQueryParam, valueByName} from './credentials.js'
import {modulePath} from './paths.js'

// Endpoint fields come from a rich-text editor and may be wrapped in
// `<span text-block="true">...</span>`-style markup; unwrap to the raw value.
export const stripHtml = (value: null | string | undefined): string => (value ?? '').replaceAll(/<[^>]*>/g, '')

const substitutePlaceholders = (template: string, params: Record<string, string>): string =>
  Object.entries(params).reduce(
    (result, [key, value]) => result.replaceAll(`:${key}`, value).replaceAll(`{${key}}`, value).replaceAll(`{{${key}}}`, value),
    template,
  )

export const loadModule = async (slug: string, modulePathSegment: string): Promise<ModuleJson> => {
  const raw = await readFile(modulePath(slug, modulePathSegment), 'utf8')
  return JSON.parse(raw) as ModuleJson
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

// The header a signed-in user's token goes in: the one their sign-in gave (the owner's sign-in header), else Authorization
const DEFAULT_SIGN_IN_HEADER = 'Authorization'

const sendsHeader = (endpoint: EndpointContract, name: string): boolean =>
  Object.entries(endpoint.headers || {}).some(
    ([header, entry]) => stripHtml(header).toLowerCase() === name.toLowerCase() && String((entry as {checked?: unknown})?.checked) !== 'false',
  )

// The rows the docs owner marked as API keys: `credential: "apiKey"` on a header or query-param row of module.json
export const apiKeyRowsOf = (endpoint: EndpointContract): ApiKeyRow[] => {
  const marked = (rows: Record<string, unknown> | undefined, place: ApiKeyRow['in']): ApiKeyRow[] =>
    Object.entries(rows || {})
      .filter(([, entry]) => {
        const row = entry as null | {checked?: unknown; credential?: unknown}
        return row?.credential === 'apiKey' && String(row.checked) !== 'false'
      })
      .map(([name]) => ({in: place, name: stripHtml(name)}))
  return [...marked(endpoint.headers, 'header'), ...marked(endpoint.params, 'query')]
}

// What an endpoint needs to authenticate: the API keys the owner marked, and whether it runs on the sign-in (it sends
// the sign-in header, and that header isn't an API key)
export const endpointNeeds = (endpoint: EndpointContract, signInHeader = DEFAULT_SIGN_IN_HEADER): {apiKeys: string[]; signIn: boolean} => {
  const apiKeys = apiKeyRowsOf(endpoint).map((row) => row.name)
  const signIn = sendsHeader(endpoint, signInHeader) && !apiKeys.some((name) => name.toLowerCase() === signInHeader.toLowerCase())
  return {apiKeys, signIn}
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

  // Saved credentials (`config set`, `key save`) fill the request like flags do; a flag for the same name wins
  const saved = await savedCredentialsOf(slug)
  const effectiveParams = {...saved, ...params}

  let url = buildUrl(endpoint, effectiveParams)
  let headers = buildHeaders(endpoint, effectiveParams)
  const body = buildBody(endpoint, effectiveParams)

  // 1. The rows the docs owner marked as API keys: the user's own key (a flag on this call, else the saved one),
  //    checked BEFORE calling, so a missing key stops here with what to do instead of a request the API can only refuse
  const apiKeys = apiKeyRowsOf(endpoint)
  const keySources: Array<{fromFlag: boolean; name: string}> = []
  for (const spec of apiKeys) {
    const anyCase = spec.in === 'header'
    const fromFlag = valueByName(params, spec.name, anyCase)
    const value = fromFlag ?? valueByName(saved, spec.name, anyCase)
    if (!value) throw new MissingCredentialError(slug, 'apiKey', spec.name)
    if (spec.in === 'query') url = setQueryParam(url, spec.name, value)
    else headers = setHeader(headers, spec.name, value)
    keySources.push({fromFlag: Boolean(fromFlag), name: spec.name})
  }

  // 2. Everything else runs on the sign-in by default: an endpoint that sends the sign-in header gets the user's token
  //    there, unless that header is marked as an API key or the user gave its value themselves (flag, `config set`)
  const stored = await getSignIn(slug)
  const signInHeader = stored?.tokenHeader || DEFAULT_SIGN_IN_HEADER
  const needsSignIn =
    sendsHeader(endpoint, signInHeader) &&
    !apiKeys.some((spec) => spec.in === 'header' && spec.name.toLowerCase() === signInHeader.toLowerCase()) &&
    valueByName(effectiveParams, signInHeader) === undefined

  let signIn: null | SignIn = null
  if (needsSignIn) {
    signIn = await usableSignIn(slug).catch((error: unknown) => {
      if (error instanceof SignInExpiredError) throw new MissingCredentialError(slug, 'signIn', signInHeader, true)
      throw error
    })
    if (!signIn) throw new MissingCredentialError(slug, 'signIn', signInHeader)
  }

  const send = async () => {
    const withToken = signIn ? setHeader(headers, signInHeader, signIn.tokenPrefix ? `${signIn.tokenPrefix} ${signIn.accessToken}` : signIn.accessToken) : headers
    return fetch(url, {body, headers: withToken, method: endpoint.method})
  }

  // A sign-in token the API refuses is refreshed once (DocStar holds the client secret) and the call retried
  let response = await send()
  if (response.status === 401 && signIn?.refreshToken) {
    signIn = await refreshSignIn(slug, signIn).catch((error: unknown) => {
      if (error instanceof SignInExpiredError) throw new MissingCredentialError(slug, 'signIn', signInHeader, true)
      throw error
    })
    response = await send()
  }

  const contentType = response.headers.get('content-type') || ''
  const responseBody = contentType.includes('application/json') ? await response.json() : await response.text()

  const hint = refusalHint(slug, response.status, keySources, Boolean(signIn))
  return hint ? {body: responseBody, hint, status: response.status} : {body: responseBody, status: response.status}
}

// What to do when the API refuses a call (401/403): names what it refused, never its value
const refusalHint = (slug: string, status: number, keySources: Array<{fromFlag: boolean; name: string}>, sentSignIn: boolean): string | undefined => {
  if (status !== 401 && status !== 403) return undefined
  if (sentSignIn && status === 401) return `${slug} refused your sign-in. Sign in again: docstar-cli login ${slug}`
  if (keySources.length > 0) {
    return keySources
      .map(({fromFlag, name}) => `${slug} refused your API key "${name}" (${fromFlag ? `the --${name} you passed` : 'the one saved with config set / key save'}). Check it, or save the right one: docstar-cli config set ${slug} ${name} <key>`)
      .join('\n')
  }

  return undefined
}
