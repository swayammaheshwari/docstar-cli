import {expect} from 'chai'
import {mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  getSignIn,
  saveSignIn,
  type SignIn,
  SignInExpiredError,
  signInFromTokens,
  waitForSignIn,
  withToken,
} from '../../src/lib/auth.js'
import {executeCliCommand} from '../../src/lib/http.js'
import {credentialsPath, modulePath} from '../../src/lib/paths.js'

const API = 'https://api.docstar.test'

const signIn = (overrides: Partial<SignIn> = {}): SignIn => ({
  accessToken: 'AT-old',
  api: API,
  collectionId: 'c1',
  expiresAt: Date.now() + 3_600_000,
  name: 'Acme',
  refreshToken: 'RT',
  signedInAt: '2026-10-24T00:00:00.000Z',
  tokenHeader: 'Authorization',
  tokenPrefix: 'Bearer',
  ...overrides,
})

type Call = {body?: string; headers: Record<string, string>; url: string}

// Answers fetch calls in order from `answers`, recording each call
const stubFetch = (answers: Array<{body: unknown; status: number}>): Call[] => {
  const calls: Call[] = []
  globalThis.fetch = (async (url: string, init: {body?: string; headers?: Record<string, string>}) => {
    calls.push({body: init.body, headers: init.headers || {}, url: String(url)})
    const answer = answers.shift()
    if (!answer) throw new Error(`unexpected call to ${url}`)
    return new Response(JSON.stringify(answer.body), {headers: {'content-type': 'application/json'}, status: answer.status})
  }) as typeof fetch
  return calls
}

