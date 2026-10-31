import {confirm, password} from '@inquirer/prompts'

import {maskKey, MissingCredentialError, storeCredential} from './credentials.js'
import {type ExecuteResult, InvalidParamError} from './http.js'
import {promptForMissingParams} from './prompt.js'

// Exit codes: 1 = the API answered with an error (4xx/5xx) or the call failed, 4 = a credential is missing (the message
// says how to add it). AI assistants and scripts can tell the two apart.
export const EXIT_API_ERROR = 1
export const EXIT_CREDENTIAL_MISSING = 4
// 2 = the call can't be made as typed: a required parameter is missing and nobody can be asked, or a value has the wrong shape
export const EXIT_BAD_USAGE = 2

// Where a command talks to the user and how it ends: `error` and `exit` stop the command by throwing an ExitSignal
export type RunIo = {
  error: (message: string, options?: {exit?: number}) => never
  exit: (code: number) => never
  log: (line: string) => void
  login: (slug: string) => Promise<void>
}

export class ExitSignal extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`)
  }
}

// Someone is at a keyboard: prompts can be answered (never when an AI assistant or CI runs the command)
const canAsk = (): boolean => Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI)

// Asks for what's missing, in a terminal: the API key (hidden, optionally saved like `config set`), or a sign-in (runs
// `login`). Returns false when the user declines, so the command stops with the message.
const askFor = async (command: RunIo, error: MissingCredentialError, params: Record<string, string>): Promise<boolean> => {
  const {kind, name, slug} = error
  if (kind === 'signIn') {
    command.log(error.message.split('\n')[0])
    if (!(await confirm({default: true, message: `Sign in to ${slug} now?`}))) return false
    await command.login(slug)
    return true
  }

  command.log(`This call needs your ${slug} API key ("${name}").`)
  const value = (await password({mask: '*', message: `${name}:`})).trim()
  if (!value) return false
  // A saved key is used from where it's saved (and named that way if the API refuses it); otherwise for this call only
  if (await confirm({default: true, message: `Save it for ${slug}, so you're not asked again?`})) {
    try {
      await storeCredential(slug, name, value)
      command.log(`Saved (${maskKey(value)}). Change it later with: docstar-cli config set ${slug} ${name} <key>`)
      return true
    } catch (saveError) {
      command.log(`Couldn't save it: ${(saveError as Error).message}`)
    }
  }

  params[name] = value
  return true
}

type RunDeps = {
  ask: typeof askFor
  canAsk: () => boolean
}

// What every endpoint command runs: asks for missing required parameters, checks the credentials the endpoint needs
// before calling (`target.execute` throws MissingCredentialError), prints the API's answer, and exits 1 when the API
// answered with an error.
export const runEndpoint = async (
  io: RunIo,
  target: {execute: (params: Record<string, string>) => Promise<ExecuteResult>},
  params: Record<string, string>,
  required: string[],
  deps: RunDeps = {ask: askFor, canAsk},
): Promise<void> => {
  const missingParams = required.filter((name) => params[name] === undefined)
  if (missingParams.length > 0) {
    // With no one at a keyboard (an AI assistant, CI) a prompt would abort, so say which flags are missing instead
    if (!deps.canAsk()) io.error(`Missing required parameter${missingParams.length > 1 ? 's' : ''}: ${missingParams.map((name) => `--${name}`).join(' ')}`, {exit: EXIT_BAD_USAGE})
    Object.assign(params, await promptForMissingParams(required, params))
  }

  // Each missing credential is asked for once: an endpoint can need any number of API keys plus a sign-in, so there is
  // no fixed number of rounds. Being asked for the same one twice means the answer didn't take, so it stops there.
  const asked = new Set<string>()
  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await target.execute(params)
      io.log(JSON.stringify(result, null, 2))
      if (result.status >= 400) io.exit(EXIT_API_ERROR)
      return
    } catch (error) {
      if (error instanceof ExitSignal) throw error
      if (error instanceof InvalidParamError) io.error(error.message, {exit: EXIT_BAD_USAGE})
      if (!(error instanceof MissingCredentialError)) io.error((error as Error).message, {exit: EXIT_API_ERROR})
      const missing = error as MissingCredentialError
      const id = `${missing.kind}:${missing.name.toLowerCase()}`
      // eslint-disable-next-line no-await-in-loop
      if (asked.has(id) || !deps.canAsk() || !(await deps.ask(io, missing, params))) io.error(missing.message, {exit: EXIT_CREDENTIAL_MISSING})
      asked.add(id)
    }
  }
}
