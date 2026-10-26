# Key handoff: spec for the tool that creates the key

How an MCP tool that creates a provider's API key (for example MSG91's auth key) gives it to the user
without the key being stored anywhere, shown to the AI assistant, or written in a chat. The tool encrypts
the key to a public key made on the user's own machine, in memory, and returns only the ciphertext. Only
`docstar-cli key save` on that machine can open it.

## The flow

1. The user signs in to the provider through the MCP server's sign-in.
2. The assistant runs `docstar-cli key request` in the project folder and reads `publicKey` from its output.
   The private key stays on the user's machine (`~/.docstar/pending-keys/`, owner-only, 10 minutes).
3. The assistant calls the tool with `publicKey` as its only argument. The sign-in token goes in the
   `Authorization` header, as for every tool.
4. The tool calls the provider's create-key API, gets the key, encrypts it as below and returns the
   `payload` and two commands. The plain key is never returned, logged, cached or stored.
5. The assistant runs `docstar-cli key save --payload <payload>`: the key is stored in docstar-cli, under the
   collection, and the commands of that collection use it from then on.
6. The assistant runs `docstar-cli key emit <slug> <name> --env .env`: the key is written to the project's
   `.env` as the variable the tool chose. Run it again for any other project.

The collection must be installed first (`docstar-cli init <slug>`): `key save` says so when it is not, and the
same payload can be saved afterwards.

If anything fails (the provider's call, a bad `publicKey`, the encryption), the tool returns an error and
never the plain key. The provider's API may create a new key on every call, so the tool's description
should tell the assistant to call it once.

## The tool

One string argument, `publicKey`, exactly as printed by `key request`. A response such as:

```json
{
  "payload": "eyJ2IjoxLC...",
  "save": "docstar-cli key save --payload eyJ2IjoxLC...",
  "emit": "docstar-cli key emit msg91 authkey --env .env"
}
```

Return the two commands separately: the assistant runs them one after the other and can run only the first
when the user does not want a `.env` written.

## The payload

`payload = base64url( JSON({ v, requestId, epk, iv, ct, tag }) )`. Every field is base64url except `v`
(the number `1`) and `requestId`, which is the `publicKey` the tool was given, as is.

1. `publicKey` is the user's raw 32-byte X25519 public key, base64url.
2. Make a fresh X25519 keypair for this call. `epk` is its raw 32-byte public key, base64url.
3. `shared` = X25519(the fresh private key, the user's public key).
4. `aesKey` = HKDF-SHA256(ikm = `shared`, salt = the UTF-8 bytes of `requestId`, info = the UTF-8 bytes of
   `docstar-key-handoff-v1`, length = 32).
5. Encrypt with AES-256-GCM: random 12-byte `iv`, additional authenticated data = the UTF-8 bytes of
   `requestId`, 16-byte `tag`. The plaintext is the UTF-8 JSON
   `{ "slug": "msg91", "name": "authkey", "envVar": "MSG91_AUTH_KEY", "prefix": "Bearer", "key": "<the key>", "expiresAt": <ms since epoch> }`.
   - `slug`: the collection the key belongs to (the one `docstar-cli init` installed). Not one of the CLI's own
     command names (`init`, `key`, `config`, `list`, `mcp`, `clean`, `complete`, `completion`, `help`).
   - `name`: what the key is called in the collection: the header or param name its endpoints take
     (`authkey`, `Authorization`, `X-Api-Key`). Letters, digits, `_`, `.` and `-`.
   - `envVar`: the variable `key emit` writes: uppercase letters, digits and `_`, starting with a letter.
   - `prefix`: optional, the scheme in front of the key in a header (`Bearer`). Commands send `Bearer <key>`;
     the stored key and the `.env` value stay the bare key.
   - `expiresAt`: a few minutes ahead. `key save` refuses the payload afterwards.

## Reference (Node, no dependencies)

```js
const crypto = require('node:crypto')

const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')
const b64 = (buffer) => buffer.toString('base64url')

function encryptKeyPayload(publicKey, body) {
  const requestId = publicKey
  const ephemeral = crypto.generateKeyPairSync('x25519')
  const userPublic = crypto.createPublicKey({
    format: 'der',
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey, 'base64url')]),
    type: 'spki',
  })
  const shared = crypto.diffieHellman({privateKey: ephemeral.privateKey, publicKey: userPublic})
  const aesKey = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from(requestId), 'docstar-key-handoff-v1', 32))
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv)
  cipher.setAAD(Buffer.from(requestId))
  const ct = Buffer.concat([cipher.update(JSON.stringify(body), 'utf8'), cipher.final()])
  const epk = ephemeral.publicKey.export({format: 'der', type: 'spki'}).subarray(-32)
  return b64(Buffer.from(JSON.stringify({ct: b64(ct), epk: b64(epk), iv: b64(iv), requestId, tag: b64(cipher.getAuthTag()), v: 1})))
}

// payload = encryptKeyPayload(publicKey, {slug: 'msg91', name: 'authkey', envVar: 'MSG91_AUTH_KEY', key: authKey, expiresAt: Date.now() + 5 * 60 * 1000})
```

## Test it with the real CLI

```sh
docstar-cli init <slug>                       # once
docstar-cli key request                       # note publicKey
# call the tool with it, take the payload it returns
docstar-cli key save --payload <payload>
docstar-cli key emit <slug> <name> --env /tmp/test.env
```

`✓ <name> saved for "<slug>" (…last4)` and `✓ <ENV_VAR> written in ... (…last4)` mean it works. The errors say
what is wrong: "could not be opened" (wrong key derivation, AAD or tag), "payload expired" (`expiresAt` in the
past), "unexpected content" (a bad `slug`, `name`, `envVar` or `prefix`), "No pending key request" (used already,
expired, or made on another machine), "isn't installed" (run `init` first).

The reference is the same as `encryptKeyPayload` in `src/lib/key-crypto.ts`.
