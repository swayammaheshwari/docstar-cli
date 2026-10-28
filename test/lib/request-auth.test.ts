import {expect} from 'chai'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {EndpointContract} from '../../src/lib/types.js'

import {saveSignIn, type SignIn} from '../../src/lib/auth.js'
import {MissingCredentialError, storeCredential} from '../../src/lib/credentials.js'
import {endpointNeeds, executeEndpoint, signInHeaderOf} from '../../src/lib/http.js'
import {configPath} from '../../src/lib/paths.js'

type Call = {headers: Record<string, string>; url: string}

// The docs, as `generate-module-json` answers: every command reads them live. Not counted as an API call.
let contract: unknown = {}

// Runs one endpoint of `contract` by command name, as `executeCliCommand` does once it has read the endpoint's OpenAPI file
const exec = (command: string, params: Record<string, string>) => {
  const {auth, endpoints} = contract as {auth?: {headerName: string; tokenPrefix: string} | null; endpoints: EndpointContract[]}
  return executeEndpoint('acme', {auth}, endpoints.find((candidate) => candidate.cli.command.name === command)!, params)
}

const stubFetch = (answers: Array<{body: unknown; status: number}>): Call[] => {
  const calls: Call[] = []
  globalThis.fetch = (async (url: string, init: {headers?: Record<string, string>}) => {
    if (String(url).includes('/p/generate-module-json')) return new Response(JSON.stringify(contract), {headers: {'content-type': 'application/json'}, status: 200})
    calls.push({headers: init.headers || {}, url: String(url)})
    const answer = answers.shift()
    if (!answer) throw new Error(`unexpected call to ${url}`)
    return new Response(JSON.stringify(answer.body), {headers: {'content-type': 'application/json'}, status: answer.status})
  }) as typeof fetch
  return calls
}

const signIn = (overrides: Partial<SignIn> = {}): SignIn => ({
  accessToken: 'AT',
  api: 'https://api.docstar.test',
  collectionId: 'c1',
  expiresAt: Date.now() + 3_600_000,
  name: 'Acme',
  refreshToken: 'RT',
  signedInAt: '2026-10-26T00:00:00.000Z',
  tokenHeader: 'Authorization',
  tokenPrefix: 'Bearer',
  ...overrides,
})

const endpoint = (name: string, headers: Record<string, unknown>, params: Record<string, unknown> = {}, url = '/x') => ({
  baseUrl: 'https://api.acme.test',
  body: {},
  cli: {command: {aliases: [], name}, description: '', name, parameters: {optional: [], required: []}, version: 1},
  headers,
  method: 'GET',
  params,
  pathVariables: {},
  url,
})

