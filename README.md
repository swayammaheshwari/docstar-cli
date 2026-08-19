# docstar-cli

A CLI for calling published DocStar API endpoints directly from your terminal, without leaving the shell to read docs. Point it at a DocStar docs site, pick which modules (e.g. "Slack") you want, and it turns each published endpoint into a real command you can run.

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
docstar-cli init docs.msg91.com
```

For a local/non-custom-domain docs site, pass the collection id explicitly:

```sh
docstar-cli init localhost:3000 --collectionId paM4R4A26Hvb
```

This fetches the list of published modules for that site, shows an interactive checklist (all modules pre-checked — press `space` to toggle, `enter` to confirm), and for each selected module:

- saves its full endpoint contract to `~/.docstar/modules/<module>.json`
- registers a real CLI command for every endpoint in that module
- registers a `<module> list` command

Overall settings (domain, collection, installed modules) are saved to `~/.docstar/config.json`.

### 2. See what's available in a module

```sh
docstar-cli slack list
```

```
send-message-1
  send message
  POST
  required: MY_SECRET_KEY
```

### 3. Call an endpoint

Pass required parameters as flags:

```sh
docstar-cli slack send-message-1 --MY_SECRET_KEY "hello from the CLI"
```

Or omit them and answer the prompts instead:

```sh
docstar-cli slack send-message-1
? Enter value for MY_SECRET_KEY
```

The command prints the response status and body from the actual API call.

## How it works

- `docstar-cli init` talks to `GET /p/module.json?collectionId=...` (list of modules) and `GET /p/<module>/module.json?collectionId=...` (a module's endpoint contract) on the docs site.
- Each endpoint's contract (method, url, base url, headers, body, and CLI parameter names) is saved locally and used to build the real HTTP request when you run its command — no network round-trip to the docs site is needed to run a command once a module is installed.
- Commands are generated as real files on disk under this repo's `dist/commands/<module>/`, which is why `npm run build` (it wipes `dist/`) requires re-running `docstar-cli init` afterwards to reinstall your modules.

## Development

```sh
npm run build   # compile TypeScript to dist/
npm run lint    # eslint
npm test        # mocha
```
