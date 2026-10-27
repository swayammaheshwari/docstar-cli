import {expect} from 'chai'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {EndpointContract} from '../../src/lib/types.js'

import {saveSignIn, type SignIn} from '../../src/lib/auth.js'
import {MissingCredentialError, storeCredential} from '../../src/lib/credentials.js'
import {endpointNeeds, executeCliCommand} from '../../src/lib/http.js'
import {configPath, modulePath} from '../../src/lib/paths.js'

type Call = {headers: Record<string, string>; url: string}

const stubFetch = (answers: Array<{body: unknown; status: number}>): Call[] => {
  const calls: Call[] = []
  globalThis.fetch = (async (url: string, init: {headers?: Record<string, string>}) => {
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
    await mkdir(join(home, '.docstar', 'modules', 'acme'), {recursive: true})
    await writeFile(configPath(), JSON.stringify({collections: [{modules: [{name: 'API', path: 'api'}], name: 'Acme', slug: 'acme', updatedAt: ''}]}))
    await writeFile(
      modulePath('acme', 'api'),
      JSON.stringify({
        endpoints: [
          endpoint('send-otp', {authkey: {credential: 'apiKey', value: 'your-authkey'}, 'Content-Type': {value: 'application/json'}}),
          endpoint('search', {}, {api_key: {credential: 'apiKey', value: 'x'}}, '/search?q=a&api_key=x'),
          endpoint('whoami', {Authorization: {value: 'Bearer TOKEN'}}),
          endpoint('openai-like', {Authorization: {credential: 'apiKey', value: 'Bearer KEY'}}),
          endpoint('custom', {'X-Token': {value: ''}}),
          endpoint('countries', {}),
        ],
        module: {id: 'api', name: 'API', version: '1'},
      }),
    )
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
      const error = await caught(executeCliCommand('acme', 'api', 'send-otp', {}))
      expect(error).to.be.instanceOf(MissingCredentialError)
      expect((error as MissingCredentialError).kind).to.equal('apiKey')
      expect((error as Error).message).to.include('docstar-cli config set acme authkey <your key>').and.not.include('.env')
      expect(calls).to.have.length(0)
    })

    it('sends the saved key, with the prefix key save stored', async () => {
      await storeCredential('acme', 'authkey', 'saved-key')
      await storeCredential('acme', 'Authorization', 'sk-1', {prefix: 'Bearer'})
      const calls = stubFetch([{body: {}, status: 200}, {body: {}, status: 200}])
      await executeCliCommand('acme', 'api', 'send-otp', {})
      await executeCliCommand('acme', 'api', 'openai-like', {})
      expect(calls[0].headers.authkey).to.equal('saved-key')
      expect(calls[1].headers.Authorization).to.equal('Bearer sk-1')
    })

    it('a flag wins over the saved key, and a query key goes in the URL', async () => {
      await storeCredential('acme', 'authkey', 'saved-key')
      const calls = stubFetch([{body: {}, status: 200}, {body: {}, status: 200}])
      await executeCliCommand('acme', 'api', 'send-otp', {authkey: 'flag-key'})
      await executeCliCommand('acme', 'api', 'search', {api_key: 'q-key'})
      expect(calls[0].headers.authkey).to.equal('flag-key')
      expect(calls[1].url).to.equal('https://api.acme.test/search?q=a&api_key=q-key')
    })

    it('a header marked as an API key never gets the sign-in token', async () => {
      await saveSignIn('acme', signIn())
      const error = await caught(executeCliCommand('acme', 'api', 'openai-like', {}))
      expect((error as MissingCredentialError).kind).to.equal('apiKey')
    })

    it('names the refused key and where it came from, never its value', async () => {
      await storeCredential('acme', 'authkey', 'secret-value')
      stubFetch([{body: {error: 'bad'}, status: 401}])
      const result = await executeCliCommand('acme', 'api', 'send-otp', {})
      expect(result.hint).to.include('"authkey"').and.include('config set').and.not.include('secret-value')
    })
  })

  describe('sign-in (the default)', () => {
    it('an endpoint that sends Authorization needs the sign-in, checked before calling', async () => {
      const calls = stubFetch([])
      const error = await caught(executeCliCommand('acme', 'api', 'whoami', {}))
      expect((error as MissingCredentialError).kind).to.equal('signIn')
      expect((error as Error).message).to.include('docstar-cli login acme')
      expect(calls).to.have.length(0)
    })

    it('sends the token in the sign-in header, replacing the docs value', async () => {
      await saveSignIn('acme', signIn())
      const calls = stubFetch([{body: {}, status: 200}])
      await executeCliCommand('acme', 'api', 'whoami', {})
      expect(calls[0].headers.Authorization).to.equal('Bearer AT')
    })

    it("uses the owner's sign-in header when it isn't Authorization", async () => {
      await saveSignIn('acme', signIn({tokenHeader: 'X-Token', tokenPrefix: ''}))
      const calls = stubFetch([{body: {}, status: 200}, {body: {}, status: 200}])
      await executeCliCommand('acme', 'api', 'custom', {})
      await executeCliCommand('acme', 'api', 'whoami', {})
      expect(calls[0].headers['X-Token']).to.equal('AT')
      expect(calls[1].headers.Authorization).to.equal('Bearer TOKEN')
    })

    it('a value the user saved or passed for the header is sent instead, with no sign-in needed', async () => {
      await storeCredential('acme', 'Authorization', 'pat-1', {prefix: 'Bearer'})
      const calls = stubFetch([{body: {}, status: 200}])
      await executeCliCommand('acme', 'api', 'whoami', {})
      expect(calls[0].headers.Authorization).to.equal('Bearer pat-1')
    })

    it('sends nothing for an endpoint without the sign-in header or an API key', async () => {
      await saveSignIn('acme', signIn())
      const calls = stubFetch([{body: [], status: 200}])
      await executeCliCommand('acme', 'api', 'countries', {})
      expect(calls[0].headers).to.deep.equal({})
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
