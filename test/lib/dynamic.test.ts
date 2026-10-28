import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {runDynamic} from '../../src/lib/dynamic.js'
import {ExitSignal, type RunIo} from '../../src/lib/run.js'

// The docs as DocStar serves them: a module's index, and one endpoint's contract
const entry = (name: string, required: string[] = []) => ({
  aliases: [name],
  command: name,
  credentials: [{in: 'header', name: 'authkey'}],
  description: `${name} endpoint`,
  headers: ['authkey'],
  link: `https://docs.acme.test/${name}/module.json`,
  method: 'GET',
  name,
  parameters: {optional: ['note'], required},
  path: name,
})

const contract = (name: string, required: string[] = []) => ({
  auth: null,
  endpoint: {
    baseUrl: 'https://api.acme.test',
    body: {},
    cli: {command: {aliases: [name], name}, description: `${name} endpoint`, name, parameters: {optional: ['note'], required}, version: 1},
    description: `${name} endpoint`,
    headers: {authkey: {checked: 'true', credential: 'apiKey', value: ''}},
    method: 'GET',
    params: {
      note: {checked: 'true', value: ''},
      ...Object.fromEntries(required.map((param) => [param, {checked: 'true', value: ''}])),
    },
    pathVariables: {},
    sampleResponse: {},
    url: `/${name}?note=&amp;${required.map((param) => `${param}=`).join('&amp;')}`,
  },
  module: {id: 'acme', name: 'Acme', version: '1'},
})

describe('runDynamic (a collection nobody ran init for)', () => {
  const realFetch = globalThis.fetch
  const realHome = {HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE}
  let home: string
  let apiCalls: Array<{headers: Record<string, string>; url: string}>

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'docstar-dynamic-'))
    process.env.HOME = home
    process.env.USERPROFILE = home
    apiCalls = []
    globalThis.fetch = (async (url: string, init?: {headers?: Record<string, string>}) => {
      const text = String(url)
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}, status})
      if (text.includes('/p/generate-module-json')) {
        const query = new URL(text).searchParams
        const path = query.get('path')
        if (query.get('slug') !== 'acme') return json({error: 'Collection not found'}, 404)
        if (path === 'sms/send-sms' || path === 'sms/text') return json(contract('send-sms', ['to']))
        if (path === 'ping') return json(contract('ping'))
        if (path === 'sms') return json({auth: null, endpoints: [entry('send-sms', ['to'])], module: {id: 'sms', name: 'SMS', version: '1'}})
        if (query.get('scope') === 'root') return json({auth: null, endpoints: [entry('ping')], module: {id: 'acme', name: 'Root', version: '1'}})
        if (path) return json({error: 'Endpoint not found'}, 404)
        return json({auth: null, collection: {id: '1', name: 'Acme', slug: 'acme'}, modules: [{endpointCount: 1, name: 'SMS', path: 'sms'}], rootEndpoints: [{name: 'Ping', path: 'ping'}]})
      }

      apiCalls.push({headers: init?.headers || {}, url: text})
      return json({sent: true})
    }) as typeof fetch
  })

  afterEach(async () => {
    globalThis.fetch = realFetch
    process.env.HOME = realHome.HOME
    process.env.USERPROFILE = realHome.USERPROFILE
    await rm(home, {force: true, recursive: true})
  })

  const run = async (...args: string[]) => {
    const logs: string[] = []
    const errors: string[] = []
    const io: RunIo = {
      error(message, options) {
        errors.push(message)
        throw new ExitSignal(options?.exit ?? 1)
      },
      exit(code) {
        throw new ExitSignal(code)
      },
      log: (line) => void logs.push(line),
      async login() {},
    }
    const realError = console.error
    console.error = (line: string) => void errors.push(line)
    try {
      return {code: await runDynamic(args, io), errors, logs}
    } finally {
      console.error = realError
    }
  }

  it('makes one request to the docs for a command, then the call', async () => {
    const docs: string[] = []
    const inner = globalThis.fetch
    globalThis.fetch = (async (url: string, init?: never) => {
      docs.push(String(url))
      return inner(url, init)
    }) as typeof fetch
    await run('acme', 'sms', 'send-sms', '--to', '1', '--authkey', 'K')
    expect(docs.filter((url) => url.includes('/p/generate-module-json'))).to.have.length(1)
    expect(docs[0]).to.include('path=sms%2Fsend-sms')
  })

  it('finds the endpoint by an alias the server resolves', async () => {
    const {code} = await run('acme', 'sms', 'text', '--to', '1', '--authkey', 'K')
    expect(code).to.equal(0)
    expect(apiCalls[0].url).to.equal('https://api.acme.test/send-sms?note=&to=1'.replace('note=&', ''))
  })

  it('runs module + endpoint from the live docs, with flags', async () => {
    const {code, logs} = await run('acme', 'sms', 'send-sms', '--to', '123', '--authkey', 'K')
    expect(code).to.equal(0)
    expect(logs.join('')).to.contain('"sent": true')
    expect(apiCalls[0].url).to.equal('https://api.acme.test/send-sms?to=123')
    expect(apiCalls[0].headers.authkey).to.equal('K')
  })

  it('puts an optional query flag in the URL, and leaves it out when not given', async () => {
    await run('acme', 'sms', 'send-sms', '--to', '1', '--note', 'hi there', '--authkey', 'K')
    expect(apiCalls[0].url).to.equal('https://api.acme.test/send-sms?note=hi+there&to=1')
  })

  it('runs a root endpoint as `<slug> <endpoint>`', async () => {
    const {code} = await run('acme', 'ping', '--authkey', 'K')
    expect(code).to.equal(0)
    expect(apiCalls[0].url).to.equal('https://api.acme.test/ping')
  })

  it('lists a module’s endpoints, and the collection’s modules', async () => {
    expect((await run('acme', 'sms')).logs.join('\n')).to.contain('send-sms')
    expect((await run('acme')).logs.join('\n')).to.contain('sms — 1 endpoint')
  })

  it('--help prints the flags without calling the API', async () => {
    const {code, logs} = await run('acme', 'sms', 'send-sms', '--help')
    expect(code).to.equal(0)
    expect(logs.join('\n')).to.contain('--to=<value>').and.contain('--authkey=<value>')
    expect(apiCalls).to.have.length(0)
  })

  it('rejects a flag the endpoint does not have', async () => {
    const {code, errors} = await run('acme', 'sms', 'send-sms', '--nope', 'x')
    expect(code).to.equal(1)
    expect(errors.join('\n')).to.include('--to')
    expect(apiCalls).to.have.length(0)
  })

  it('stops with exit 4 before calling when the API key is missing and nobody can be asked', async () => {
    const {code, errors} = await run('acme', 'sms', 'send-sms', '--to', '1')
    expect(code).to.equal(4)
    expect(errors.join('\n')).to.include('config set acme authkey')
    expect(apiCalls).to.have.length(0)
  })

  it('names the endpoints there are when one is not found', async () => {
    const {code, errors} = await run('acme', 'sms', 'nope')
    expect(code).to.equal(1)
    expect(errors.join('\n')).to.include('No endpoint "nope" in acme sms').and.include('Available: send-sms')
  })

  it('says so when the word is not a collection', async () => {
    const {code, errors} = await run('lst')
    expect(code).to.equal(1)
    expect(errors.join('\n')).to.include('No collection "lst"').and.include('--help')
  })
})
