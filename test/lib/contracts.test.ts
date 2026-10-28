import {expect} from 'chai'

import {contractUrl, ContractNotFoundError, fetchCollection, fetchEndpoint, fetchModuleIndex, findEntry} from '../../src/lib/contracts.js'
import {ROOT_MODULE_PATH} from '../../src/lib/paths.js'

describe('contracts (read live, never saved)', () => {
  const realFetch = globalThis.fetch
  const realApi = process.env.DOCSTAR_API_URL
  afterEach(() => {
    globalThis.fetch = realFetch
    if (realApi === undefined) delete process.env.DOCSTAR_API_URL
    else process.env.DOCSTAR_API_URL = realApi
  })

  const answer = (status: number, body: unknown, urls: string[] = []) => {
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url))
      return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}, status})
    }) as typeof fetch
    return urls
  }

  it('builds the one route for both shapes', () => {
    expect(contractUrl('https://api.docstar.io/', 'msg91', {path: 'sms'})).to.equal('https://api.docstar.io/p/generate-module-json?slug=msg91&path=sms')
  })

  it('reads a module by path, and the collection root with scope=root', async () => {
    const urls = answer(200, {endpoints: [], module: {}})
    await fetchModuleIndex('msg91', 'sms', 'https://api.test')
    await fetchModuleIndex('msg91', ROOT_MODULE_PATH, 'https://api.test')
    expect(urls).to.deep.equal(['https://api.test/p/generate-module-json?slug=msg91&path=sms', 'https://api.test/p/generate-module-json?slug=msg91&scope=root'])
  })

  it('says which thing is missing on a 404', async () => {
    answer(404, {error: 'Collection not found'})
    const error = await fetchModuleIndex('nope', 'sms', 'https://api.test').catch((caught: unknown) => caught)
    expect(error).to.be.instanceOf(ContractNotFoundError)
    expect((error as Error).message).to.equal('No collection "nope" found on https://api.test')

    answer(404, {error: 'Module not found'})
    const moduleError = await fetchModuleIndex('msg91', 'nope', 'https://api.test').catch((caught: unknown) => caught)
    expect((moduleError as Error).message).to.equal('No module "nope" found in collection "msg91"')
  })

  it('names the API it could not reach', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ENOTFOUND')
    }) as typeof fetch
    const error = await fetchCollection('msg91', 'https://api.test').catch((caught: unknown) => caught)
    expect((error as Error).message).to.include("Couldn't reach https://api.test")
  })

  it('finds an endpoint of the index by command name or alias', () => {
    const entry = {aliases: ['text', 'send-sms'], command: 'send-sms'}
    const index = {endpoints: [entry], module: {id: 'sms', name: 'SMS', version: '1'}} as never
    expect(findEntry(index, 'text')).to.equal(entry)
    expect(findEntry(index, 'send-sms')).to.equal(entry)
    expect(findEntry(index, 'nope')).to.equal(undefined)
  })

  it('reads one endpoint by path=<module>/<command> in one request, and a root endpoint by path=<command>', async () => {
    const urls = answer(200, {auth: null, endpoint: {method: 'GET'}, module: {}})
    const {auth, endpoint} = await fetchEndpoint('msg91', 'sms', 'send-sms', 'https://api.test')
    await fetchEndpoint('msg91', ROOT_MODULE_PATH, 'ping', 'https://api.test')
    expect(urls).to.deep.equal(['https://api.test/p/generate-module-json?slug=msg91&path=sms%2Fsend-sms', 'https://api.test/p/generate-module-json?slug=msg91&path=ping'])
    expect(auth).to.equal(null)
    expect(endpoint).to.deep.equal({method: 'GET'})
  })

  it('says which thing is missing when the endpoint is not found', async () => {
    answer(404, {error: 'Endpoint not found'})
    const missing = await fetchEndpoint('msg91', 'sms', 'nope', 'https://api.test').catch((caught: unknown) => caught)
    expect(missing).to.be.instanceOf(ContractNotFoundError)
    expect((missing as Error).message).to.equal('No endpoint "nope" in module "msg91 sms"')

    // a root endpoint named like a module gets the module's index back: that is not an endpoint
    answer(200, {endpoints: [], module: {}})
    const notEndpoint = await fetchEndpoint('msg91', ROOT_MODULE_PATH, 'sms', 'https://api.test').catch((caught: unknown) => caught)
    expect(notEndpoint).to.be.instanceOf(ContractNotFoundError)
  })
})
