// Adds a collection's hosted MCP server to the AI tools on this computer (`setup`). A tool is only touched when its config
// folder already exists (it is installed), and an entry already using the name is left as it is.
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {dirname, join} from 'node:path'

export type McpResult = {detail?: string; status: 'added' | 'already' | 'failed' | 'would-add'; tool: string}

type FileTarget = {file: (home: string) => string; label: string; slug: 'codex' | JsonTool}
type JsonTool = 'copilot' | 'cursor' | 'factory-droid' | 'opencode'

const FILE_TARGETS: FileTarget[] = [
  {file: (home) => join(home, '.cursor', 'mcp.json'), label: 'Cursor', slug: 'cursor'},
  {file: (home) => join(home, '.codex', 'config.toml'), label: 'OpenAI Codex', slug: 'codex'},
  {file: (home) => join(home, '.config', 'opencode', 'opencode.json'), label: 'OpenCode', slug: 'opencode'},
  {file: (home) => join(home, '.copilot', 'mcp-config.json'), label: 'GitHub Copilot CLI', slug: 'copilot'},
  {file: (home) => join(home, '.factory', 'mcp.json'), label: 'Factory Droid', slug: 'factory-droid'},
]

export const onPath = (command: string): boolean =>
  spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {stdio: 'ignore'}).status === 0

// Each tool's own shape for a remote (HTTP) MCP server. null = an entry with that name is already there.
export const renderJson = (tool: JsonTool, existing: string, name: string, url: string): null | string => {
  const root = existing.trim() ? JSON.parse(existing) : {}
  if (typeof root !== 'object' || root === null || Array.isArray(root)) throw new Error("the file isn't a JSON object")
  if (tool === 'opencode') {
    if (root.mcp?.[name]) return null
    root.$schema ??= 'https://opencode.ai/config.json'
    root.mcp = {...root.mcp, [name]: {enabled: true, type: 'remote', url}}
  } else {
    if (root.mcpServers?.[name]) return null
    const entry = tool === 'cursor' ? {url} : tool === 'copilot' ? {tools: ['*'], type: 'http', url} : {disabled: false, type: 'http', url}
    root.mcpServers = {...root.mcpServers, [name]: entry}
  }

  return JSON.stringify(root, null, 2) + '\n'
}

// Appending a whole [mcp_servers.<name>] table is always valid TOML
export const renderCodex = (existing: string, name: string, url: string): null | string => {
  if (existing.includes(`[mcp_servers.${name}]`)) return null
  const base = existing.trimEnd()
  return `${base}${base ? '\n\n' : ''}[mcp_servers.${name}]\nurl = ${JSON.stringify(url)}\n`
}

export const installMcp = (
  name: string,
  url: string,
  {claudeCode = true, dryRun = false, home = homedir()}: {claudeCode?: boolean; dryRun?: boolean; home?: string} = {},
): McpResult[] => {
  const results: McpResult[] = []

  if (claudeCode && onPath('claude')) {
    const tool = 'Claude Code'
    const add = ['mcp', 'add', '--transport', 'http', '--scope', 'user', name, url]
    if (spawnSync('claude', ['mcp', 'get', name], {stdio: 'ignore'}).status === 0) results.push({status: 'already', tool})
    else if (dryRun) results.push({detail: `claude ${add.join(' ')}`, status: 'would-add', tool})
    else {
      const answer = spawnSync('claude', add, {encoding: 'utf8'})
      results.push(answer.status === 0 ? {status: 'added', tool} : {detail: (answer.stderr || answer.stdout || '').trim(), status: 'failed', tool})
    }
  }

  for (const target of FILE_TARGETS) {
    const file = target.file(home)
    if (!existsSync(dirname(file))) continue
    try {
      const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
      const next = target.slug === 'codex' ? renderCodex(existing, name, url) : renderJson(target.slug, existing, name, url)
      if (next === null) results.push({detail: file, status: 'already', tool: target.label})
      else if (dryRun) results.push({detail: file, status: 'would-add', tool: target.label})
      else {
        mkdirSync(dirname(file), {recursive: true})
        writeFileSync(file, next)
        results.push({detail: file, status: 'added', tool: target.label})
      }
    } catch (error) {
      results.push({detail: `${file}: ${(error as Error).message} (left unchanged)`, status: 'failed', tool: target.label})
    }
  }

  return results
}
