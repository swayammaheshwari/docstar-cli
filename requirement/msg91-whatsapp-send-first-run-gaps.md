# MSG91 WhatsApp send: gaps a first-time user hits

Found by installing `docstar-cli@2.0.0` from npm and calling `docstar-cli msg91 whatsapp template-bulk` and
`send-message-in-text` with a dummy authkey (a 401 came back, so nothing was sent).

## What works
- `npm i -g docstar-cli`, then `docstar-cli msg91` lists modules, `docstar-cli msg91 whatsapp` lists 30 endpoints.
- Missing key without a TTY: clear message, exit 4, tells the user not to paste the key into an AI chat.
- A bad key: the 401 body plus a useful `hint`, exit 1.

## Problems

### 1. `--payload` has no shape and no validation
`template-bulk --help` shows `--payload=<value>  Required parameter`. Nothing says it is a JSON object, or what goes in it
(`messaging_product`, `type`, `template.name`, `language`, `namespace`, `to_and_components`). A new user (or an AI
assistant) has to leave the CLI to read the docs.
`--payload 'notjson'` is sent to MSG91 as-is, with no local error. It only looked fine here because the 401 came first.
With a real key the user would get an opaque server error.

### 2. Near-duplicate flags `--content_type` and `--content-type`
`template-bulk` and `send-message-in-text` have both: `--content_type` (a body field, e.g. `template` or `text`) and
`--content-type` (the HTTP header, "Header value"). They differ by one character. Passing the wrong one gives a wrong
request or a server error and no hint.

### 3. `send-message-in-text` lists everything as optional
`integrated_number`, `recipient_number`, `content_type` and `text` are all "Optional parameter". The API cannot work
without them, so the CLI will not prompt for them and the user finds out from a server error. This is a docs-side fix
(mark them required on the endpoint), but the CLI could also show it in `--help`.

### 4. Help gives no example call
Neither `--help` shows an example invocation, and the endpoint's docs description does not reach the CLI. For endpoints
with a JSON-body flag, an example would fix most of problem 1.

### 5. Required-parameter prompt crash (already filed)
`docstar-cli msg91 whatsapp template-bulk --authkey X </dev/null` crashes with "User force closed the prompt".
See `required-param-prompt-crashes-without-a-terminal.md`.

## Suggested fixes
1. Show the body example from the endpoint docs under `--payload` in `--help`, and say "JSON".
2. When a body field's template is an object or array, `JSON.parse` the flag before sending and exit with a clear message
   on failure (`coerceToTemplateType` in `src/lib/http.ts` is the place).
3. In help, label the header flags as headers (e.g. `--header-content-type`), or hide Content-Type/Accept headers that
   have fixed values, so they don't sit next to the body field of the same name.
4. Fix the docs for `send-message-in-text` in the MSG91 collection (mark the four fields required).
5. Print one example command per endpoint in `--help`.

## Not tested
A real send (needs a real authkey and a WhatsApp integrated number), and the MCP path (`docstar-cli mcp` and the hosted
DocStar MCP tools).
