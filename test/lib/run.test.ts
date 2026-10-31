import {expect} from 'chai'

import {MissingCredentialError} from '../../src/lib/credentials.js'
import {InvalidParamError} from '../../src/lib/http.js'
import {EXIT_BAD_USAGE, EXIT_CREDENTIAL_MISSING, ExitSignal, runEndpoint, type RunIo} from '../../src/lib/run.js'

const fakeIo = () => {
  const logs: string[] = []
  const io: RunIo = {
    error(_message, options) {
      throw new ExitSignal(options?.exit ?? 1)
    },
    exit(code) {
      throw new ExitSignal(code)
    },
    log: (line) => void logs.push(line),
    async login() {},
  }
  return {io, logs}
}

const exitCodeOf = async (promise: Promise<unknown>): Promise<number | undefined> =>
  promise.then(
    () => undefined,
    (error: unknown) => (error instanceof ExitSignal ? error.code : -1),
  )

describe('runEndpoint', () => {
  it('exits 2 naming the missing flags, without prompting, when nobody is at a keyboard', async () => {
    const {io} = fakeIo()
    let calls = 0
    const code = await exitCodeOf(
      runEndpoint(io, {execute: async () => (calls++, {body: {}, status: 200})}, {a: '1'}, ['a', 'b', 'c'], {ask: async () => true, canAsk: () => false}),
    )
    expect(code).to.equal(EXIT_BAD_USAGE)
    expect(calls).to.equal(0)
  })

  it('exits 2 for a value with the wrong shape', async () => {
    const {io} = fakeIo()
    const code = await exitCodeOf(
      runEndpoint(io, {execute: async () => Promise.reject(new InvalidParamError('--payload must be a JSON object'))}, {}, [], {ask: async () => true, canAsk: () => true}),
    )
    expect(code).to.equal(EXIT_BAD_USAGE)
  })

  it('asks for every missing credential, however many, then makes the call', async () => {
    const {io, logs} = fakeIo()
    const missing = [
      new MissingCredentialError('acme', 'apiKey', 'k1'),
      new MissingCredentialError('acme', 'apiKey', 'k2'),
      new MissingCredentialError('acme', 'apiKey', 'k3'),
      new MissingCredentialError('acme', 'signIn', 'Authorization'),
    ]
    const asked: string[] = []
    await runEndpoint(
      io,
      {
        execute: async () => {
          const next = missing.shift()
          if (next) throw next
          return {body: {ok: true}, status: 200}
        },
      },
      {},
      [],
      {ask: async (_io, error) => (asked.push(error.name), true), canAsk: () => true},
    )
    expect(asked).to.deep.equal(['k1', 'k2', 'k3', 'Authorization'])
    expect(logs.join('')).to.contain('"ok": true')
  })

  it('stops with exit 4 when the same credential is still missing after it was asked for', async () => {
    const {io} = fakeIo()
    let calls = 0
    const code = await exitCodeOf(
      runEndpoint(
        io,
        {
          execute: async () => {
            calls++
            throw new MissingCredentialError('acme', 'apiKey', 'k1')
          },
        },
        {},
        [],
        {ask: async () => true, canAsk: () => true},
      ),
    )
    expect(code).to.equal(EXIT_CREDENTIAL_MISSING)
    expect(calls).to.equal(2)
  })

  it('does not ask when nobody is at a keyboard', async () => {
    const {io} = fakeIo()
    const code = await exitCodeOf(
      runEndpoint(
        io,
        {
          execute: async () => {
            throw new MissingCredentialError('acme', 'signIn', 'Authorization')
          },
        },
        {},
        [],
        {ask: async () => expect.fail('must not ask'), canAsk: () => false},
      ),
    )
    expect(code).to.equal(EXIT_CREDENTIAL_MISSING)
  })

  it('exits 1 when the API answers with an error', async () => {
    const {io} = fakeIo()
    const code = await exitCodeOf(runEndpoint(io, {execute: async () => ({body: {}, status: 500})}, {}, [], {ask: async () => false, canAsk: () => false}))
    expect(code).to.equal(1)
  })
})
