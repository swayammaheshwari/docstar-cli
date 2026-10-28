import {accessSync, constants, existsSync, readFileSync} from 'node:fs'
import {chmod, mkdir, rm, writeFile} from 'node:fs/promises'
import {delimiter, join} from 'node:path'
import {configDir} from './paths.js'

// A shim is a tiny launcher named after the collection slug, so `msg91 <module> <endpoint>` runs `docstar-cli msg91 <module> <endpoint>`.
// It only forwards to the CLI: the collection → module → endpoint hierarchy stays intact.
const SHIM_MARKER = 'docstar-cli shim'
const isWindows = process.platform === 'win32'

const fileName = (slug: string): string => (isWindows ? `${slug}.cmd` : slug)
const pathDirs = (): string[] => (process.env.PATH || '').split(delimiter).filter(Boolean)
// Used when no writable directory on PATH is found; the user has to add it to PATH once
export const fallbackBinDir = (): string => join(configDir(), 'bin')

const isWritable = (dir: string): boolean => {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

const isOurShim = (file: string): boolean => {
  try {
    return readFileSync(file, 'utf8').includes(SHIM_MARKER)
  } catch {
    return false
  }
}

const shimContent = (bin: string, slug: string): string =>
  isWindows ? `@echo off\r\nrem ${SHIM_MARKER}\r\n${bin} ${slug} %*\r\n` : `#!/bin/sh\n# ${SHIM_MARKER}\nexec ${bin} ${slug} "$@"\n`

export type ShimResult = {path: string; onPath: boolean} | {conflict: string}

// Prefers the directory the CLI itself was installed into (already on PATH, e.g. the npm global bin), then any writable PATH
// directory, then ~/.docstar/bin. Never overwrites a command that isn't one of our shims (`git`, `node`, ...).
export const installShim = async (bin: string, slug: string): Promise<ShimResult> => {
  const name = fileName(slug)
  const dirs = pathDirs()

  for (const dir of dirs) {
    const existing = join(dir, name)
    if (existsSync(existing) && !isOurShim(existing)) return {conflict: existing}
  }

  const cliDir = dirs.find((dir) => existsSync(join(dir, fileName(bin))))
  const existingShimDir = dirs.find((dir) => isOurShim(join(dir, name)))
  const targetDir = [existingShimDir, cliDir, ...dirs].find((dir) => dir && isWritable(dir))
  const dir = targetDir ?? fallbackBinDir()

  await mkdir(dir, {recursive: true})
  const path = join(dir, name)
  await writeFile(path, shimContent(bin, slug))
  if (!isWindows) await chmod(path, 0o755)

  return {onPath: dirs.includes(dir), path}
}

// Removes only shims we wrote; returns the paths removed
export const removeShim = async (slug: string): Promise<string[]> => {
  const name = fileName(slug)
  const removed: string[] = []

  for (const dir of new Set([...pathDirs(), fallbackBinDir()])) {
    const file = join(dir, name)
    // eslint-disable-next-line no-await-in-loop
    if (isOurShim(file)) await rm(file, {force: true}).then(() => removed.push(file))
  }

  return removed
}

// Shared with `init`, which creates the shim right after installing a collection
export const announceShim = async (log: (message: string) => void, warn: (message: string) => void, bin: string, slug: string): Promise<void> => {
  const result = await installShim(bin, slug)

  if ('conflict' in result) {
    warn(`Not creating a \`${slug}\` command: ${result.conflict} already exists and isn't a docstar-cli shortcut. Use \`${bin} ${slug} ...\` instead.`)
    return
  }

  log(`Shortcut ready: \`${slug} <module> <endpoint>\` now runs \`${bin} ${slug} <module> <endpoint>\` (${result.path})`)
  if (!result.onPath) log(`Add ${fallbackBinDir()} to your PATH to use it:  export PATH="$PATH:${fallbackBinDir()}"`)
}
