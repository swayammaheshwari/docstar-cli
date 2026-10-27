# AGENTS.md — docstar-cli

## What this project is

`docstar-cli` is a terminal tool (built on [oclif](https://oclif.io)) that turns a DocStar docs
site's published API endpoints into real, runnable CLI commands and MCP tools. A user runs
`docstar-cli init <slug>`, picks which modules they want, and gets a real command for every
endpoint in those modules — no SDK, no hand-written request code.

It talks to two sibling repos in this workspace:
- **hitman-api** — the backend. Owns `GET /p/generate-module-json`, which returns either a
  collection's module list (no `path` query param) or one module's full endpoint contract
  (`path=<module>` given). See `hitman-api/.agent/rules/cli-rule.md` for that contract in detail.
  `init` identifies the collection by `slug` (`?slug=<slug>`), against `https://api.docstar.io` unless
  `--api` is given: there is no domain or collection id any more.
- **hitman-ui** — thin proxy routes (`/p/module.json`, `/p/<module>/module.json`) in front of the
  same backend endpoint, kept for CLI versions before 1.6.0; the CLI no longer uses them. See
  `hitman-ui/.agent/rules/cli-rule.md`.

## The core concept: collection → module → endpoint

Every command follows a fixed three-level hierarchy, and this is the single most important thing
to understand about this codebase:

1. **Collection** — one DocStar docs site/collection, identified by its **slug** (e.g. `msg91`),
   stored in the collection's `slug` column (chosen at creation, never changes; lowercase letters,
   numbers, `-`, `_` only). A user can install multiple collections side by side.
2. **Module** — a top-level page/section within a collection (e.g. `slack`). Corresponds to a
   `type === 1` page in hitman-api.
3. **Endpoint** — one published API within a module (e.g. `send-message-1`), becomes one real CLI
   command.

This shows up everywhere in the code:
- Shell command shape: `docstar-cli <collection> <module> <endpoint> [--flags]`.
- On-disk layout: `~/.docstar/modules/<collection>/<module>.json`, generated commands under
  `dist/commands/<collection>/<module>/<endpoint>.js`.
- MCP tool names: `<collection>__<module>__<endpoint>` (double underscore because MCP tool names
  can't contain spaces).

Exception: **root endpoints** (endpoints at the collection root, outside every module) skip the
module level: `docstar-cli <collection> <endpoint>`, tool `<collection>__<endpoint>`, commands under
`dist/commands/<collection>/<endpoint>.js`, stored as the pseudo-module `__root__` (`ROOT_MODULE_PATH`
in `src/lib/paths.ts`). Otherwise, don't flatten this hierarchy or add a shortcut that skips the collection level — multiple
collections can have modules with the same name (e.g. two different sites both having "slack"),
and the collection level is what disambiguates them.

## Where things live

- `src/commands/init.ts` — fetches a collection's module list, shows an interactive multi-select
  checklist (nothing checked by default; a "Select all modules" entry at the bottom selects
  everything), fetches each selected module's contract, saves it to
  `~/.docstar/modules/<collection>/<module>.json`, and generates a real command file per endpoint.
  Merges into `~/.docstar/config.json` by collection slug — running `init` again for a
  different collection never wipes previously-installed ones.
- `src/lib/auth.ts`, `src/lib/run.ts`, `src/lib/http.ts` (`executeCliCommand`, `endpointNeeds`) + `src/commands/login.ts`,
  `logout.ts`, `auth/status.ts` — how a call authenticates. **Sign-in is the default**: an endpoint that sends the
  sign-in header (the sign-in's `tokenHeader`, default `Authorization`) gets the `login` token, unless that header is
  marked as an API key or the user gave its value (flag, `config set`, `key save`). **API keys only where marked**:
  a header/query row with `credential: "apiKey"` in module.json (marked by the docs owner; `apiKeyRowsOf`); the value is a
  flag, else the saved credential. Both are checked BEFORE calling (`MissingCredentialError`);
  `runEndpoint` asks in a TTY (hidden key, or runs `login`), else exits 4. hitman-api's `/p/cli-auth/*` holds the OAuth
  client secret; tokens are owner-only in `~/.docstar/credentials.json`, refreshed, retried once on 401. Never read the
  environment or `.env` for keys, and never print keys or tokens: AI assistants read this CLI's output.
- `src/commands/key/request.ts`, `key/save.ts`, `key/emit.ts`, `src/lib/key-crypto.ts`, `src/lib/credentials.ts` — getting a
  provider's API key to the user without it passing through the AI assistant or being stored on a server. `key request`
  makes an X25519 keypair, keeps the private key in `~/.docstar/pending-keys/` (owner-only, 10 minutes) and prints the
  public key (which is also the request id); the MCP tool encrypts the key with it and returns a payload; `key save`
  decrypts it and stores the key under its collection in `~/.docstar/config.json` (`credentials` plus `credentialMeta`
  with the env variable and header scheme; `sendableCredentials` puts the scheme in front when requests are made);
  `key emit <slug> <name> --env` writes it to a project's env file. These commands never print the key (last 4
  characters only; `config get` masks too, `--reveal` shows). Format and a reference encrypt function: `docs/key-handoff.md`.
- `src/lib/slug.ts` — slug rules shared by `init`: `RESERVED_SLUGS` (the CLI's own command names) must match
  hitman-api's `utils/slug.js`, which refuses them when a collection is created.
- `src/commands/list.ts` — `list` (all installed collections) / `list <collection>` (its modules)
  / `list <collection> <module>` (that module's endpoints). Purely reads what's already saved
  locally, no network call.
- `src/commands/mcp.ts` — starts a stdio MCP server exposing every installed endpoint (across
  every installed collection) as a tool, executed in-process via `src/lib/http.ts`.
- `src/lib/codegen.ts` — generates the actual oclif command `.js` files under
  `dist/commands/<collection>/<module>/`. These files are **regenerated by `init`, not
  hand-edited**, and are wiped by `npm run build` (`shx rm -rf dist`) — re-run `init` for every
  installed collection after a rebuild.
- `src/lib/http.ts` — `loadModule`, `findEndpoint`, `executeCliCommand`: builds and sends the
  actual HTTP request from a saved endpoint contract. This is where request-building
  correctness bugs live if a call fails unexpectedly. Two real bugs were found and fixed here —
  know about them before "fixing" something that looks similar:
  - **Type coercion**: CLI flags always arrive as strings. `buildBody` must coerce them back to
    the JSON template's original type (`coerceToTemplateType`) — a boolean field must become a
    real `true`/`false`, an array field must become a real array, not the literal string `"true"`
    or a comma-joined string.
  - **Duplicate case-variant headers**: the docs editor can store two header entries that only
    differ by case (e.g. `Content-Type` and `content-type`). Sending both as separate header
    lines via `fetch` has been observed to silently break body parsing on the receiving server.
    `buildHeaders` dedupes by lowercased header name — keep that dedup if you touch this function.
  - Endpoint `url`/`headers` values may contain literal `<span text-block="true">...</span>`
    markup from the rich-text docs editor — `stripHtml` unwraps it. This is docstar-cli's job, not
    the backend's or the UI proxy's.
- `src/lib/prompt.ts` — `promptForMissingParams`: generated commands prompt interactively for any
  required parameter not passed as a flag, so `docstar-cli <collection> <module> <endpoint>` works
  even with zero flags.
- `src/lib/complete.ts` + `src/commands/complete.ts` (hidden) + `src/commands/completion-script.ts`
  — shell tab-completion. This is deliberately **not** the generic `@oclif/plugin-autocomplete`
  plugin (it was tried and removed) — that plugin completes every registered command/topic,
  including the collection name and noise like `list`/`init`/`mcp`. The actual requirement is
  narrower: only complete a module name (once a collection is typed) and an endpoint name (once a
  collection + module are typed); never suggest the collection itself or a top-level command.
  `completion-script` prints a bash function (`complete -F`) that shells back out to the hidden
  `complete` command only at the module/endpoint argument positions.

## Versioning

**Whenever you (an AI agent) make a code change to this project, bump the `version` field in
`package.json` before finishing** — a patch bump (`x.y.Z`) for a fix or small internal change, a
minor bump (`x.Y.0`) for a new user-facing command/flag/capability. Do this as part of the same
change, not as a follow-up someone has to remember to do.

**Whenever you bump the version, also write a `changelog/<version>.md` file** (matching the new
version number, e.g. `changelog/1.2.0.md`) summarizing what changed — grouped into "New features"
and "Bug fixes" as appropriate. Do this in the same change as the version bump, not as a
follow-up.
