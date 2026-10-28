import {Config} from '@oclif/core'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'

import type {CollectionListResponse, EndpointResponse, ModuleIndex} from './types.js'

import {ContractNotFoundError, fetchCollection, fetchEndpoint, fetchModuleIndex, registeredCollection} from './contracts.js'
import {endpointHelp, entrySummary, flagSpecsOf} from './endpoint-flags.js'
import {executeEndpoint, signInHeaderOf} from './http.js'
import {isRootModule, ROOT_MODULE_PATH} from './paths.js'
import {EXIT_API_ERROR, ExitSignal, runEndpoint, type RunIo} from './run.js'

const BIN = 'docstar-cli'

// Talks to the terminal; `login` runs the CLI's own `login` command
export const consoleIo = (): RunIo => ({
  error(message, options) {
    console.error(message)
    throw new ExitSignal(options?.exit ?? EXIT_API_ERROR)
  },
  exit(code) {
    throw new ExitSignal(code)
  },
  log: (line) => console.log(line),
  async login(slug) {
    const config = await Config.load(fileURLToPath(new URL('../../', import.meta.url)))
    await config.runCommand('login', [slug])
  },
})

const showCollection = (io: RunIo, slug: string, listing: CollectionListResponse): void => {
  io.log(`${listing.collection?.name ?? slug} (${slug})`)
  for (const module of listing.modules) {
    const count = module.endpointCount ?? module.endpoints?.length ?? 0
    io.log(`  ${module.path} — ${count} endpoint${count === 1 ? '' : 's'}`)
  }

  if ((listing.rootEndpoints?.length ?? 0) > 0) io.log(`  (root) — ${listing.rootEndpoints!.length} endpoint(s): ${BIN} ${slug} <endpoint>`)
  io.log(`\nSee a module's endpoints: ${BIN} ${slug} <module>`)
}

const showModule = (io: RunIo, slug: string, modulePath: string, index: ModuleIndex): void => {
  const signInHeader = signInHeaderOf(index.auth)
  io.log(`${slug}${isRootModule(modulePath) ? '' : ` ${modulePath}`} — ${index.endpoints.length} endpoint(s)\n`)
  for (const entry of index.endpoints) for (const line of entrySummary(entry, signInHeader)) io.log(line)
  io.log(`Run one: ${BIN} ${slug}${isRootModule(modulePath) ? '' : ` ${modulePath}`} <endpoint> [flags]   (--help for its flags)`)
}

// `<slug> <word>`: a module (list its endpoints) or an endpoint at the collection root (run it). A module wins over a
// root endpoint of the same name, as in `init`.
const resolveWord = async (io: RunIo, slug: string, word: string): Promise<{index: ModuleIndex; kind: 'module'} | {kind: 'root'}> => {
  const registered = await registeredCollection(slug)
  if (registered?.modules.some((module) => module.path === word)) return {index: await fetchModuleIndex(slug, word), kind: 'module'}
  if (registered?.modules.some((module) => isRootModule(module.path) && module.commands?.includes(word))) return {kind: 'root'}

  const listing = await fetchCollection(slug)
  if (listing.modules.some((module) => module.path === word)) return {index: await fetchModuleIndex(slug, word), kind: 'module'}
  if ((listing.rootEndpoints?.length ?? 0) > 0) return {kind: 'root'}

  return io.error(`"${word}" is neither a module nor a root endpoint of "${slug}". Modules: ${listing.modules.map((module) => module.path).join(', ') || '(none)'}`)
}

// What to say when the endpoint isn't there: the endpoints that are (one more request, only on this error)
const unknownEndpoint = async (io: RunIo, slug: string, modulePath: string, commandName: string): Promise<never> => {
  const where = `${slug}${isRootModule(modulePath) ? '' : ` ${modulePath}`}`
  const index = await fetchModuleIndex(slug, modulePath).catch(() => null)
  const names = index?.endpoints.map((candidate) => candidate.command) ?? []
  return io.error(`No endpoint "${commandName}" in ${where}.${names.length > 0 ? ` Available: ${names.join(', ')}` : ''}`)
}

// Reads the endpoint (one request: the server finds it by name) and runs it with the flags that follow
const runEndpointCommand = async (io: RunIo, slug: string, modulePath: string, commandName: string, flagArgs: string[]): Promise<void> => {
  let found: EndpointResponse
  try {
    found = await fetchEndpoint(slug, modulePath, commandName)
  } catch (error) {
    if (error instanceof ContractNotFoundError && !error.message.startsWith('No collection')) return unknownEndpoint(io, slug, modulePath, commandName)
    throw error
  }

  const {auth, endpoint} = found
  // Before the user's own sign-in is read, so `--help` makes no file reads; the call itself uses the stored one
  const signInHeader = signInHeaderOf(auth)
  const specs = flagSpecsOf(endpoint, signInHeader).filter((spec) => spec.name !== 'help')
  let values: Record<string, boolean | string | undefined>
  try {
    values = parseArgs({
      allowPositionals: false,
      args: flagArgs,
      options: {...Object.fromEntries(specs.map((spec) => [spec.name, {type: 'string' as const}])), help: {short: 'h', type: 'boolean' as const}},
      strict: true,
    }).values
  } catch (error) {
    return io.error(`${(error as Error).message}\nFlags this command takes: ${specs.map((spec) => `--${spec.name}`).join(' ') || '(none)'}  (see --help)`)
  }

  if (values.help) {
    for (const line of endpointHelp(BIN, slug, modulePath, endpoint, signInHeader)) io.log(line)
    return
  }

  const params = Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  await runEndpoint(io, {execute: (given) => executeEndpoint(slug, {auth}, endpoint, given)}, params, endpoint.cli.parameters.required)
}

const dispatch = async (args: string[], io: RunIo): Promise<void> => {
  const [slug, ...rest] = args
  const flagStart = rest.findIndex((arg) => arg.startsWith('-'))
  const words = flagStart === -1 ? rest : rest.slice(0, flagStart)
  const flagArgs = flagStart === -1 ? [] : rest.slice(flagStart)

  if (words.length > 2) io.error(`Too many arguments. Usage: ${BIN} ${slug} <module> <endpoint> [--flag value]. Flags go after the endpoint.`)

  if (words.length === 0) {
    showCollection(io, slug, await fetchCollection(slug))
    return
  }

  if (words.length === 2) {
    const [modulePath, commandName] = words
    await runEndpointCommand(io, slug, modulePath, commandName, flagArgs)
    return
  }

  const [word] = words
  const resolved = await resolveWord(io, slug, word)
  if (resolved.kind === 'root') {
    await runEndpointCommand(io, slug, ROOT_MODULE_PATH, word, flagArgs)
    return
  }

  showModule(io, slug, word, resolved.index)
}

// `docstar-cli <slug> [<module>] [<endpoint>] [--flag value]` for a collection nobody ran `init` for: the docs are read
// now, and the endpoint runs. Resolves to the exit code.
export const runDynamic = async (args: string[], io: RunIo = consoleIo()): Promise<number> => {
  try {
    await dispatch(args, io)
    return 0
  } catch (error) {
    if (error instanceof ExitSignal) return error.code
    const {message} = error as Error
    console.error(error instanceof ContractNotFoundError && message.startsWith('No collection') ? `${message}. (If you meant a docstar-cli command, see \`${BIN} --help\`.)` : message)
    return EXIT_API_ERROR
  }
}
