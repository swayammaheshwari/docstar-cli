import type {Command} from '@oclif/core'

import {confirm, password} from '@inquirer/prompts'

import {maskKey, MissingCredentialError, storeCredential} from './credentials.js'
import {executeCliCommand} from './http.js'
import {promptForMissingParams} from './prompt.js'

// Exit codes: 1 = the API answered with an error (4xx/5xx) or the call failed, 4 = a credential is missing (the message
// says how to add it). AI assistants and scripts can tell the two apart.
export const EXIT_API_ERROR = 1
export const EXIT_CREDENTIAL_MISSING = 4

// Someone is at a keyboard: prompts can be answered (never when an AI assistant or CI runs the command)
const canAsk = (): boolean => Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI)

// Asks for what's missing, in a terminal: the API key (hidden, optionally saved like `config set`), or a sign-in (runs
// `login`). Returns false when the user declines, so the command stops with the message.
const askFor = async (command: Command, error: MissingCredentialError, params: Record<string, string>): Promise<boolean> => {
  const {kind, name, slug} = error
  if (kind === 'signIn') {
    command.log(error.message.split('\n')[0])
    if (!(await confirm({default: true, message: `Sign in to ${slug} now?`}))) return false
    await command.config.runCommand('login', [slug])
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
  execute: typeof executeCliCommand
}

// What every generated endpoint command runs: asks for missing required parameters, checks the credentials the
// endpoint needs before calling, prints the API's answer, and exits 1 when the API answered with an error.
export const runEndpoint = async (
  command: Command,
  call: {command: string; module: string; slug: string},
  params: Record<string, string>,
  required: string[],
  deps: RunDeps = {ask: askFor, canAsk, execute: executeCliCommand},
): Promise<void> => {
  Object.assign(params, await promptForMissingParams(required, params))

  // Each missing credential is asked for once: an endpoint can need any number of API keys plus a sign-in, so there is
  // no fixed number of rounds. Being asked for the same one twice means the answer didn't take, so it stops there.
  const asked = new Set<string>()
  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await deps.execute(call.slug, call.module, call.command, params)
      command.log(JSON.stringify(result, null, 2))
      if (result.status >= 400) command.exit(EXIT_API_ERROR)
      return
    } catch (error) {
      if ((error as {oclif?: unknown}).oclif) throw error
      if (!(error instanceof MissingCredentialError)) command.error((error as Error).message, {exit: EXIT_API_ERROR})
      const id = `${error.kind}:${error.name.toLowerCase()}`
      // eslint-disable-next-line no-await-in-loop
      if (asked.has(id) || !deps.canAsk() || !(await deps.ask(command, error, params))) command.error(error.message, {exit: EXIT_CREDENTIAL_MISSING})
      asked.add(id)
    }
  }
}
