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
    expect(await readFile(file, 'utf8')).to.contain("'../../../lib/run.js'")
  })

  it('writes root commands directly under <slug>/', async () => {
    const file = await generateCommandFile(root, 'acme', ROOT_MODULE_PATH, endpoint)
    expect(file).to.equal(join(root, 'dist', 'commands', 'acme', 'ping.js'))
    const content = await readFile(file, 'utf8')
    expect(content).to.contain("'../../lib/run.js'")
    expect(content).to.contain('runEndpoint(this, {slug: "acme", module: "__root__", command: "ping"}')
  })

  it('says in --help which API key the command needs, and when it runs on the sign-in', async () => {
    const withKey = {...endpoint, headers: {authkey: {credential: 'apiKey', value: ''}}} as unknown as EndpointContract
    const keyContent = await readFile(await generateCommandFile(root, 'acme', 'sms', withKey), 'utf8')
    expect(keyContent).to.contain('Needs your acme API key \\"authkey\\"')
    expect(keyContent).to.contain('Your API key (or save it with `config set`)')
    const withSignIn = {...endpoint, cli: {...endpoint.cli, command: {aliases: [], name: 'me'}}, headers: {Authorization: {value: 'Bearer <token>'}}} as unknown as EndpointContract
    const signInContent = await readFile(await generateCommandFile(root, 'acme', 'sms', withSignIn), 'utf8')
    expect(signInContent).to.contain('Runs on your sign-in: docstar-cli login acme')
  })
})
