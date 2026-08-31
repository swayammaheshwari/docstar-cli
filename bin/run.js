#!/usr/bin/env node

import {execute} from '@oclif/core'
import {readFileSync} from 'node:fs'

// oclif's built-in --version prints `docstar-cli/1.2.0 darwin-arm64 node-v22.22.3`. We only want
// the bare version number, so intercept it here before oclif ever sees the flag.
const args = process.argv.slice(2)
if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  console.log(pkg.version)
  process.exit(0)
}

await execute({dir: import.meta.url})
