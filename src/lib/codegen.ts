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

const listCommandFileContent = (modulePathSegment: string): string => `import {Command} from '@oclif/core'
import {loadModule} from '../../lib/http.js'

export default class GeneratedList extends Command {
  static description = 'List installed APIs for the ${modulePathSegment} module'

  async run() {
    const moduleJson = await loadModule('${modulePathSegment}')

    for (const endpoint of moduleJson.endpoints) {
      const {cli} = endpoint
      this.log(\`\${cli.command.name}\${cli.command.aliases.filter((alias) => alias !== cli.command.name).length > 0 ? \` (aliases: \${cli.command.aliases.filter((alias) => alias !== cli.command.name).join(', ')})\` : ''}\`)
      if (cli.description) this.log(\`  \${cli.description}\`)
      this.log(\`  \${endpoint.method}\`)
      if (cli.parameters.required.length > 0) this.log(\`  required: \${cli.parameters.required.join(', ')}\`)
      if (cli.parameters.optional.length > 0) this.log(\`  optional: \${cli.parameters.optional.join(', ')}\`)
      this.log('')
    }
  }
}
`

export const generateCommandFile = async (cliRoot: string, modulePathSegment: string, endpoint: EndpointContract): Promise<string> => {
  const dir = join(cliRoot, 'dist', 'commands', modulePathSegment)
  await mkdir(dir, {recursive: true})
  const filePath = join(dir, `${endpoint.cli.command.name}.js`)
  await writeFile(filePath, commandFileContent(modulePathSegment, endpoint))
  return filePath
}

export const generateListCommandFile = async (cliRoot: string, modulePathSegment: string): Promise<string> => {
  const dir = join(cliRoot, 'dist', 'commands', modulePathSegment)
  await mkdir(dir, {recursive: true})
  const filePath = join(dir, 'list.js')
  await writeFile(filePath, listCommandFileContent(modulePathSegment))
  return filePath
}
