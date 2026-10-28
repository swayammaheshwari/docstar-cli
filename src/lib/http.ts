import type {ApiKeyRow, EndpointContract, SignInHint} from './types.js'

import {getSignIn, refreshSignIn, type SignIn, SignInExpiredError, usableSignIn} from './auth.js'
import {apiOfCollection, fetchEndpoint} from './contracts.js'
import {MissingCredentialError, savedCredentialsOf, setHeader, setQueryParam, valueByName} from './credentials.js'

// Endpoint fields come from a rich-text editor and may be wrapped in
// `<span text-block="true">...</span>`-style markup; unwrap to the raw value.
export const stripHtml = (value: null | string | undefined): string => (value ?? '').replaceAll(/<[^>]*>/g, '')

const substitutePlaceholders = (template: string, params: Record<string, string>): string =>
  Object.entries(params).reduce(
    (result, [key, value]) => result.replaceAll(`:${key}`, value).replaceAll(`{${key}}`, value).replaceAll(`{{${key}}}`, value),
    template,
  )

// The docs' URL carries the query as the owner wrote it (`?startDate=&amp;endDate=`), and `params` describes each value. Every
// enabled parameter gets the user's value (a flag of its name), else the one in the URL, else the docs' own; one with no value
// is left out. API-key parameters are the user's own and are added separately.
const withQuery = (url: string, endpoint: EndpointContract, params: Record<string, string>): string => {
  const rows = Object.entries(endpoint.params || {}).filter(
    ([, row]) => String((row as {checked?: unknown})?.checked) !== 'false' && (row as {credential?: unknown})?.credential !== 'apiKey',
  )
  if (rows.length === 0) return url

  const [path, ...rest] = url.split('?')
  const search = new URLSearchParams(rest.join('?').replaceAll('&amp;', '&'))
  for (const [rawName, row] of rows) {
    const name = stripHtml(rawName)
    const value = params[name] ?? (search.get(name) || stripHtml((row as {value?: string})?.value))
    if (value) search.set(name, value)
    else search.delete(name)
  }

  const query = search.toString()
  return query ? `${path}?${query}` : path
}

