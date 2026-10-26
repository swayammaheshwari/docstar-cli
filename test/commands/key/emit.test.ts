import {expect} from 'chai'

import KeyEmit from '../../../src/commands/key/emit.js'

describe('key emit', () => {
  // `key emit <slug> <name>` is what the tool, the README and docs/key-handoff.md tell people to run
  it('takes the collection slug first and the credential name second', () => {
    expect(Object.keys(KeyEmit.args)).to.deep.equal(['slug', 'name'])
  })
})
