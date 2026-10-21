import {expect} from 'chai'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {generateCommandFile} from '../../src/lib/codegen.js'
import {ROOT_MODULE_PATH} from '../../src/lib/paths.js'
import type {EndpointContract} from '../../src/lib/types.js'

const endpoint = {
  baseUrl: null,
  body: {},
  cli: {command: {aliases: [], name: 'ping'}, description: 'Ping', name: 'ping', parameters: {optional: [], required: []}, version: 1},
  headers: {},
  method: 'GET',
  params: {},
  pathVariables: {},
  sampleResponse: {},
  url: 'https://example.com/ping',
} as unknown as EndpointContract

describe('generateCommandFile', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'docstar-codegen-'))
  })
  afterEach(async () => {
    await rm(root, {force: true, recursive: true})
  })

  it('writes module commands under <slug>/<module>/', async () => {
    const file = await generateCommandFile(root, 'acme', 'sms', endpoint)
    expect(file).to.equal(join(root, 'dist', 'commands', 'acme', 'sms', 'ping.js'))
    expect(await readFile(file, 'utf8')).to.contain("'../../../lib/http.js'")
  })

  it('writes root commands directly under <slug>/', async () => {
    const file = await generateCommandFile(root, 'acme', ROOT_MODULE_PATH, endpoint)
    expect(file).to.equal(join(root, 'dist', 'commands', 'acme', 'ping.js'))
    const content = await readFile(file, 'utf8')
    expect(content).to.contain("'../../lib/http.js'")
    expect(content).to.contain('executeCliCommand("acme", "__root__", "ping"')
  })
})
