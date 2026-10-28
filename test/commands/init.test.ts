import {expect} from 'chai'

import {isReservedSlug, SLUG_PATTERN} from '../../src/lib/slug.js'

// `init` itself is interactive (a checklist) and talks to the network; what decides whether `docstar-cli <slug> ...` is
// run live or handed to oclif is the slug check bin/run.js makes.
describe('what bin/run.js treats as a collection slug', () => {
  const isSlug = (word: string) => !word.startsWith('-') && SLUG_PATTERN.test(word) && !isReservedSlug(word)

  it('treats an unknown word as a collection', () => {
    expect(isSlug('msg91')).to.equal(true)
    expect(isSlug('my_docs-2')).to.equal(true)
  })

  it('leaves the CLI own commands and flags to oclif', () => {
    for (const word of ['init', 'list', 'login', 'mcp', 'config', 'key', 'auth', 'help', '--help', '-h', '--version']) expect(isSlug(word)).to.equal(false)
  })
})
