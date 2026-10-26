import {expect} from 'chai'
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {parseSavedConfig} from '../../src/lib/config.js'
import {maskKey, readCredential, sendableCredentials, storeCredential} from '../../src/lib/credentials.js'
import {isReservedSlug} from '../../src/lib/slug.js'

describe('credentials', () => {
  let home: string
  let originalHome: string | undefined
  const configFile = () => join(home, '.docstar', 'config.json')
  const saved = async () => parseSavedConfig(await readFile(configFile(), 'utf8'))

  beforeEach(async () => {
    originalHome = process.env.HOME
    home = await mkdtemp(join(tmpdir(), 'docstar-creds-'))
    process.env.HOME = home
    await mkdir(join(home, '.docstar'))
    await writeFile(configFile(), JSON.stringify({collections: [{modules: [], name: 'MSG91', slug: 'msg91', updatedAt: ''}]}))
  })

  afterEach(async () => {
    process.env.HOME = originalHome
    await rm(home, {force: true, recursive: true})
  })

  it('stores a credential with what key emit needs, readable by the owner only', async () => {
    expect(await storeCredential('msg91', 'authkey', 'k_123456', {envVar: 'MSG91_AUTH_KEY'})).to.equal(false)
    expect(await readCredential('msg91', 'authkey')).to.deep.equal({meta: {envVar: 'MSG91_AUTH_KEY'}, value: 'k_123456'})
    expect((await stat(configFile())).mode.toString(8).slice(-3)).to.equal('600')
  })

  it('replaces a credential and its meta', async () => {
    await storeCredential('msg91', 'authkey', 'old', {envVar: 'A', prefix: 'Bearer'})
    expect(await storeCredential('msg91', 'authkey', 'new', {envVar: 'B'})).to.equal(true)
    expect(await readCredential('msg91', 'authkey')).to.deep.equal({meta: {envVar: 'B'}, value: 'new'})
  })

  it('drops the old meta when a bare value is saved (config set)', async () => {
    await storeCredential('msg91', 'authkey', 'old', {envVar: 'A', prefix: 'Bearer'})
    await storeCredential('msg91', 'authkey', 'bare')
    expect((await saved()).collections[0].credentialMeta).to.deep.equal({})
  })

  it('refuses a collection that is not installed, and names the command to run', async () => {
    let message = ''
    await storeCredential('other', 'authkey', 'x').catch((error: Error) => {
      message = error.message
    })
    expect(message).to.include('docstar-cli init other')
  })

  it('says when no credential has that name', async () => {
    let message = ''
    await readCredential('msg91', 'missing').catch((error: Error) => {
      message = error.message
    })
    expect(message).to.include('No credential named "missing"')
  })

  it('sends the key with its scheme in front, and a bare value as it is', async () => {
    await storeCredential('msg91', 'Authorization', 'hm_abc', {envVar: 'T', prefix: 'Bearer'})
    await storeCredential('msg91', 'authkey', 'plain', {envVar: 'K'})
    const sent = sendableCredentials((await saved()).collections[0])
    expect(sent).to.deep.equal({authkey: 'plain', Authorization: 'Bearer hm_abc'})
  })

  it('keeps credentials saved before key save existed working', () => {
    expect(sendableCredentials({credentials: {authkey: 'old'}, modules: [], name: 'x', slug: 'x', updatedAt: ''})).to.deep.equal({authkey: 'old'})
  })

  it('masks a key to its last 4 characters', () => {
    expect(maskKey('sk_live_abc123wxyz')).to.equal('…wxyz')
  })

  it('reserves the names of the CLI commands as slugs', () => {
    for (const slug of ['init', 'key', 'config', 'list', 'mcp', 'clean', 'Key']) expect(isReservedSlug(slug), slug).to.equal(true)
    expect(isReservedSlug('msg91')).to.equal(false)
  })
})
