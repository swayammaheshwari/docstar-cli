import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto'
import {chmod, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {configDir} from './paths.js'

// How an API key gets from a provider's tool to the user's .env without the AI assistant ever reading it.
//   1. `key request` makes an X25519 keypair here and keeps the private key on this machine.
//   2. The assistant gives the public key to the MCP tool; the tool gets the key from the provider, encrypts it to the
//      public key in memory (encryptKeyPayload is the reference for that side) and returns the ciphertext.
//   3. `key save` decrypts it with the private key, which is deleted afterwards, so a payload works once.

export const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]*$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const PAYLOAD_VERSION = 1
const HKDF_INFO = 'docstar-key-handoff-v1'
// DER prefix of an X25519 SubjectPublicKeyInfo; the raw 32-byte public key follows it
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')

export const PENDING_KEY_TTL_MS = 10 * 60 * 1000

export type KeyPayloadBody = {envVar: string; expiresAt: number; key: string}

type Payload = {ct: string; epk: string; iv: string; requestId: string; tag: string; v: number}
type PendingKey = {expiresAt: number; privateKey: string}

export const pendingKeysDir = (): string => join(configDir(), 'pending-keys')

const pendingKeyPath = (requestId: string): string => {
  if (!REQUEST_ID_PATTERN.test(requestId)) throw new Error('The request id is not valid')
  return join(pendingKeysDir(), `${requestId}.json`)
}

const publicKeyFromRaw = (raw: Buffer) => {
  if (raw.length !== 32) throw new Error('The public key is not valid')
  return createPublicKey({format: 'der', key: Buffer.concat([SPKI_PREFIX, raw]), type: 'spki'})
}

const rawPublicKeyOf = (publicKey: ReturnType<typeof createPublicKey>): Buffer => {
  const der = publicKey.export({format: 'der', type: 'spki'})
  return der.subarray(-32)
}

// The key both sides derive; the request id is bound in so a payload only opens for its own request
const deriveKey = (shared: Buffer, requestId: string): Buffer =>
  Buffer.from(hkdfSync('sha256', shared, Buffer.from(requestId), HKDF_INFO, 32))

const encode = (value: Buffer): string => value.toString('base64url')
const decode = (value: unknown): Buffer => {
  if (typeof value !== 'string') throw new Error('The payload is not valid')
  return Buffer.from(value, 'base64url')
}

// Step 1: a fresh keypair for one request. The public key doubles as the request id, so the tool needs only that one
// value. Removes the requests that expired while at it.
export const createKeyRequest = async (): Promise<{publicKey: string}> => {
  const {privateKey, publicKey: publicKeyObject} = generateKeyPairSync('x25519')
  const publicKey = encode(rawPublicKeyOf(publicKeyObject))
  const requestId = publicKey
  const pending: PendingKey = {
    expiresAt: Date.now() + PENDING_KEY_TTL_MS,
    privateKey: privateKey.export({format: 'der', type: 'pkcs8'}).toString('base64'),
  }

  await mkdir(pendingKeysDir(), {mode: 0o700, recursive: true})
  await chmod(pendingKeysDir(), 0o700)
  await removeExpiredRequests()
  const file = pendingKeyPath(requestId)
  await writeFile(file, JSON.stringify(pending), {mode: 0o600})
  await chmod(file, 0o600)
  return {publicKey}
}

const removeExpiredRequests = async (): Promise<void> => {
  const names = await readdir(pendingKeysDir()).catch(() => [] as string[])
  await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        const file = join(pendingKeysDir(), name)
        const pending = JSON.parse(await readFile(file, 'utf8').catch(() => '{}')) as Partial<PendingKey>
        if (!pending.expiresAt || pending.expiresAt < Date.now()) await rm(file, {force: true})
      }),
  )
}

// What the MCP tool does: encrypt the key to the public key from `key request`, in memory, and store nothing.
export const encryptKeyPayload = (publicKey: string, body: KeyPayloadBody): string => {
  const requestId = publicKey
  const ephemeral = generateKeyPairSync('x25519')
  const shared = diffieHellman({privateKey: ephemeral.privateKey, publicKey: publicKeyFromRaw(decode(publicKey))})
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(shared, requestId), iv)
  cipher.setAAD(Buffer.from(requestId))
  const ct = Buffer.concat([cipher.update(JSON.stringify(body), 'utf8'), cipher.final()])
  const payload: Payload = {
    ct: encode(ct),
    epk: encode(rawPublicKeyOf(ephemeral.publicKey)),
    iv: encode(iv),
    requestId,
    tag: encode(cipher.getAuthTag()),
    v: PAYLOAD_VERSION,
  }
  return encode(Buffer.from(JSON.stringify(payload)))
}

// Step 3: opens a payload with the private key kept for its request. Throws a message fit to show the user.
export const decryptKeyPayload = async (encoded: string): Promise<{body: KeyPayloadBody; forget: () => Promise<void>}> => {
  let payload: Payload
  try {
    payload = JSON.parse(decode(encoded).toString('utf8')) as Payload
  } catch {
    throw new Error('The payload is not valid')
  }

  if (payload.v !== PAYLOAD_VERSION) throw new Error('The payload is from a newer version: update docstar-cli')
  const file = pendingKeyPath(String(payload.requestId))
  const forget = () => rm(file, {force: true})

  let pending: PendingKey
  try {
    pending = JSON.parse(await readFile(file, 'utf8')) as PendingKey
  } catch {
    throw new Error('No pending key request for this payload: it was already used, expired, or made on another machine. Run `docstar-cli key request` again')
  }

  if (pending.expiresAt < Date.now()) {
    await forget()
    throw new Error('The key request expired. Run `docstar-cli key request` again')
  }

  let body: KeyPayloadBody
  try {
    const shared = diffieHellman({
      privateKey: createPrivateKey({format: 'der', key: Buffer.from(pending.privateKey, 'base64'), type: 'pkcs8'}),
      publicKey: publicKeyFromRaw(decode(payload.epk)),
    })
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(shared, payload.requestId), decode(payload.iv))
    decipher.setAAD(Buffer.from(payload.requestId))
    decipher.setAuthTag(decode(payload.tag))
    body = JSON.parse(Buffer.concat([decipher.update(decode(payload.ct)), decipher.final()]).toString('utf8')) as KeyPayloadBody
  } catch {
    throw new Error('The payload could not be opened: it was changed, or it is not for this request')
  }

  if (typeof body.expiresAt !== 'number' || body.expiresAt < Date.now()) {
    await forget()
    throw new Error('The payload expired. Ask the assistant to get the key again')
  }

  if (!ENV_VAR_PATTERN.test(String(body.envVar)) || typeof body.key !== 'string' || !body.key) {
    throw new Error('The payload has an unexpected content')
  }

  return {body, forget}
}
