import {chmod, readFile, writeFile} from 'node:fs/promises'
import {basename, dirname, join} from 'node:path'

const readIfExists = async (path: string): Promise<string> => readFile(path, 'utf8').catch(() => '')

// A value that would change meaning unquoted in a .env file (spaces, #, quotes, =) is written JSON-quoted
const formatValue = (value: string): string => (/[\s"#'=]/.test(value) ? JSON.stringify(value) : value)

// Sets `name` in the env file, keeping every other line, and makes the file readable by its owner only.
// Returns whether the variable was already there (and so replaced).
export const upsertEnvVar = async (envFile: string, name: string, value: string): Promise<boolean> => {
  const existing = await readIfExists(envFile)
  const line = `${name}=${formatValue(value)}`
  const pattern = new RegExp(`^${name}=.*$`, 'm')
  const replaced = pattern.test(existing)
  const separator = existing && !existing.endsWith('\n') ? '\n' : ''
  const updated = replaced ? existing.replace(pattern, () => line) : `${existing}${separator}${line}\n`
  await writeFile(envFile, updated, {mode: 0o600})
  await chmod(envFile, 0o600)
  return replaced
}

// Adds the env file to the .gitignore next to it, unless a line there already covers it. Returns whether it was added.
export const ensureGitignored = async (envFile: string): Promise<boolean> => {
  const gitignore = join(dirname(envFile), '.gitignore')
  const name = basename(envFile)
  const existing = await readIfExists(gitignore)
  const covered = existing.split(/\r?\n/).some((entry) => ['*.env', '.env*', `/${name}`, name].includes(entry.trim()))
  if (covered) return false
  const separator = existing && !existing.endsWith('\n') ? '\n' : ''
  await writeFile(gitignore, `${existing}${separator}${name}\n`)
  return true
}
