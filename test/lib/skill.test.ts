import {expect} from 'chai'

import {renderSkill, skillNameOf} from '../../src/lib/skill.js'
import {isReservedSlug} from '../../src/lib/slug.js'

describe('setup: the skill for a collection', () => {
  const collection = {
    auth: {headerName: 'proxy_auth_token', tokenPrefix: ''},
    collection: {id: 'c1', name: 'MSG91', slug: 'msg91'},
    modules: [
      {name: 'SMS', path: 'sms'},
      {name: 'Slack', path: 'slack'},
    ],
    rootEndpoints: [{name: 'Ping', path: 'ping'}],
  }

  it('is named after the slug, in the form agents accept', () => {
    expect(skillNameOf('msg91')).to.equal('msg91-api')
    expect(skillNameOf('my_docs')).to.equal('my-docs-api')
  })

  it('says when to use it and how, through MCP or the CLI', () => {
    const skill = renderSkill('msg91', collection)
    expect(skill).to.match(/^---\nname: msg91-api\ndescription: Call or look up the MSG91 API \(msg91\)/)
    expect(skill).to.include('docstar-cli msg91 <module> <endpoint> --help')
    expect(skill).to.include('- `sms`: SMS\n- `slack`: Slack')
    expect(skill).to.include('docstar-cli msg91 <endpoint>')
  })

  it('explains sign-in only when the collection has one', () => {
    expect(renderSkill('msg91', collection)).to.include('docstar-cli login msg91 --no-wait')
    expect(renderSkill('msg91', {...collection, auth: null})).not.to.include('## Sign-in')
  })

  it('lists a long module list only in part', () => {
    const modules = Array.from({length: 45}, (_, index) => ({name: `M${index}`, path: `m${index}`}))
    const skill = renderSkill('big', {...collection, modules, rootEndpoints: []})
    expect(skill).to.include('- `m39`: M39')
    expect(skill).not.to.include('- `m40`: M40')
    expect(skill).to.include('...and 5 more: run `docstar-cli big`')
  })

  it('keeps `setup` from being taken as a collection slug', () => {
    expect(isReservedSlug('setup')).to.equal(true)
  })
})
