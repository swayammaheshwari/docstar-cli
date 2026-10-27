import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {EndpointContract} from './types.js'

import {endpointNeeds} from './http.js'
import {isRootModule} from './paths.js'

const flagLine = (name: string, required: boolean): string =>
  // Required params are collected interactively when missing, so the flag itself stays optional to oclif.
  // Param names come from endpoint body/param keys authored in a rich-text editor and can contain
  // quotes or HTML markup (e.g. a stray `<span text-block='true'>...`) — JSON.stringify escapes
  // that safely for embedding in generated source; naive string interpolation does not and can
  // produce invalid JS.
  `    ${JSON.stringify(name)}: Flags.string({description: ${JSON.stringify(`${required ? 'Required' : 'Optional'} parameter`)}}),`

// Header names configured in the docs editor (e.g. `authkey`) aren't part of `cli.parameters`,
// so without this they can never be overridden from the CLI and requests are stuck with
// whatever placeholder/value is baked into the cached module JSON. Expose them as flags too,
// skipping any name that's already a parameter flag (that flag's value already reaches
// `buildHeaders` via `params[key]`) or isn't a valid flag name.
// A credential header's flag says what it is; the value is never shown in help
const headerFlagDescription = (endpoint: EndpointContract, name: string): string => {
  const {apiKeys, signIn} = endpointNeeds(endpoint)
  if (apiKeys.some((key) => key.toLowerCase() === name.toLowerCase())) return 'Your API key (or save it with `config set`)'
  if (signIn && name.toLowerCase() === 'authorization') return 'Sent from your sign-in (`docstar-cli login`); a value here replaces it'
  return 'Header value'
}

const headerFlagNames = (endpoint: EndpointContract): string[] => {
  const paramNames = new Set([...endpoint.cli.parameters.optional, ...endpoint.cli.parameters.required])
  return Object.keys(endpoint.headers || {}).filter((name) => /^[A-Za-z][\w-]*$/.test(name) && !paramNames.has(name))
}

// What `--help` says the command needs to authenticate, so nobody has to guess
export const credentialNote = (slug: string, endpoint: EndpointContract): string => {
  const {apiKeys, signIn} = endpointNeeds(endpoint)
  return [
    ...apiKeys.map((name) => `Needs your ${slug} API key "${name}": --${name} <key>, or save it once with docstar-cli config set ${slug} ${name} <key>`),
    ...(signIn ? [`Runs on your sign-in: docstar-cli login ${slug}`] : []),
  ].join('\n')
}

const commandDescription = (slug: string, modulePathSegment: string, endpoint: EndpointContract): string => {
  const {cli} = endpoint
  const base = cli.description || `${cli.name} (${isRootModule(modulePathSegment) ? slug : `${slug} ${modulePathSegment}`})`
  const note = credentialNote(slug, endpoint)
  return note ? `${base}\n\n${note}` : base
}

const commandFileContent = (slug: string, modulePathSegment: string, endpoint: EndpointContract): string => {
  const {cli} = endpoint
  const flagLines = [
    ...cli.parameters.required.map((name) => flagLine(name, true)),
    ...cli.parameters.optional.map((name) => flagLine(name, false)),
    ...headerFlagNames(endpoint).map((name) => `    ${JSON.stringify(name)}: Flags.string({description: ${JSON.stringify(headerFlagDescription(endpoint, name))}}),`),
  ].join('\n')

  // Root commands sit one directory higher (dist/commands/<slug>/<endpoint>.js) than module commands.
  const libPath = isRootModule(modulePathSegment) ? '../../lib' : '../../../lib'

  return `import {Command, Flags} from '@oclif/core'
import {runEndpoint} from '${libPath}/run.js'

const REQUIRED_PARAMS = ${JSON.stringify(cli.parameters.required)}

export default class Generated extends Command {
  static description = ${JSON.stringify(commandDescription(slug, modulePathSegment, endpoint))}
  static aliases = ${JSON.stringify(cli.command.aliases.filter((alias) => alias !== cli.name))}
  static flags = {
${flagLines}
  }

  async run() {
    const {flags} = await this.parse(Generated)
    const params = {}
    for (const [key, value] of Object.entries(flags)) {
      if (value !== undefined) params[key] = value
    }

    await runEndpoint(this, {slug: ${JSON.stringify(slug)}, module: ${JSON.stringify(modulePathSegment)}, command: ${JSON.stringify(cli.command.name)}}, params, REQUIRED_PARAMS)
  }
}
`
}

export const generateCommandFile = async (cliRoot: string, slug: string, modulePathSegment: string, endpoint: EndpointContract): Promise<string> => {
  const dir = isRootModule(modulePathSegment) ? join(cliRoot, 'dist', 'commands', slug) : join(cliRoot, 'dist', 'commands', slug, modulePathSegment)
  await mkdir(dir, {recursive: true})
  const filePath = join(dir, `${endpoint.cli.command.name}.js`)
  await writeFile(filePath, commandFileContent(slug, modulePathSegment, endpoint))
  return filePath
}
