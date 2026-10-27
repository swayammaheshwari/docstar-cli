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

export type ModuleJson = {
  module: {id: string; name: string; version: string}
  endpoints: EndpointContract[]
}

export type ModuleSummary = {
  name: string
  path: string
  endpointCount?: number
  endpoints?: {name: string; path: string}[]
}

export type RootEndpointSummary = {name: string; path: string}

export type CollectionSummary = {id: string; name: string; slug: string}

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
