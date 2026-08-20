import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import type {EndpointContract} from './types.js'

const flagLine = (name: string, required: boolean): string =>
  // Required params are collected interactively when missing, so the flag itself stays optional to oclif.
  `    '${name}': Flags.string({description: '${required ? 'Required' : 'Optional'} parameter'}),`

const commandFileContent = (modulePathSegment: string, endpoint: EndpointContract): string => {
  const {cli} = endpoint
  const flagLines = [
    ...cli.parameters.required.map((name) => flagLine(name, true)),
    ...cli.parameters.optional.map((name) => flagLine(name, false)),
  ].join('\n')

  return `import {Command, Flags} from '@oclif/core'
import {executeCliCommand} from '../../lib/http.js'
import {promptForMissingParams} from '../../lib/prompt.js'

const REQUIRED_PARAMS = ${JSON.stringify(cli.parameters.required)}

export default class Generated extends Command {
  static description = ${JSON.stringify(cli.description || `${cli.name} (${modulePathSegment})`)}
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
      const result = await executeCliCommand('${modulePathSegment}', '${cli.command.name}', params)
      this.log(JSON.stringify(result, null, 2))
    } catch (error) {
      this.error(error.message)
    }
  }
}
`
}

export const generateCommandFile = async (cliRoot: string, modulePathSegment: string, endpoint: EndpointContract): Promise<string> => {
  const dir = join(cliRoot, 'dist', 'commands', modulePathSegment)
  await mkdir(dir, {recursive: true})
  const filePath = join(dir, `${endpoint.cli.command.name}.js`)
  await writeFile(filePath, commandFileContent(modulePathSegment, endpoint))
  return filePath
}