describe('request authentication', () => {
  const realFetch = globalThis.fetch
  const realHome = {HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE}
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'docstar-request-auth-'))
    process.env.HOME = home
    process.env.USERPROFILE = home
    await mkdir(join(home, '.docstar'), {recursive: true})
    await writeFile(configPath(), JSON.stringify({collections: [{modules: [{name: 'API', path: 'api'}], name: 'Acme', slug: 'acme', updatedAt: ''}]}))
    contract =
      {
        endpoints: [
          endpoint('send-otp', {authkey: {credential: 'apiKey', value: 'your-authkey'}, 'Content-Type': {value: 'application/json'}}),
          endpoint('search', {}, {api_key: {credential: 'apiKey', value: 'x'}}, '/search?q=a&api_key=x'),
          endpoint('whoami', {Authorization: {value: 'Bearer TOKEN'}}),
          endpoint('openai-like', {Authorization: {credential: 'apiKey', value: 'Bearer KEY'}}),
          endpoint('custom', {'X-Token': {value: ''}}),
          endpoint('countries', {}),
        ],
        module: {id: 'api', name: 'API', version: '1'},
      }
  })

  afterEach(async () => {
    globalThis.fetch = realFetch
    process.env.HOME = realHome.HOME
    process.env.USERPROFILE = realHome.USERPROFILE
    await rm(home, {force: true, recursive: true})
  })

  const caught = async (promise: Promise<unknown>): Promise<unknown> => promise.then(() => null, (error: unknown) => error)

  describe('API keys (only where the owner marked them)', () => {
    it('stops before calling when none is saved', async () => {
      const calls = stubFetch([])
      const error = await caught(exec('send-otp', {}))
      expect(error).to.be.instanceOf(MissingCredentialError)
      expect((error as MissingCredentialError).kind).to.equal('apiKey')
      expect((error as Error).message).to.include('docstar-cli config set acme authkey <your key>').and.not.include('.env')
      expect(calls).to.have.length(0)
    })

    it('sends the saved key, with the prefix key save stored', async () => {
      await storeCredential('acme', 'authkey', 'saved-key')
      await storeCredential('acme', 'Authorization', 'sk-1', {prefix: 'Bearer'})
      const calls = stubFetch([{body: {}, status: 200}, {body: {}, status: 200}])
      await exec('send-otp', {})
      await exec('openai-like', {})
      expect(calls[0].headers.authkey).to.equal('saved-key')
      expect(calls[1].headers.Authorization).to.equal('Bearer sk-1')
    })

    it('a flag wins over the saved key, and a query key goes in the URL', async () => {
      await storeCredential('acme', 'authkey', 'saved-key')
      const calls = stubFetch([{body: {}, status: 200}, {body: {}, status: 200}])
      await exec('send-otp', {authkey: 'flag-key'})
      await exec('search', {api_key: 'q-key'})
      expect(calls[0].headers.authkey).to.equal('flag-key')
      expect(calls[1].url).to.equal('https://api.acme.test/search?q=a&api_key=q-key')
    })

    it('a header marked as an API key never gets the sign-in token', async () => {
      await saveSignIn('acme', signIn())
      stubFetch([])
      const error = await caught(exec('openai-like', {}))
      expect((error as MissingCredentialError).kind).to.equal('apiKey')
    })

    it('names the refused key and where it came from, never its value', async () => {
      await storeCredential('acme', 'authkey', 'secret-value')
      stubFetch([{body: {error: 'bad'}, status: 401}])
      const result = await exec('send-otp', {})
      expect(result.hint).to.include('"authkey"').and.include('config set').and.not.include('secret-value')
    })
  })

  describe('sign-in (the default)', () => {
    it('an endpoint that sends Authorization needs the sign-in, checked before calling', async () => {
      const calls = stubFetch([])
      const error = await caught(exec('whoami', {}))
      expect((error as MissingCredentialError).kind).to.equal('signIn')
      expect((error as Error).message).to.include('docstar-cli login acme')
      expect(calls).to.have.length(0)
    })

    it('sends the token in the sign-in header, replacing the docs value', async () => {
      await saveSignIn('acme', signIn())
      const calls = stubFetch([{body: {}, status: 200}])
      await exec('whoami', {})
      expect(calls[0].headers.Authorization).to.equal('Bearer AT')
    })

    it("uses the owner's sign-in header when it isn't Authorization", async () => {
      await saveSignIn('acme', signIn({tokenHeader: 'X-Token', tokenPrefix: ''}))
      const calls = stubFetch([{body: {}, status: 200}, {body: {}, status: 200}])
      await exec('custom', {})
      await exec('whoami', {})
      expect(calls[0].headers['X-Token']).to.equal('AT')
      expect(calls[1].headers.Authorization).to.equal('Bearer TOKEN')
    })

    it('a value the user saved or passed for the header is sent instead, with no sign-in needed', async () => {
      await storeCredential('acme', 'Authorization', 'pat-1', {prefix: 'Bearer'})
      const calls = stubFetch([{body: {}, status: 200}])
      await exec('whoami', {})
      expect(calls[0].headers.Authorization).to.equal('Bearer pat-1')
    })

    it('sends nothing for an endpoint without the sign-in header or an API key', async () => {
      await saveSignIn('acme', signIn())
      const calls = stubFetch([{body: [], status: 200}])
      await exec('countries', {})
      expect(calls[0].headers).to.deep.equal({})
    })
  })

  describe("the collection's sign-in header (module.json auth)", () => {
    const proxy = {headerName: 'proxy_auth_token', tokenPrefix: ''}
    const withProxy = endpoint('proxied', {proxy_auth_token: {value: ''}, 'Content-Type': {value: 'application/json'}}) as unknown as EndpointContract
    const bearer = endpoint('whoami', {Authorization: {value: 'Bearer TOKEN'}}) as unknown as EndpointContract

    it('an endpoint sending that header runs on the sign-in, and says to run login when signed out', async () => {
      contract = {auth: proxy, endpoints: [withProxy], module: {id: 'api', name: 'API', version: '1'}}
      const calls = stubFetch([])
      const error = await caught(exec('proxied', {}))
      expect((error as MissingCredentialError).kind).to.equal('signIn')
      expect((error as Error).message).to.include('docstar-cli login acme')
      expect(calls).to.have.length(0)
    })

    it('sends the token in that header with no prefix', async () => {
      await saveSignIn('acme', signIn())
      contract = {auth: proxy, endpoints: [withProxy], module: {id: 'api', name: 'API', version: '1'}}
      const calls = stubFetch([{body: {}, status: 200}])
      await exec('proxied', {})
      expect(calls[0].headers.proxy_auth_token).to.equal('AT')
      expect(calls[0].headers.Authorization).to.equal(undefined)
    })

    it('Authorization is an ordinary header (asked for as it is) when the sign-in header is another one', async () => {
      const calls = stubFetch([])
      const error = await caught(executeEndpoint('acme', {auth: proxy}, endpoint('x', {Authorization: {value: ''}}) as unknown as EndpointContract, {}))
      expect((error as MissingCredentialError).kind).to.equal('apiKey')
      expect((error as MissingCredentialError).name).to.equal('Authorization')
      expect(calls).to.have.length(0)
    })

    it('a collection without sign-in (auth null) never asks for login', async () => {
      const calls = stubFetch([{body: {}, status: 200}])
      await executeEndpoint('acme', {auth: null}, bearer, {})
      expect(calls[0].headers.Authorization).to.equal('Bearer TOKEN')
    })

    it('a header with no value and no sign-in role is asked for as it is, and sent once given', async () => {
      const custom = endpoint('custom', {'X-Token': {value: ''}}) as unknown as EndpointContract
      const error = await caught(executeEndpoint('acme', {auth: null}, custom, {}))
      expect((error as MissingCredentialError).kind).to.equal('apiKey')
      const calls = stubFetch([{body: {}, status: 200}])
      await executeEndpoint('acme', {auth: null}, custom, {'X-Token': 'mine'})
      expect(calls[0].headers['X-Token']).to.equal('mine')
    })

    it('picks the header: the docs say, null means none, an older API falls back', () => {
      expect(signInHeaderOf(proxy)).to.equal('proxy_auth_token')
      expect(signInHeaderOf(null, 'X-Token')).to.equal(null)
      expect(signInHeaderOf(undefined, 'X-Token')).to.equal('X-Token')
      expect(signInHeaderOf(undefined)).to.equal('Authorization')
    })
  })

  describe("query parameters (the docs' URL carries them as typed, e.g. startDate=&amp;endDate=)", () => {
    const analytics = {
      ...endpoint('analytics', {accept: {value: 'application/json'}}, {endDate: {checked: 'true', value: ''}, startDate: {checked: 'true', value: ''}}),
      url: 'https://api.acme.test/report?startDate=&amp;endDate=',
    } as unknown as EndpointContract

    it('leaves an empty parameter out, and a flag sets its value', async () => {
      const calls = stubFetch([{body: {}, status: 200}, {body: {}, status: 200}])
      await executeEndpoint('acme', {auth: null}, analytics, {})
      await executeEndpoint('acme', {auth: null}, analytics, {startDate: '2026-01-01'})
      expect(calls[0].url).to.equal('https://api.acme.test/report')
      expect(calls[1].url).to.equal('https://api.acme.test/report?startDate=2026-01-01')
    })

    it("keeps the docs' own value for a parameter the user did not give, and a query the params do not describe", async () => {
      const withDefaults = {
        ...endpoint('x', {}, {format: {checked: 'true', value: 'json'}}),
        url: 'https://api.acme.test/x?mode=read&amp;format=json',
      } as unknown as EndpointContract
      const calls = stubFetch([{body: {}, status: 200}, {body: {}, status: 200}])
      await executeEndpoint('acme', {auth: null}, withDefaults, {})
      await executeEndpoint('acme', {auth: null}, withDefaults, {format: 'csv'})
      expect(calls[0].url).to.equal('https://api.acme.test/x?mode=read&format=json')
      expect(calls[1].url).to.equal('https://api.acme.test/x?mode=read&format=csv')
    })
  })

  it('says what an endpoint needs', () => {
    expect(endpointNeeds(endpoint('a', {authkey: {credential: 'apiKey'}}) as unknown as EndpointContract)).to.deep.equal({apiKeys: ['authkey'], signIn: false})
    expect(endpointNeeds(endpoint('d', {'<span text-block="true">authkey</span>': {credential: 'apiKey'}}, {k: {credential: 'apiKey'}}) as unknown as EndpointContract).apiKeys).to.deep.equal(['authkey', 'k'])
    expect(endpointNeeds(endpoint('e', {authkey: {checked: 'false', credential: 'apiKey'}}) as unknown as EndpointContract).apiKeys).to.deep.equal([])
    expect(endpointNeeds(endpoint('b', {authorization: {}}) as unknown as EndpointContract)).to.deep.equal({apiKeys: [], signIn: true})
    expect(endpointNeeds(endpoint('c', {Authorization: {checked: 'false'}}) as unknown as EndpointContract).signIn).to.equal(false)
  })
})
