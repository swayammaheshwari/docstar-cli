import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {Command} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import {z} from 'zod'

import type {ModuleIndex, SavedConfig} from '../lib/types.js'

import {parseSavedConfig} from '../lib/config.js'
import {fetchEndpoint, fetchModuleIndex} from '../lib/contracts.js'
import {entryCredentialNote} from '../lib/endpoint-flags.js'
import {executeEndpoint, signInHeaderOf} from '../lib/http.js'
import {configPath, isRootModule} from '../lib/paths.js'

const sanitize = (value: string): string => value.replaceAll(/[^a-zA-Z0-9_-]/g, '_')

const buildInputShape = (required: string[], optional: string[]): Record<string, z.ZodTypeAny> => {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const name of required) shape[name] = z.string().describe(`Required parameter: ${name}`)
  for (const name of optional) shape[name] = z.string().optional().describe(`Optional parameter: ${name}`)
  return shape
}

export default class Mcp extends Command {
  static override description = [
    'Start an MCP (Model Context Protocol) server exposing every installed endpoint (across all installed collections) as a callable tool for AI clients (Claude Desktop, Claude Code, etc.).',
    'Every tool follows the collection -> module -> endpoint hierarchy: e.g. collection "msg91" -> module "slack" -> endpoint "send-message-1" becomes the tool `msg91__slack__send-message-1`.',
    'Run `docstar-cli init <slug>` first so there is at least one registered module to expose. Each module\'s index is read live when the server starts, and an endpoint\'s contract when its tool is called.',
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
      savedConfig = parseSavedConfig(await readFile(configPath(), 'utf8'))
    } catch {
      this.error('No registered modules found. Run `docstar-cli init <slug>` first.')
    }

    const server = new McpServer({name: 'docstar-cli', version: '1.0.0'})

    let toolCount = 0

    for (const collection of savedConfig.collections) {
      for (const module of collection.modules) {
        let index: ModuleIndex
        try {
          // eslint-disable-next-line no-await-in-loop
          index = await fetchModuleIndex(collection.slug, module.path, collection.api)
        } catch (error) {
          this.warn(`Skipped ${collection.slug} ${module.path}: ${(error as Error).message}`)
          continue
        }

        const signInHeader = signInHeaderOf(index.auth)
        for (const entry of index.endpoints) {
          // Root endpoints have no module level: `<collection>__<endpoint>`.
          const isRoot = isRootModule(module.path)
          const toolName = sanitize(isRoot ? `${collection.slug}__${entry.command}` : `${collection.slug}__${module.path}__${entry.command}`)
          const note = entryCredentialNote(collection.slug, entry, signInHeader)
          const description = `[collection: ${collection.slug}${isRoot ? '' : ` / module: ${module.path}`}] ${entry.description || entry.command}${note ? `\n${note}. The user sets it up in their own terminal; never ask them to paste a key or token into the chat.` : ''}`
          const inputShape = buildInputShape(entry.parameters.required, entry.parameters.optional)

          server.tool(toolName, description, inputShape, async (args: Record<string, unknown>) => {
            try {
              // The endpoint is read when the tool is called: one request for just this endpoint
              const {auth, endpoint} = await fetchEndpoint(collection.slug, module.path, entry.command, collection.api)
              const result = await executeEndpoint(collection.slug, {auth}, endpoint, args as Record<string, string>)
              return {content: [{text: JSON.stringify(result), type: 'text' as const}]}
            } catch (error) {
              return {content: [{text: (error as Error).message, type: 'text' as const}], isError: true}
            }
          })

          toolCount++
        }
      }
    }

    if (toolCount === 0) {
      this.error('No endpoints found. Run `docstar-cli init <slug>` and register at least one module first.')
    }

    const transport = new StdioServerTransport()
    await server.connect(transport)
  }
}
