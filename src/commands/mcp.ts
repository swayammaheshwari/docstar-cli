import {Command} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {z} from 'zod'
import {executeCliCommand, loadModule} from '../lib/http.js'
import {configPath} from '../lib/paths.js'
import type {SavedConfig} from '../lib/types.js'

const sanitize = (value: string): string => value.replaceAll(/[^a-zA-Z0-9_-]/g, '_')

const buildInputShape = (required: string[], optional: string[]): Record<string, z.ZodTypeAny> => {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const name of required) shape[name] = z.string().describe(`Required parameter: ${name}`)
  for (const name of optional) shape[name] = z.string().optional().describe(`Optional parameter: ${name}`)
  return shape
}

export default class Mcp extends Command {
  static override description = [
    'Start an MCP (Model Context Protocol) server exposing every installed endpoint as a callable tool for AI clients (Claude Desktop, Claude Code, etc.).',
    'Each endpoint becomes one tool named `<module>__<command>`, e.g. `slack__send-message-1`. Run `docstar-cli init <domain>` first so there is at least one installed module to expose.',
    'This command does not exit on its own — it stays running and communicates over stdio for as long as the connecting AI client keeps the connection open.',
  ].join('\n')
  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '# Then register it in an MCP client config, e.g. .mcp.json:',
    '# { "mcpServers": { "docstar": { "command": "docstar-cli", "args": ["mcp"] } } }',
  ]

  public async run(): Promise<void> {
    let savedConfig: SavedConfig
    try {
      savedConfig = JSON.parse(await readFile(configPath(), 'utf8')) as SavedConfig
    } catch {
      this.error('No installed modules found. Run `docstar-cli init <domain>` first.')
    }

    const server = new McpServer({name: 'docstar-cli', version: '1.0.0'})

    let toolCount = 0

    for (const module of savedConfig.modules) {
      // eslint-disable-next-line no-await-in-loop
      const moduleJson = await loadModule(module.path)

      for (const endpoint of moduleJson.endpoints) {
        const {cli} = endpoint
        const toolName = sanitize(`${module.path}__${cli.command.name}`)
        const description = cli.description || `${cli.command.name} (${module.path})`
        const inputShape = buildInputShape(cli.parameters.required, cli.parameters.optional)

        server.tool(toolName, description, inputShape, async (args: Record<string, unknown>) => {
          try {
            const result = await executeCliCommand(module.path, cli.command.name, args as Record<string, string>)
            return {content: [{type: 'text' as const, text: JSON.stringify(result)}]}
          } catch (error) {
            return {content: [{type: 'text' as const, text: (error as Error).message}], isError: true}
          }
        })

        toolCount++
      }
    }

    if (toolCount === 0) {
      this.error('No installed endpoints found. Run `docstar-cli init <domain>` and select at least one module first.')
    }

    const transport = new StdioServerTransport()
    await server.connect(transport)
  }
}
