import {expect} from 'chai'

import type {EndpointContract} from '../../src/lib/types.js'

import {flagSpecsOf} from '../../src/lib/endpoint-flags.js'

const endpoint = {
  body: {raw: {value: JSON.stringify({content_type: 'text', payload: {}, ids: []})}, type: 'JSON'},
  cli: {command: {aliases: [], name: 'send'}, description: '', name: 'send', parameters: {optional: ['ids'], required: ['payload', 'content_type']}, version: 1},
  headers: {'content-type': 'application/json'},
  params: {},
} as unknown as EndpointContract

describe('flagSpecsOf', () => {
  const flags = flagSpecsOf(endpoint, null)
  const text = (name: string) => flags.find((flag) => flag.name === name)?.description ?? ''

  it('says what shape a body field takes', () => {
    expect(text('payload')).to.include('JSON object')
    expect(text('ids')).to.include('list')
  })

  it('tells the body field and the header of the same name apart', () => {
    expect(text('content_type')).to.include('not the `--content-type` header')
    expect(text('content-type')).to.include('not the `--content_type` body field')
  })
})