const buildUrl = (endpoint: EndpointContract, params: Record<string, string>): string => {
  const baseUrl = stripHtml(endpoint.baseUrl)
  const path = substitutePlaceholders(stripHtml(endpoint.url), params)
  return withQuery(/^https?:\/\//.test(path) ? path : `${baseUrl}${path}`, endpoint, params)
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

// The header a signed-in user's token goes in when the docs don't say (an older API): the one their sign-in gave, else Authorization
const DEFAULT_SIGN_IN_HEADER = 'Authorization'

// The header the user's sign-in token goes in for this collection, or null when it has no sign-in. module.json's `auth`
// says (null = the owner has no sign-in, so `login` can't work and is never asked for); an API that doesn't send it
// falls back to the header of the user's stored sign-in, else Authorization.
export const signInHeaderOf = (auth: SignInHint | null | undefined, storedHeader?: null | string): null | string => {
  if (auth === null) return null
  return auth?.headerName || storedHeader || DEFAULT_SIGN_IN_HEADER
}

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

// Header rows the docs list without a value that are neither the sign-in header nor marked as API keys: there is nothing
// to send until the user gives the value, so they're asked for it as it is (flag, `config set`, or a prompt)
export const userValueHeaderRowsOf = (endpoint: EndpointContract, signInHeader: null | string): ApiKeyRow[] => {
  const marked = new Set(apiKeyRowsOf(endpoint).filter((row) => row.in === 'header').map((row) => row.name.toLowerCase()))
  return Object.entries(endpoint.headers || {})
    .filter(([name, entry]) => {
      const row = entry as null | string | {checked?: unknown; value?: unknown}
      const value = typeof row === 'string' ? row : row?.value
      const lower = stripHtml(name).toLowerCase()
      return (
        String((row as {checked?: unknown} | null)?.checked) !== 'false' &&
        stripHtml(typeof value === 'string' ? value : '').trim() === '' &&
        lower !== signInHeader?.toLowerCase() &&
        !marked.has(lower)
      )
    })
    .map(([name]) => ({in: 'header' as const, name: stripHtml(name)}))
}

// What an endpoint needs to authenticate: the values only the user has (API keys the owner marked, and header rows with
// no value), and whether it runs on the sign-in (it sends the sign-in header, and that header isn't an API key)
export const endpointNeeds = (endpoint: EndpointContract, signInHeader: null | string = DEFAULT_SIGN_IN_HEADER): {apiKeys: string[]; signIn: boolean} => {
  const apiKeys = [...apiKeyRowsOf(endpoint), ...userValueHeaderRowsOf(endpoint, signInHeader)].map((row) => row.name)
  const signIn = signInHeader !== null && sendsHeader(endpoint, signInHeader) && !apiKeys.some((name) => name.toLowerCase() === signInHeader.toLowerCase())
  return {apiKeys, signIn}
}

export type ExecuteResult = {body: unknown; hint?: string; status: number}

// Runs one endpoint that was just fetched: `moduleJson.auth` is the collection's sign-in header
export const executeEndpoint = async (
  slug: string,
  moduleJson: {auth?: SignInHint | null},
  endpoint: EndpointContract,
  params: Record<string, string>,
): Promise<ExecuteResult> => {
  // Saved credentials (`config set`, `key save`) fill the request like flags do; a flag for the same name wins
  const saved = await savedCredentialsOf(slug)
  const effectiveParams = {...saved, ...params}

  let url = buildUrl(endpoint, effectiveParams)
  let headers = buildHeaders(endpoint, effectiveParams)
  const body = buildBody(endpoint, effectiveParams)

  // 1. The rows the docs owner marked as API keys: the user's own key (a flag on this call, else the saved one),
  //    checked BEFORE calling, so a missing key stops here with what to do instead of a request the API can only refuse
  const stored = await getSignIn(slug)
  const signInHeader = signInHeaderOf(moduleJson.auth, stored?.tokenHeader)
  const apiKeys = [...apiKeyRowsOf(endpoint), ...userValueHeaderRowsOf(endpoint, signInHeader)]
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
  // Only read where `needsSignIn` is true, i.e. the collection has a sign-in header
  const signInName = signInHeader ?? DEFAULT_SIGN_IN_HEADER
  const needsSignIn =
    signInHeader !== null &&
    sendsHeader(endpoint, signInHeader) &&
    !apiKeys.some((spec) => spec.in === 'header' && spec.name.toLowerCase() === signInHeader.toLowerCase()) &&
    valueByName(effectiveParams, signInHeader) === undefined

  let signIn: null | SignIn = null
  if (needsSignIn) {
    signIn = await usableSignIn(slug).catch((error: unknown) => {
      if (error instanceof SignInExpiredError) throw new MissingCredentialError(slug, 'signIn', signInName, true)
      throw error
    })
    if (!signIn) throw new MissingCredentialError(slug, 'signIn', signInName)
  }

  // The prefix is the one the sign-in's own header takes; the docs' header (`auth`) may be another one with its own
  const prefixOf = (current: SignIn): string =>
    moduleJson.auth && moduleJson.auth.headerName.toLowerCase() !== current.tokenHeader.toLowerCase() ? moduleJson.auth.tokenPrefix : current.tokenPrefix

  const send = async () => {
    const withToken = signIn ? setHeader(headers, signInName, prefixOf(signIn) ? `${prefixOf(signIn)} ${signIn.accessToken}` : signIn.accessToken) : headers
    return fetch(url, {body, headers: withToken, method: endpoint.method})
  }

  // A sign-in token the API refuses is refreshed once (DocStar holds the client secret) and the call retried
  let response = await send()
  if (response.status === 401 && signIn?.refreshToken) {
    signIn = await refreshSignIn(slug, signIn).catch((error: unknown) => {
      if (error instanceof SignInExpiredError) throw new MissingCredentialError(slug, 'signIn', signInName, true)
      throw error
    })
    response = await send()
  }

  const contentType = response.headers.get('content-type') || ''
  const responseBody = contentType.includes('application/json') ? await response.json() : await response.text()

  const hint = refusalHint(slug, response.status, keySources, Boolean(signIn))
  return hint ? {body: responseBody, hint, status: response.status} : {body: responseBody, status: response.status}
}

// Reads the endpoint's contract now (one request) and runs it, by command name (what MCP callers use)
export const executeCliCommand = async (
  slug: string,
  modulePathSegment: string,
  commandName: string,
  params: Record<string, string>,
): Promise<ExecuteResult> => {
  const {auth, endpoint} = await fetchEndpoint(slug, modulePathSegment, commandName, await apiOfCollection(slug))
  return executeEndpoint(slug, {auth}, endpoint, params)
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
