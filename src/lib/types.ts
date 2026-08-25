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

export type CollectionSummary = {id: string; name: string; cliName: string}

export type CollectionConfig = {
  cliName: string
  name: string
  domain: string
  baseUrl: string
  collectionId: string | null
  modules: ModuleSummary[]
  updatedAt: string
}

export type SavedConfig = {
  collections: CollectionConfig[]
}
