import {spawn} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {configDir} from './paths.js'

const CHECK_EVERY_MS = 24 * 60 * 60 * 1000
const cachePath = (): string => join(configDir(), 'update-check.json')

type Cache = {checkedAt: number; latest: string}

// Whether `latest` is a higher x.y.z than `current` (pre-release tags are ignored)
const parts = (version: string): number[] => version.split('-')[0].split('.').map((part) => Number.parseInt(part, 10) || 0)

export const isNewer = (latest: string, current: string): boolean => {
  const [a, b] = [parts(latest), parts(current)]
  for (let index = 0; index < 3; index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0)
  }

  return false
}

// Only for a person at a terminal: never in CI, never when stderr is piped, never for `mcp`, or when switched off
const allowed = (): boolean =>
  Boolean(process.stderr.isTTY && !process.env.CI && !process.env.DOCSTAR_CLI_SKIP_NEW_VERSION_CHECK)

// For the commands that run outside oclif (`<slug> <module> <endpoint>`), where @oclif/plugin-warn-if-update-available never
// runs. Prints the notice from the daily cache on stderr, and refreshes a stale cache from a detached process, so the
// command itself never waits for the registry.
export const noticeIfOutdated = async (current: string): Promise<void> => {
  if (!allowed()) return
  let cache: Cache | undefined
  try {
    cache = JSON.parse(await readFile(cachePath(), 'utf8')) as Cache
  } catch {
    // no check yet
  }

  if (!cache || Date.now() - cache.checkedAt > CHECK_EVERY_MS) refreshInBackground()
  if (cache && isNewer(cache.latest, current)) {
    process.stderr.write(`docstar-cli update available from ${current} to ${cache.latest}. Run: npm install -g docstar-cli\n`)
  }
}

const refreshInBackground = (): void => {
  const script = `
    const {mkdirSync, writeFileSync} = require('node:fs')
    fetch('https://registry.npmjs.org/docstar-cli/latest', {signal: AbortSignal.timeout(5000)})
      .then((response) => response.json())
      .then(({version}) => {
        if (typeof version !== 'string') return
        mkdirSync(${JSON.stringify(configDir())}, {recursive: true})
        writeFileSync(${JSON.stringify(cachePath())}, JSON.stringify({checkedAt: Date.now(), latest: version}))
      })
      .catch(() => {})
  `
  try {
    spawn(process.execPath, ['-e', script], {detached: true, stdio: 'ignore'}).unref()
  } catch {
    // the notice is a courtesy: never fail a command over it
  }
}
