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

// `docstar-cli <collection> <module> <endpoint>` works without `init`: anything that isn't one of the CLI's own commands is a
// collection slug, and its docs are read live (src/lib/dynamic.ts). Everything else is oclif's.
const {isReservedSlug, SLUG_PATTERN} = await import('../dist/lib/slug.js')
const [first] = args
if (first && !first.startsWith('-') && SLUG_PATTERN.test(first) && !isReservedSlug(first)) {
  const {runDynamic} = await import('../dist/lib/dynamic.js')
  const code = await runDynamic(args)
  const {noticeIfOutdated} = await import('../dist/lib/update-check.js')
  await noticeIfOutdated(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
  process.exit(code)
}

// `mcp` talks over stdio to an AI client: no update notice there
if (first === 'mcp') process.env.DOCSTAR_CLI_SKIP_NEW_VERSION_CHECK = '1'

await execute({dir: import.meta.url})
