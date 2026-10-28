export type CliCommandMeta = {
  name: string
  description: string
  command: {name: string; aliases: string[]}
  version: number
  parameters: {required: string[]; optional: string[]}
}

export type EndpointContract = {
  cli: CliCommandMeta
  method: string
  url: string
  baseUrl: string | null
  headers: Record<string, any>
  params: Record<string, any>
  pathVariables: Record<string, any>
  body: any
  authentication: Record<string, any>
  description: string
  sampleResponse: any
}

// Where a signed-in user's token goes (from the sign-in: the owner's sign-in header, default Authorization: Bearer)
export type TokenPlacement = {tokenHeader: string; tokenPrefix: string}

// A header or query-param row the docs owner marked as an API key (`credential: "apiKey"` on the row in module.json)
export type ApiKeyRow = {in: 'header' | 'query'; name: string}

// Where the collection's sign-in puts the user's token (module.json `auth`; null = the owner has no sign-in, absent = an
// older API that doesn't say)
export type SignInHint = {headerName: string; tokenPrefix: string}

// One endpoint of a module's index (`GET /p/generate-module-json?slug=&path=<module>`): what `list`, completion and the `mcp`
// tools need without reading the endpoint. `path` is its page path and `link` its own module.json (its full contract).
export type IndexEntry = {
  name: string
  command: string
  aliases: string[]
  method: string
  description: string
  parameters: {optional: string[]; required: string[]}
  // Rows the docs owner marked as the user's own API key
  credentials: ApiKeyRow[]
  // Names of the headers the endpoint sends
  headers: string[]
  link: string
  path: string
}

// A module's (or the collection root's) index
export type ModuleIndex = {
  module: {id: string; name: string; version: string}
  auth?: SignInHint | null
  endpoints: IndexEntry[]
}

// One endpoint (`path=<module>/<endpoint>`): its full contract, and the collection's sign-in header (`auth`)
export type EndpointResponse = {
  module: {id: string; name: string; version: string}
  auth?: SignInHint | null
  endpoint: EndpointContract
}

export type ModuleSummary = {
  name: string
  path: string
  // What `init` registered: the command names (and aliases) of the module's endpoints, for shell completion
  commands?: string[]
  endpointCount?: number
  endpoints?: {name: string; path: string}[]
}

export type RootEndpointSummary = {name: string; path: string}

export type CollectionSummary = {id: string; name: string; slug: string}

// `GET /p/generate-module-json?slug=` (no path): the collection's modules and root endpoints
export type CollectionListResponse = {
  auth?: SignInHint | null
  collection?: CollectionSummary
  modules: ModuleSummary[]
  rootEndpoints?: RootEndpointSummary[]
}

export type CollectionConfig = {
  slug: string
  name: string
  // The DocStar API the docs were read from. Collections installed by older versions have `domain`/`baseUrl`/`collectionId` instead.
  api?: string
  domain?: string
  baseUrl?: string
  collectionId?: string | null
  modules: ModuleSummary[]
  updatedAt: string
  credentials?: Record<string, string>
  // What `key save` knew about a credential: the env variable `key emit` writes, and the scheme in front of it in the header (e.g. Bearer)
  credentialMeta?: Record<string, CredentialMeta>
}

export type CredentialMeta = {envVar?: string; prefix?: string}

export type SavedConfig = {
  collections: CollectionConfig[]
}
