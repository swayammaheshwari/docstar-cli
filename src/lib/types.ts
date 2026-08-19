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

export type ModuleSummary = {name: string; path: string}

export type SavedConfig = {
  baseUrl: string
  domain: string
  collectionId: string | null
  collection: {id: string; name: string} | null
  modules: ModuleSummary[]
  updatedAt: string
}