describe('auth', () => {
  const realFetch = globalThis.fetch
  const realHome = process.env.HOME
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'docstar-auth-'))
    process.env.HOME = home
  })

  afterEach(async () => {
    globalThis.fetch = realFetch
    process.env.HOME = realHome
    await rm(home, {force: true, recursive: true})
  })

  describe('withToken', () => {
    it("puts the token in the endpoint's header, replacing the docs' value in any case", () => {
      const {headers, sent} = withToken({authorization: 'Bearer <token>', 'Content-Type': 'application/json'}, null, signIn(), [])
      expect(sent).to.equal(true)
      expect(headers).to.deep.equal({Authorization: 'Bearer AT-old', 'Content-Type': 'application/json'})
    })

    it("uses the endpoint's own token header and scheme over the sign-in's", () => {
      const {headers} = withToken({authkey: 'xxx'}, {tokenHeader: 'authkey', tokenPrefix: ''}, signIn(), [])
      expect(headers).to.deep.equal({authkey: 'AT-old'})
    })

    it('keeps a value the user gave for the token header', () => {
      const {headers, sent} = withToken({Authorization: 'Bearer mine'}, null, signIn(), ['authorization'])
      expect(sent).to.equal(false)
      expect(headers).to.deep.equal({Authorization: 'Bearer mine'})
    })

    it('sends nothing extra when not signed in', () => {
      expect(withToken({a: '1'}, null, null, [])).to.deep.equal({headers: {a: '1'}, sent: false})
    })
  })

  it('saves sign-ins readable by the owner only', async () => {
    await saveSignIn('acme', signIn())
    expect((await stat(credentialsPath())).mode.toString(8).slice(-3)).to.equal('600')
    expect((await getSignIn('acme'))?.accessToken).to.equal('AT-old')
  })

  it('works out when the token expires', () => {
    const now = 1_000_000
    const result = signInFromTokens(API, {id: 'c1', name: 'Acme'}, {accessToken: 'AT', expiresIn: 60, refreshToken: null, tokenHeader: 'X-Token', tokenPrefix: ''}, now)
    expect(result).to.include({expiresAt: now + 60_000, tokenHeader: 'X-Token', tokenPrefix: ''})
  })

  describe('waitForSignIn', () => {
    const pending = {expiresAt: Date.now() + 60_000, interval: 2, pollSecret: 'ps', sessionId: 's'}
    const noSleep = async () => {}

    it('polls until the user has signed in', async () => {
      const calls = stubFetch([
        {body: {status: 'pending'}, status: 202},
        {body: {accessToken: 'AT', expiresIn: 60, refreshToken: 'RT', tokenHeader: 'Authorization', tokenPrefix: 'Bearer'}, status: 200},
      ])
      const tokens = await waitForSignIn(API, pending, noSleep)
      expect(tokens.accessToken).to.equal('AT')
      expect(calls).to.have.length(2)
      expect(JSON.parse(calls[0].body!)).to.deep.equal({pollSecret: 'ps', sessionId: 's'})
    })

    it("stops with the sign-in's error", async () => {
      stubFetch([{body: {error: 'Sign-in was cancelled or refused: access_denied'}, status: 400}])
      let message = ''
      await waitForSignIn(API, pending, noSleep).catch((error: Error) => {
        message = error.message
      })
      expect(message).to.match(/access_denied/)
    })
  })

  describe('calling an endpoint while signed in', () => {
    beforeEach(async () => {
      await mkdir(join(home, '.docstar', 'modules', 'acme'), {recursive: true})
      await writeFile(
        modulePath('acme', 'apps'),
        JSON.stringify({
          endpoints: [
            {
              auth: null,
              baseUrl: 'https://api.acme.test',
              body: {},
              cli: {command: {aliases: [], name: 'list-apps'}, description: '', name: 'list-apps', parameters: {optional: [], required: []}, version: 1},
              headers: {Authorization: {value: 'Bearer <token>'}},
              method: 'GET',
              params: {},
              pathVariables: {},
              url: '/apps',
            },
          ],
          module: {id: 'apps', name: 'Apps', version: '1.0.0'},
        }),
      )
    })

    it('sends the token', async () => {
      await saveSignIn('acme', signIn())
      const calls = stubFetch([{body: [{id: 1}], status: 200}])
      const result = await executeCliCommand('acme', 'apps', 'list-apps', {})
      expect(result).to.deep.equal({body: [{id: 1}], status: 200})
      expect(calls[0].headers.Authorization).to.equal('Bearer AT-old')
    })

    it('refreshes an expired token before the call', async () => {
      await saveSignIn('acme', signIn({expiresAt: Date.now() - 1000}))
      const calls = stubFetch([
        {body: {accessToken: 'AT-new', expiresIn: 3600, refreshToken: null, tokenHeader: 'Authorization', tokenPrefix: 'Bearer'}, status: 200},
        {body: [], status: 200},
      ])
      await executeCliCommand('acme', 'apps', 'list-apps', {})
      expect(calls[0].url).to.equal(`${API}/p/cli-auth/refresh`)
      expect(JSON.parse(calls[0].body!)).to.deep.equal({collectionId: 'c1', refreshToken: 'RT'})
      expect(calls[1].headers.Authorization).to.equal('Bearer AT-new')
      const saved = await getSignIn('acme')
      expect(saved).to.include({accessToken: 'AT-new', refreshToken: 'RT'})
    })

    it('refreshes and retries once when the API refuses the token', async () => {
      await saveSignIn('acme', signIn())
      const calls = stubFetch([
        {body: {error: 'expired'}, status: 401},
        {body: {accessToken: 'AT-new', expiresIn: 3600, refreshToken: 'RT2', tokenHeader: 'Authorization', tokenPrefix: 'Bearer'}, status: 200},
        {body: {ok: true}, status: 200},
      ])
      const result = await executeCliCommand('acme', 'apps', 'list-apps', {})
      expect(result.status).to.equal(200)
      expect(calls[2].headers.Authorization).to.equal('Bearer AT-new')
      expect((await getSignIn('acme'))?.refreshToken).to.equal('RT2')
    })

    it('ends the sign-in when the refresh is refused', async () => {
      await saveSignIn('acme', signIn())
      stubFetch([
        {body: {error: 'expired'}, status: 401},
        {body: {error: 'Your sign-in has expired'}, status: 401},
      ])
      let caught: unknown
      await executeCliCommand('acme', 'apps', 'list-apps', {}).catch((error: unknown) => {
        caught = error
      })
      expect(caught).to.be.instanceOf(SignInExpiredError)
      expect(await getSignIn('acme')).to.equal(null)
    })

    it('says how to sign in when the API refuses a call without one', async () => {
      stubFetch([{body: {error: 'unauthorized'}, status: 401}])
      const result = await executeCliCommand('acme', 'apps', 'list-apps', {})
      expect(result.hint).to.match(/docstar-cli login acme/)
    })
  })
})
