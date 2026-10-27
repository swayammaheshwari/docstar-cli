import type {Command} from '@oclif/core'

import {expect} from 'chai'

import {MissingCredentialError} from '../../src/lib/credentials.js'
import {EXIT_CREDENTIAL_MISSING, runEndpoint} from '../../src/lib/run.js'

const call = {command: 'send', module: 'sms', slug: 'acme'}

const fakeCommand = () => {
  const logs: string[] = []
  const command = {
    error(message: string, options?: {exit?: number}) {
      throw Object.assign(new Error(message), {exit: options?.exit, oclif: {}})
    },
    exit(code: number) {
      throw Object.assign(new Error('exit'), {exit: code, oclif: {}})
    },
    log: (line: string) => logs.push(line),
  }
  return {command: command as unknown as Command, logs}
}

describe('runEndpoint', () => {
  it('asks for every missing credential, however many, then makes the call', async () => {
    const {command, logs} = fakeCommand()
    const missing = [
      new MissingCredentialError('acme', 'apiKey', 'k1'),
      new MissingCredentialError('acme', 'apiKey', 'k2'),
      new MissingCredentialError('acme', 'apiKey', 'k3'),
      new MissingCredentialError('acme', 'signIn', 'Authorization'),
    ]
    const asked: string[] = []
    await runEndpoint(command, call, {}, [], {
      ask: async (_c, error) => (asked.push(error.name), true),
      canAsk: () => true,
      execute: async () => {
        const next = missing.shift()
        if (next) throw next
        return {body: {ok: true}, status: 200}
      },
    })
    expect(asked).to.deep.equal(['k1', 'k2', 'k3', 'Authorization'])
    expect(logs.join('')).to.contain('"ok": true')
  })

  it('stops with exit 4 when the same credential is still missing after it was asked for', async () => {
    const {command} = fakeCommand()
    let calls = 0
    try {
      await runEndpoint(command, call, {}, [], {
        ask: async () => true,
        canAsk: () => true,
        execute: async () => {
          calls++
          throw new MissingCredentialError('acme', 'apiKey', 'k1')
        },
      })
      expect.fail('should have exited')
    } catch (error) {
      expect((error as {exit?: number}).exit).to.equal(EXIT_CREDENTIAL_MISSING)
    }

    expect(calls).to.equal(2)
  })

  it('does not ask when nobody is at a keyboard', async () => {
    const {command} = fakeCommand()
    try {
      await runEndpoint(command, call, {}, [], {
        ask: async () => expect.fail('must not ask'),
        canAsk: () => false,
        execute: async () => {
          throw new MissingCredentialError('acme', 'signIn', 'Authorization')
        },
      })
      expect.fail('should have exited')
    } catch (error) {
      expect((error as {exit?: number}).exit).to.equal(EXIT_CREDENTIAL_MISSING)
    }
  })
})
