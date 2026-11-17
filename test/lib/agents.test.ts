import {expect} from 'chai'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {installMcp, renderCodex, renderJson} from '../../src/lib/agents.js'

const URL = 'https://mcp.docstar.io/connector/msg91'

describe('setup: MCP config for AI tools', () => {
  it('adds the server next to the ones already there, once', () => {
    const out = JSON.parse(renderJson('cursor', JSON.stringify({mcpServers: {other: {url: 'x'}}}), 'msg91', URL) as string)
    expect(out.mcpServers).to.deep.equal({msg91: {url: URL}, other: {url: 'x'}})
    expect(renderJson('cursor', JSON.stringify(out), 'msg91', URL)).to.equal(null)
  })

  it("uses each tool's own shape", () => {
    expect(JSON.parse(renderJson('opencode', '', 'msg91', URL) as string).mcp.msg91).to.deep.equal({enabled: true, type: 'remote', url: URL})
    expect(JSON.parse(renderJson('copilot', '', 'msg91', URL) as string).mcpServers.msg91).to.deep.equal({tools: ['*'], type: 'http', url: URL})
    expect(JSON.parse(renderJson('factory-droid', '', 'msg91', URL) as string).mcpServers.msg91).to.deep.equal({disabled: false, type: 'http', url: URL})
  })

  it('appends a Codex table once', () => {
    const out = renderCodex('model = "o3"\n', 'msg91', URL) as string
    expect(out).to.equal(`model = "o3"\n\n[mcp_servers.msg91]\nurl = "${URL}"\n`)
    expect(renderCodex(out, 'msg91', URL)).to.equal(null)
  })

  it('only touches installed tools, and never rewrites a file it cannot read', async () => {
    const home = await mkdtemp(join(tmpdir(), 'docstar-agents-'))
    try {
      await mkdir(join(home, '.cursor'))
      await mkdir(join(home, '.codex'))
      await mkdir(join(home, '.factory'))
      await writeFile(join(home, '.factory', 'mcp.json'), '{ not json')

      const dry = installMcp('msg91', URL, {claudeCode: false, dryRun: true, home})
      expect(dry.map((result) => result.status)).to.deep.equal(['would-add', 'would-add', 'failed'])

      const done = installMcp('msg91', URL, {claudeCode: false, home})
      expect(done.map((result) => [result.tool, result.status])).to.deep.equal([
        ['Cursor', 'added'],
        ['OpenAI Codex', 'added'],
        ['Factory Droid', 'failed'],
      ])
      expect(await readFile(join(home, '.factory', 'mcp.json'), 'utf8')).to.equal('{ not json')
      expect(await readFile(join(home, '.codex', 'config.toml'), 'utf8')).to.include('[mcp_servers.msg91]')

      const again = installMcp('msg91', URL, {claudeCode: false, home})
      expect(again.slice(0, 2).map((result) => result.status)).to.deep.equal(['already', 'already'])
    } finally {
      await rm(home, {force: true, recursive: true})
    }
  })
})
