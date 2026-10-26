import {expect} from 'chai'
import {mkdtemp, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createKeyRequest, decryptKeyPayload, encryptKeyPayload, pendingKeysDir} from '../../src/lib/key-crypto.js'

const body = () => ({envVar: 'MSG91_AUTH_KEY', expiresAt: Date.now() + 60_000, key: 'sk_live_abc123wxyz'})

describe('keyCrypto', () => {
  let home: string
  let originalHome: string | undefined

  beforeEach(async () => {
    originalHome = process.env.HOME
    home = await mkdtemp(join(tmpdir(), 'docstar-keys-'))
    process.env.HOME = home
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await rm(home, {force: true, recursive: true})
  })

  it('opens what was encrypted to the request, and the private key is private to its owner', async () => {
    const {publicKey} = await createKeyRequest()
    const opened = await decryptKeyPayload(encryptKeyPayload(publicKey, body()))
    expect(opened.body.key).to.equal('sk_live_abc123wxyz')
    expect(opened.body.envVar).to.equal('MSG91_AUTH_KEY')
    expect((await stat(pendingKeysDir())).mode.toString(8).slice(-3)).to.equal('700')
    expect((await stat(join(pendingKeysDir(), `${publicKey}.json`))).mode.toString(8).slice(-3)).to.equal('600')
  })

  it('does not contain the key in plain text', async () => {
    const {publicKey} = await createKeyRequest()
    const payload = encryptKeyPayload(publicKey, body())
    expect(Buffer.from(payload, 'base64url').toString()).to.not.include('sk_live_abc123wxyz')
  })

  it('stops working once the request is forgotten', async () => {
    const {publicKey} = await createKeyRequest()
    const payload = encryptKeyPayload(publicKey, body())
    await (await decryptKeyPayload(payload)).forget()
    let message = ''
    await decryptKeyPayload(payload).catch((error: Error) => {
      message = error.message
    })
    expect(message).to.include('No pending key request')
  })

  it('rejects a payload for a different request', async () => {
    const first = await createKeyRequest()
    const second = await createKeyRequest()
    const payload = encryptKeyPayload(first.publicKey, body())
    const forged = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {requestId: string}
    forged.requestId = second.publicKey
    let message = ''
    await decryptKeyPayload(Buffer.from(JSON.stringify(forged)).toString('base64url')).catch((error: Error) => {
      message = error.message
    })
    expect(message).to.include('could not be opened')
  })

  it('rejects a changed payload', async () => {
    const {publicKey} = await createKeyRequest()
    const payload = JSON.parse(Buffer.from(encryptKeyPayload(publicKey, body()), 'base64url').toString()) as {ct: string}
    const bytes = Buffer.from(payload.ct, 'base64url')
    bytes[0] = bytes[0] === 0 ? 1 : 0
    payload.ct = bytes.toString('base64url')
    let message = ''
    await decryptKeyPayload(Buffer.from(JSON.stringify(payload)).toString('base64url')).catch((error: Error) => {
      message = error.message
    })
    expect(message).to.include('could not be opened')
  })

  it('rejects an expired payload', async () => {
    const {publicKey} = await createKeyRequest()
    const payload = encryptKeyPayload(publicKey, {...body(), expiresAt: Date.now() - 1})
    let message = ''
    await decryptKeyPayload(payload).catch((error: Error) => {
      message = error.message
    })
    expect(message).to.include('payload expired')
  })

  it('rejects an expired request and removes it', async () => {
    const {publicKey} = await createKeyRequest()
    const file = join(pendingKeysDir(), `${publicKey}.json`)
    const pending = JSON.parse(await readFile(file, 'utf8')) as {expiresAt: number}
    pending.expiresAt = Date.now() - 1
    await writeFile(file, JSON.stringify(pending))
    let message = ''
    await decryptKeyPayload(encryptKeyPayload(publicKey, body())).catch((error: Error) => {
      message = error.message
    })
    expect(message).to.include('request expired')
    expect(await readdir(pendingKeysDir())).to.deep.equal([])
  })

  it('rejects a variable name that is not an env variable', async () => {
    const {publicKey} = await createKeyRequest()
    let message = ''
    await decryptKeyPayload(encryptKeyPayload(publicKey, {...body(), envVar: 'bad name; rm -rf'})).catch((error: Error) => {
      message = error.message
    })
    expect(message).to.include('unexpected content')
  })

  it('does not accept a request id that points outside the folder', async () => {
    const forged = Buffer.from(JSON.stringify({ct: '', epk: '', iv: '', requestId: '../../etc/passwd', tag: '', v: 1})).toString('base64url')
    let message = ''
    await decryptKeyPayload(forged).catch((error: Error) => {
      message = error.message
    })
    expect(message).to.include('request id is not valid')
  })

  it('removes expired requests when a new one is made', async () => {
    const old = await createKeyRequest()
    const file = join(pendingKeysDir(), `${old.publicKey}.json`)
    const pending = JSON.parse(await readFile(file, 'utf8')) as {expiresAt: number}
    pending.expiresAt = Date.now() - 1
    await writeFile(file, JSON.stringify(pending))
    const fresh = await createKeyRequest()
    expect(await readdir(pendingKeysDir())).to.deep.equal([`${fresh.publicKey}.json`])
  })
})
