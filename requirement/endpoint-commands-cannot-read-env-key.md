> **Resolved in 1.6.0 for keys obtained with `key request` / `key save`:** the key is stored under the collection and the
> commands send it themselves (with the scheme in front). What is still open is the `.env`-reference idea below for keys
> a user keeps only in `.env`.

# Endpoint commands can't use the key `key save` writes to .env

## Problem

`docstar-cli key save` puts a provider's API key in the project's `.env` (e.g. `HM_TOKEN=hm_...`) so the key
never reaches the AI assistant. But the generated endpoint commands (`docstar-cli <slug> <module> <endpoint>`)
don't read `.env`. They take the credential from a flag (`--Authorization "Bearer <key>"`) or from the
`credentials` saved by `config set`, which stores it in plain text in `~/.docstar/config.json`.

So to call an endpoint that needs the key, someone has to pass it on the command line. An assistant can avoid
printing it (`set -a; . ./.env; docstar-cli ... --Authorization "Bearer $HM_TOKEN"`), but then the value is in
the process arguments (visible in `ps`) and the assistant has to know the variable name and the header scheme.

## Repro

1. `docstar-cli init hm_demo --api http://localhost:2000`
2. `docstar-cli key request`, call the tool with the public key, `docstar-cli key save --payload ...` (writes `HM_TOKEN` to `.env`).
3. `docstar-cli hm_demo account whoami` answers 401 (no credential), although the key is in `.env`.

Found while testing the key handoff end to end (local `hm_demo` collection, fake provider).

## Suggested fix

- Let a credential name an env variable: `docstar-cli config set <slug> Authorization --env HM_TOKEN --prefix Bearer`,
  stored as a reference (`{env: 'HM_TOKEN', prefix: 'Bearer'}`), never the value.
- At run time, `loadCredentials` in `src/lib/http.ts` resolves the reference from the process environment, then from
  `./.env` (parsed, not sourced), and fails with a clear message when the variable is missing.
- Have `key save` offer to set that reference for the header the endpoints use, or have the tool's payload carry
  an optional `header` and `prefix` next to `envVar`.
- The MCP server (`docstar-cli mcp`) resolves it the same way, so assistants never see or handle the value.
