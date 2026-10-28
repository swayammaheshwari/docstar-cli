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

### 1. Run any collection — no setup

```sh
docstar-cli msg91 sms send-sms --template_id 123 --recipients '[...]'
```

Any collection works straight away: the CLI reads its docs when you run the command (so edits to the docs show up immediately), asks for anything missing (parameters, your API key, a sign-in) and calls the API. `docstar-cli msg91` lists the modules, `docstar-cli msg91 sms` the endpoints of a module, and `--help` on an endpoint its flags. Needs network access. To read the docs from another DocStar API (a local or dev one), set `DOCSTAR_API_URL`.

### 2. Register modules (optional)

```sh
docstar-cli init msg91
```

`msg91` is the collection's slug, not its domain. `init` also creates a `msg91` command, so you can run `msg91 <module> <endpoint>` instead of `docstar-cli msg91 <module> <endpoint>` (skip with `--no-alias`; for collections installed earlier run `docstar-cli alias msg91`). It sits next to `docstar-cli` on your PATH, or in `~/.docstar/bin` (add that to PATH) if no PATH directory is writable. The docs are read from `https://api.docstar.io`; to read them from another DocStar API (a local or dev one), pass `--api`:

```sh
docstar-cli init msg91 --api http://localhost:2000
```

This fetches the list of published modules for that collection and shows an interactive checklist (nothing checked by default — press `space` to toggle a module, or select the **"Select all modules"** entry at the bottom of the list to register everything, then `enter` to confirm). Registering only records the chosen modules and their command names in `~/.docstar/config.json`: it gives you the `<slug>` shortcut, shell completion for them, and their endpoints as MCP tools. Nothing is downloaded or generated.

The **slug** is chosen when the collection is created in DocStar (lowercase letters, numbers, `-` and `_` only) and never changes afterwards; the same slug identifies the collection for MCP. Running `init` for a different slug adds it alongside any others already registered — nothing gets overwritten.

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

## Sign-in and API keys

Each endpoint runs on **your sign-in** by default, or on an **API key** where the docs owner marked one.
The CLI checks what a call needs **before** calling, and says how to fix anything missing:

```sh
docstar-cli auth status msg91      # what msg91 needs, and whether it's set up
docstar-cli list msg91 otp         # each endpoint's "needs: …"
```

### Sign in (`login`)

If the docs owner set up sign-in (OAuth) for their DocStar MCP server, sign in once:

```sh
docstar-cli login msg91            # opens the sign-in page in your browser, waits until you're done
docstar-cli logout msg91           # forget the sign-in on this computer
```

- Every endpoint that sends the sign-in header (default `Authorization`) then gets your token, unless
  that header is marked as an API key or you passed its value yourself.
- Not signed in? In a terminal the CLI asks "Sign in now?" and runs `login`; run by an AI assistant or
  CI, it stops with the command to run (exit code 4).
- DocStar's API does the OAuth exchange with the owner's client secret; the CLI only gets your tokens and
  keeps them in `~/.docstar/credentials.json` (readable by you only). They're refreshed automatically.
- AI assistants that run one command at a time: `login msg91 --no-wait` prints the link and exits; after
  you've signed in, `login msg91 --continue` finishes. `--no-browser` only prints the link.

For the docs owner: add `https://api.docstar.io/p/cli-auth/callback` as a redirect URI in the OAuth app
used for MCP sign-in (DocStar lists it with the MCP callback URLs).

### API keys

For a header or query param the docs owner marked as an API key, the CLI sends your key: a flag on the
call (`--authkey <key>`), else the one saved with `config set` or `key save`. It never reads your
environment or `.env`. Missing in a terminal, it asks for the key (hidden) and offers to save it.

### Exit codes

`0` success, `1` the API answered with an error (4xx/5xx) or the call failed, `4` an API key or sign-in
is missing (the message says how to add it).

## Get an API key (`key request`, `key save`, `key emit`)

When a DocStar MCP tool creates an API key for you (for example a provider's "create API key" tool), the
key is never shown to your AI assistant and is not stored by DocStar. It is encrypted for your machine
only, in steps the assistant runs for you:

```sh
docstar-cli key request
# publicKey: pQUHZSURAptUbfObb9oi9qKKqycauP66Kw5phOBJUlE

# the assistant gives the publicKey to the MCP tool, which gets the key from the provider,
# encrypts it with the publicKey and returns these two commands:
docstar-cli key save --payload <encrypted key>        # stores the key in docstar-cli, under its collection
docstar-cli key emit msg91 authkey --env .env         # writes it to this project's .env
docstar-cli key emit msg91 authkey --env .env.local --var MSG91_KEY
```

`key request` makes a keypair and keeps the private key in `~/.docstar/pending-keys/` (readable by you
only, valid for 10 minutes). `key save` opens the payload with it and stores the key in
`~/.docstar/config.json` (readable by you only) under the collection, which must be installed with `init`;
that collection's commands then send the key themselves, with its scheme in front where the provider
chose one (`Authorization: Bearer <key>`). The private key is deleted afterwards, so a payload works once.
`key emit` writes the stored key to a project's env file as the variable the provider chose, keeping every
other line, makes the file readable by you only and adds it to `.gitignore`. These commands print only the
key's last 4 characters, since AI assistants read their output; `config get` does the same unless you pass
`--reveal`. Tool authors: the format is in [docs/key-handoff.md](docs/key-handoff.md).

## How it works

- Running `docstar-cli <slug> <module> <command>` makes one request to the DocStar API: `GET /p/generate-module-json?slug=<slug>&path=<module>/<command>`, that one endpoint's contract (method, url, base url, headers, query parameters, body, CLI parameter names, and the collection's sign-in header). The request is built from it. `docstar-cli <slug>` and `docstar-cli <slug> <module>` read the collection's modules and a module's list of endpoints (names and parameters only). Nothing is saved: every command reads the docs as they are. On a docs site the same levels are `/module.json`, `/<module>/module.json` and `/<module>/<endpoint>/module.json`.
- `docstar-cli init <slug>` only registers modules in `~/.docstar/config.json`. No command files are generated, so rebuilding this repo loses nothing.

## Development

```sh
npm run build   # compile TypeScript to dist/
npm run lint    # eslint
npm test        # mocha
```
