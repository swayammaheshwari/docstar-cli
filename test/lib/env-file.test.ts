import {expect} from 'chai'
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {ensureGitignored, upsertEnvVar} from '../../src/lib/env-file.js'

describe('envFile', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'docstar-env-'))
  })

  afterEach(async () => {
    await rm(root, {force: true, recursive: true})
  })

  it('adds the variable, keeping other lines, readable by the owner only', async () => {
    const envFile = join(root, '.env')
    await writeFile(envFile, 'OTHER=1')
    expect(await upsertEnvVar(envFile, 'ACME_API_KEY', 'acme_sk_123')).to.equal(false)
    expect(await readFile(envFile, 'utf8')).to.equal('OTHER=1\nACME_API_KEY=acme_sk_123\n')
    expect((await stat(envFile)).mode.toString(8).slice(-3)).to.equal('600')
  })

  it('replaces the variable when it is already there', async () => {
    const envFile = join(root, '.env')
    await writeFile(envFile, 'ACME_API_KEY=old\nOTHER=1\n')
    expect(await upsertEnvVar(envFile, 'ACME_API_KEY', 'new$&value')).to.equal(true)
    expect(await readFile(envFile, 'utf8')).to.equal('ACME_API_KEY=new$&value\nOTHER=1\n')
  })

  it('quotes values that would change meaning unquoted', async () => {
    const envFile = join(root, '.env')
    await upsertEnvVar(envFile, 'KEY', 'a b#c')
    expect(await readFile(envFile, 'utf8')).to.equal('KEY="a b#c"\n')
  })

  it('adds the env file to .gitignore once', async () => {
    const envFile = join(root, '.env')
    await writeFile(join(root, '.gitignore'), 'node_modules/')
    expect(await ensureGitignored(envFile)).to.equal(true)
    expect(await ensureGitignored(envFile)).to.equal(false)
    expect(await readFile(join(root, '.gitignore'), 'utf8')).to.equal('node_modules/\n.env\n')
  })

  it('leaves .gitignore alone when a pattern already covers the file', async () => {
    await writeFile(join(root, '.gitignore'), '.env*\n')
    expect(await ensureGitignored(join(root, '.env.local'))).to.equal(false)
  })
})
