import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises'

import type {TokenPlacement} from './types.js'

import {DEFAULT_API} from './config.js'
import {configDir, credentialsPath, pendingSignInsPath} from './paths.js'

// `docstar-cli login <collection>` signs the user in to the docs owner's own platform (the same OAuth app as its DocStar
// MCP server). DocStar's API holds the OAuth client secret and does the browser sign-in; the CLI only ever gets the
// user's tokens, keeps them in ~/.docstar/credentials.json (owner-only) and puts the access token on every request to
// that collection's API, refreshing it through DocStar when it expires. Tokens are never printed: AI assistants read
// this CLI's output.

// The DocStar API to sign in through: --api, else $DOCSTAR_API_URL, else the one the collection was installed from
export const apiUrlOf = (flag?: string, installedApi?: null | string): string =>
  (flag || process.env.DOCSTAR_API_URL || installedApi || DEFAULT_API).replace(/\/$/, '')

// A token about to expire within this many ms is refreshed before the call, not after it fails
const REFRESH_MARGIN_MS = 60_000

export type SignIn = TokenPlacement & {
  accessToken: string
  api: string
  collectionId: string
  expiresAt: null | number
  name: string
  refreshToken: null | string
  signedInAt: string
}

// What DocStar's API answers with tokens (a finished sign-in, or a refresh)
export type TokenAnswer = TokenPlacement & {
  accessToken: string
  expiresIn: null | number
  refreshToken: null | string
}

export type SignInStart = {
  collection: {id: string; name: string; slug: string}
  expiresIn: number
  interval: number
  loginUrl: string
  pollSecret: string
  sessionId: string
}

export type PendingSignIn = SignInStart & {api: string; expiresAt: number}

export class SignInExpiredError extends Error {
  constructor(slug: string) {
    super(`Your sign-in to "${slug}" has expired. Run \`docstar-cli login ${slug}\` to sign in again.`)
  }
}

const readJson = async <T>(path: string): Promise<T> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return {} as T
  }
}

// Written readable by the owner only, the file being created or not
const writePrivateJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(configDir(), {recursive: true})
  await writeFile(path, JSON.stringify(value, null, 2), {mode: 0o600})
  await chmod(path, 0o600)
}

export const readSignIns = (): Promise<Record<string, SignIn>> => readJson(credentialsPath())
export const getSignIn = async (slug: string): Promise<null | SignIn> => (await readSignIns())[slug] || null

export const saveSignIn = async (slug: string, signIn: SignIn): Promise<void> => {
  const signIns = await readSignIns()
  await writePrivateJson(credentialsPath(), {...signIns, [slug]: signIn})
}

// Returns whether there was a sign-in to remove
export const removeSignIn = async (slug: string): Promise<boolean> => {
  const signIns = await readSignIns()
  if (!signIns[slug]) return false
  delete signIns[slug]
  await writePrivateJson(credentialsPath(), signIns)
  return true
}

export const signInFromTokens = (api: string, collection: {id: string; name: string}, tokens: TokenAnswer, now = Date.now()): SignIn => ({
  accessToken: tokens.accessToken,
  api,
  collectionId: collection.id,
  expiresAt: tokens.expiresIn ? now + tokens.expiresIn * 1000 : null,
  name: collection.name,
  refreshToken: tokens.refreshToken,
  signedInAt: new Date(now).toISOString(),
  tokenHeader: tokens.tokenHeader || 'Authorization',
  tokenPrefix: tokens.tokenPrefix ?? 'Bearer',
})

type ApiAnswer = {body: Record<string, unknown> & {error?: string}; status: number}

const postJson = async (url: string, payload: unknown): Promise<ApiAnswer> => {
  let response: Response
  try {
    response = await fetch(url, {body: JSON.stringify(payload), headers: {'Content-Type': 'application/json'}, method: 'POST'})
  } catch (error) {
    throw new Error(`Couldn't reach ${new URL(url).origin}: ${(error as Error).message}`)
  }

  return {body: await response.json().catch(() => ({})), status: response.status}
}

export const startSignIn = async (api: string, collection: {collectionId?: null | string; slug: string}): Promise<SignInStart> => {
  const {body, status} = await postJson(`${api}/p/cli-auth/start`, collection.collectionId ? {collectionId: collection.collectionId} : {slug: collection.slug})
  if (status !== 200) throw new Error(body.error || `Starting the sign-in failed (HTTP ${status})`)
  return body as unknown as SignInStart
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

// Polls until the user has signed in in the browser (the tokens), the sign-in fails, or the link expires
export const waitForSignIn = async (
  api: string,
  pending: Pick<PendingSignIn, 'expiresAt' | 'interval' | 'pollSecret' | 'sessionId'>,
  sleep: (ms: number) => Promise<void> = wait,
): Promise<TokenAnswer> => {
  let interval = Math.max(1, pending.interval || 2) * 1000
  while (Date.now() < pending.expiresAt) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(interval)
    let answer: ApiAnswer
    try {
      // eslint-disable-next-line no-await-in-loop
      answer = await postJson(`${api}/p/cli-auth/poll`, {pollSecret: pending.pollSecret, sessionId: pending.sessionId})
    } catch {
      continue // a network blip: try again on the next tick
    }

    if (answer.status === 202) continue
    if (answer.status === 200) return answer.body as unknown as TokenAnswer
    if (answer.status === 429) {
      interval *= 2
      continue
    }

    throw new Error(answer.body.error || `Sign-in failed (HTTP ${answer.status})`)
  }

  throw new Error('The sign-in link expired before you signed in. Run the login command again.')
}

// A new access token through DocStar (which holds the client secret). A refused refresh ends the sign-in.
export const refreshSignIn = async (slug: string, signIn: SignIn): Promise<SignIn> => {
  if (!signIn.refreshToken) throw new SignInExpiredError(slug)
  const {body, status} = await postJson(`${signIn.api}/p/cli-auth/refresh`, {collectionId: signIn.collectionId, refreshToken: signIn.refreshToken})
  if (status === 401 || status === 404) {
    await removeSignIn(slug)
    throw new SignInExpiredError(slug)
  }

  if (status !== 200) throw new Error(body.error || `Refreshing your sign-in to "${slug}" failed (HTTP ${status})`)
  const tokens = body as unknown as TokenAnswer
  const refreshed = {
    ...signInFromTokens(signIn.api, {id: signIn.collectionId, name: signIn.name}, tokens),
    refreshToken: tokens.refreshToken || signIn.refreshToken,
    signedInAt: signIn.signedInAt,
  }
  await saveSignIn(slug, refreshed)
  return refreshed
}

// The collection's sign-in, refreshed first when its token is about to expire; null when the user isn't signed in
export const usableSignIn = async (slug: string, now = Date.now()): Promise<null | SignIn> => {
  const signIn = await getSignIn(slug)
  if (!signIn) return null
  if (signIn.expiresAt && signIn.refreshToken && signIn.expiresAt - REFRESH_MARGIN_MS < now) return refreshSignIn(slug, signIn)
  return signIn
}

export const readPendingSignIns = (): Promise<Record<string, PendingSignIn>> => readJson(pendingSignInsPath())

export const savePendingSignIn = async (slug: string, pending: PendingSignIn): Promise<void> => {
  const all = await readPendingSignIns()
  await writePrivateJson(pendingSignInsPath(), {...all, [slug]: pending})
}

export const removePendingSignIn = async (slug: string): Promise<void> => {
  const all = await readPendingSignIns()
  if (!all[slug]) return
  delete all[slug]
  await writePrivateJson(pendingSignInsPath(), all)
}
