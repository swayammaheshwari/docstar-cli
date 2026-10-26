# docstar-cli

A CLI for calling published DocStar API endpoints directly from your terminal, without leaving the shell to read docs. Point it at a DocStar docs site, pick which modules (e.g. "Slack") you want, and it turns each published endpoint into a real command you can run. You can install from multiple docs sites/collections at once — each is kept separate under its own **slug**.

## Concepts: collection → module → endpoint

Every command follows a fixed three-level hierarchy:

1. **Collection** — a docs site, identified by its **slug** (e.g. `msg91`). This is what `docstar-cli init` installs.
2. **Module** — a top-level section within that collection (e.g. `slack`).
3. **Endpoint** — one published API within a module, turned into a command (e.g. `send-message-1`).

Put together: `docstar-cli <collection> <module> <endpoint> [--flags]`, e.g. `docstar-cli msg91 slack send-message-1 --message "hi"`.

## Install

```sh
npm install
npm run build
npm link
```

`npm link` puts `docstar-cli` on your PATH. Alternatively, run it without linking via `node ./bin/run.js <command>` from the repo root.

## Quick start

### 1. Discover and install modules

```sh
docstar-cli init msg91
```

`msg91` is the collection's slug, not its domain. The docs are read from `https://api.docstar.io`; to read them from another DocStar API (a local or dev one), pass `--api`:

```sh
docstar-cli init msg91 --api http://localhost:2000
```

This fetches the list of published modules for that collection and shows an interactive checklist (nothing checked by default — press `space` to toggle a module, or select the **"Select all modules"** entry at the bottom of the list to install everything, then `enter` to confirm). For each selected module it:

- saves its full endpoint contract to `~/.docstar/modules/<slug>/<module>.json`
- registers a real CLI command for every endpoint: `docstar-cli <slug> <module> <command>`

The **slug** is chosen when the collection is created in DocStar (lowercase letters, numbers, `-` and `_` only) and never changes afterwards; the same slug identifies the collection for MCP. Running `init` for a different slug adds it alongside any others already installed — nothing gets overwritten.

Everything is saved to `~/.docstar/config.json`, grouped by collection.

### 2. See what's installed

```sh
docstar-cli list                    # every installed collection
docstar-cli list msg91              # modules installed for the "msg91" collection
docstar-cli list msg91 slack        # Slack's installed endpoints in "msg91"
```

```
send-message-1
  send message
  POST
  required: message
```

### 3. Call an endpoint

```sh
docstar-cli msg91 slack send-message-1 --message "hello from the CLI"
```

Or omit required parameters and answer the prompts instead:

```sh
docstar-cli msg91 slack send-message-1
? Enter value for message
```

The command prints the response status and body from the actual API call.

### 4. Shell tab-completion

This is a purpose-built completion, not a generic "complete every command" plugin: it **only**
completes a module name (once you've typed a collection) and an endpoint name (once you've typed
a collection and module). It never completes the collection name itself, and never completes
top-level commands like `list`/`init`/`mcp` — you always type the collection by hand.

Set it up once (bash, or zsh with `bashcompinit` loaded):

```sh
echo 'eval "$(docstar-cli completion-script)"' >> ~/.bashrc   # or ~/.zshrc
```

Then, after typing a known collection name, `Tab` completes modules and endpoints:

```sh
docstar-cli msg91 sla<Tab>            # -> slack
docstar-cli msg91 slack send<Tab>     # -> send-message-1
```

## Use from an AI client (MCP)

`docstar-cli` can run as an [MCP](https://modelcontextprotocol.io) server, turning every installed
endpoint (across all installed collections) into a proper tool an AI client can call directly — no
shell access required.

```sh
docstar-cli mcp
```

Register it with Claude Code (`.mcp.json`) or Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "docstar": {
      "command": "docstar-cli",
      "args": ["mcp"]
    }
  }
}
```

Each installed endpoint becomes one tool named `<collection>__<module>__<endpoint>` (e.g.
`msg91__slack__send-message-1`) — the same collection → module → endpoint hierarchy described
above, just joined with `__` instead of spaces because MCP tool names can't contain spaces.
Required/optional parameters are exposed in the tool's schema. A prompt like "call the slack api
and send a message saying hi" resolves directly to that tool call — the AI client asks you for any
required value it can't infer, exactly like any other MCP tool. Run `docstar-cli init` first so
there's at least one installed module for `mcp` to expose.

## Get an API key into your .env (`key request`, `key save`)

When a DocStar MCP tool creates an API key for you (for example a provider's "create API key" tool), the
key is never shown to your AI assistant and is not stored by DocStar. It is encrypted for your machine
only, in two steps the assistant runs for you:

```sh
docstar-cli key request
# publicKey: pQUHZSURAptUbfObb9oi9qKKqycauP66Kw5phOBJUlE

# the assistant gives the publicKey to the MCP tool, which gets the key from the provider,
# encrypts it with the publicKey and returns this command:
docstar-cli key save --payload <encrypted key>             # writes the key to ./.env
docstar-cli key save --payload <encrypted key> --env .env.local
```

`key request` makes a keypair and keeps the private key in `~/.docstar/pending-keys/` (readable by you
only, valid for 10 minutes). `key save` opens the payload with it, sets the variable the provider chose
(e.g. `MSG91_AUTH_KEY`) in the env file, keeping every other line, makes the file readable by you only
and adds it to `.gitignore`. The private key is deleted afterwards, so a payload works once. Only the
key's last 4 characters are printed, since AI assistants read the command's output.

## How it works

- `docstar-cli init <slug>` talks to `GET /p/generate-module-json?slug=<slug>` (the collection's name, slug, and list of modules) and `GET /p/generate-module-json?slug=<slug>&path=<module>` (a module's endpoint contract, or `scope=root` for root endpoints) on the DocStar API.
- Each endpoint's contract (method, url, base url, headers, body, and CLI parameter names) is saved locally and used to build the real HTTP request when you run its command — no network round-trip to the docs site is needed to run a command once a module is installed.
- Commands are generated as real files on disk under this repo's `dist/commands/<slug>/<module>/`, which is why `npm run build` (it wipes `dist/`) requires re-running `docstar-cli init` for each installed collection afterwards to reinstall your modules.

## Development

```sh
npm run build   # compile TypeScript to dist/
npm run lint    # eslint
npm test        # mocha
```
