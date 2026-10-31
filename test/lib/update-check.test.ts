import {expect} from 'chai'

import {isNewer} from '../../src/lib/update-check.js'

describe('isNewer', () => {
  it('compares x.y.z numerically', () => {
    expect(isNewer('2.0.2', '2.0.1')).to.equal(true)
    expect(isNewer('2.10.0', '2.9.9')).to.equal(true)
    expect(isNewer('2.0.1', '2.0.1')).to.equal(false)
    expect(isNewer('1.9.0', '2.0.0')).to.equal(false)
  })
})
