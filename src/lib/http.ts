import {readFile} from 'node:fs/promises'
import {modulePath} from './paths.js'
import type {EndpointContract, ModuleJson} from './types.js'

// Endpoint fields come from a rich-text editor and may be wrapped in
// `<span text-block="true">...</span>`-style markup; unwrap to the raw value.
export const stripHtml = (value: string | null | undefined): string => (value ?? '').replaceAll(/<[^>]*>/g, '')

const substitutePlaceholders = (template: string, params: Record<string, string>): string =>
  Object.entries(params).reduce(
    (result, [key, value]) => result.replaceAll(`:${key}`, value).replaceAll(`{${key}}`, value).replaceAll(`{{${key}}}`, value),
    template,
  )

export const loadModule = async (modulePathSegment: string): Promise<ModuleJson> => {
  const raw = await readFile(modulePath(modulePathSegment), 'utf8')
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
  const headers: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(endpoint.headers || {})) {
    const key = stripHtml(rawKey)
    const value = stripHtml((rawValue as any)?.value ?? rawValue)
    headers[key] = params[key] ?? value
  }

  return headers
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
    if (key in parsed) parsed[key] = value
  }

  return JSON.stringify(parsed)
}

export const executeCliCommand = async (
  modulePathSegment: string,
  commandName: string,
  params: Record<string, string>,
): Promise<{status: number; body: unknown}> => {
  const moduleJson = await loadModule(modulePathSegment)
  const endpoint = findEndpoint(moduleJson, commandName)

  if (!endpoint) {
    throw new Error(`No endpoint found for command "${commandName}" in module "${modulePathSegment}"`)
  }

  const url = buildUrl(endpoint, params)
  const headers = buildHeaders(endpoint, params)
  const body = buildBody(endpoint, params)

  const response = await fetch(url, {
    body,
    headers,
    method: endpoint.method,
  })

  const contentType = response.headers.get('content-type') || ''
  const responseBody = contentType.includes('application/json') ? await response.json() : await response.text()

  return {body: responseBody, status: response.status}
}
