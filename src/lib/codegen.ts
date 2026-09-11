import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import type {EndpointContract} from './types.js'

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
const headerFlagNames = (endpoint: EndpointContract): string[] => {
  const paramNames = new Set([...endpoint.cli.parameters.required, ...endpoint.cli.parameters.optional])
  return Object.keys(endpoint.headers || {}).filter((name) => /^[A-Za-z][\w-]*$/.test(name) && !paramNames.has(name))
}

const commandFileContent = (cliName: string, modulePathSegment: string, endpoint: EndpointContract): string => {
  const {cli} = endpoint
  const flagLines = [
    ...cli.parameters.required.map((name) => flagLine(name, true)),
    ...cli.parameters.optional.map((name) => flagLine(name, false)),
    ...headerFlagNames(endpoint).map((name) => `    ${JSON.stringify(name)}: Flags.string({description: 'Header value'}),`),
  ].join('\n')

  return `import {Command, Flags} from '@oclif/core'
import {executeCliCommand} from '../../../lib/http.js'
import {promptForMissingParams} from '../../../lib/prompt.js'

const REQUIRED_PARAMS = ${JSON.stringify(cli.parameters.required)}

export default class Generated extends Command {
  static description = ${JSON.stringify(cli.description || `${cli.name} (${cliName} ${modulePathSegment})`)}
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

    Object.assign(params, await promptForMissingParams(REQUIRED_PARAMS, params))

    try {
      const result = await executeCliCommand(${JSON.stringify(cliName)}, ${JSON.stringify(modulePathSegment)}, ${JSON.stringify(cli.command.name)}, params)
      this.log(JSON.stringify(result, null, 2))
    } catch (error) {
      this.error(error.message)
    }
  }
}
`
}

export const generateCommandFile = async (cliRoot: string, cliName: string, modulePathSegment: string, endpoint: EndpointContract): Promise<string> => {
  const dir = join(cliRoot, 'dist', 'commands', cliName, modulePathSegment)
  await mkdir(dir, {recursive: true})
  const filePath = join(dir, `${endpoint.cli.command.name}.js`)
  await writeFile(filePath, commandFileContent(cliName, modulePathSegment, endpoint))
  return filePath
}
