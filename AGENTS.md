# AGENTS.md — docstar-cli

## What this project is

`docstar-cli` is a terminal tool (built on [oclif](https://oclif.io)) that turns a DocStar docs
site's published API endpoints into real, runnable CLI commands and MCP tools. A user runs
`docstar-cli <slug> <module> <endpoint>` for any collection — **no `init` needed**: the contract is read
live from the docs on every call (2.0): one request for that endpoint's `module.json` (level 3). `docstar-cli init <slug>` only *registers* chosen modules
(shortcut command, completion, MCP tools) — no SDK, no hand-written request code.

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
- On-disk layout: only `~/.docstar/config.json` (registered modules + command names, saved keys) and
  `credentials.json` (sign-ins). Contracts and generated command files no longer exist (1.x kept them in
  `~/.docstar/modules/` and `dist/commands/`; `init`/`clean` remove those leftovers).
- MCP tool names: `<collection>__<module>__<endpoint>` (double underscore because MCP tool names
  can't contain spaces).

Exception: **root endpoints** (endpoints at the collection root, outside every module) skip the
module level: `docstar-cli <collection> <endpoint>`, tool `<collection>__<endpoint>`, read with
`scope=root` and registered as the pseudo-module `__root__` (`ROOT_MODULE_PATH`
in `src/lib/paths.ts`). Otherwise, don't flatten this hierarchy or add a shortcut that skips the collection level — multiple
collections can have modules with the same name (e.g. two different sites both having "slack"),
and the collection level is what disambiguates them.

## Where things live

- `bin/run.js` + `src/lib/dynamic.ts` — the core of 2.0. Before oclif runs, a first word that isn't a flag, matches
  `SLUG_PATTERN` and isn't a reserved slug is a collection: `runDynamic` reads its docs live and runs
  `<slug> <module> <endpoint> [--flags]` (`<slug> <endpoint>` for root endpoints, `<slug> <module>` lists a module,
  `<slug>` lists modules, `--help` prints an endpoint's flags). Flags are parsed with `util.parseArgs` from the
  contract (`src/lib/endpoint-flags.ts`: `flagSpecsOf`, `credentialNote`, `endpointHelp`). It runs outside oclif, so
  `runEndpoint` (`src/lib/run.ts`) talks through a small `RunIo` (`log`/`error`/`exit`/`login`) and ends with an
  `ExitSignal`. A typo like `lst` surfaces as "No collection". Never add a hidden oclif command or a new reserved
  slug for this.
- `src/lib/contracts.ts` — the only place the docs are read from, never saved or cached. `module.json` is a tree of three
  levels (hitman-api's `cli-rule.md` has the shapes): `fetchCollection` (modules), `fetchModuleIndex` (a module's / the root's
  index: per endpoint `command`, `aliases`, `parameters`, `credentials`, `headers`, `path`, `link`; **no endpoint data**; used
  by `list`, `init`, completion and `mcp` startup) and `fetchEndpoint(slug, module, command)` (`path=<module>/<command>`,
  `path=<command>` for a root endpoint: that one endpoint's full contract plus `auth`). The server finds the endpoint by page
  path or by the command name/alias typed, so a command run is **one request** with no index first. A 404 says collection vs
  endpoint. API base: `$DOCSTAR_API_URL`, else the registered collection's `api`, else `DEFAULT_API`.
- MCP and the CLI deliberately do **not** share an endpoint format: hosted MCP reads the llms.txt tree and `.openapi.yml`
  files, the CLI reads `module.json`. Don't add CLI-only fields to the OpenAPI files, and don't make the CLI parse them.
- `src/commands/init.ts` — **registration only**: fetches a collection's module list, shows an interactive
  multi-select checklist (nothing checked by default; a "Select all modules" entry selects everything), reads
  each selected module's index only for its command names, and stores `modules: [{name, path, commands}]` in
  `~/.docstar/config.json` (merged by collection slug, keeping saved keys), plus the `<slug>` shortcut. Nothing is
  downloaded or generated.
- `src/lib/auth.ts`, `src/lib/run.ts`, `src/lib/http.ts` (`executeCliCommand`, `endpointNeeds`) + `src/commands/login.ts`,
  `logout.ts`, `auth/status.ts` — how a call authenticates. **Sign-in is the default** where the collection has one: module.json's `auth`
  (`{headerName, tokenPrefix}`, from hitman-api's collection meta) names the header the `login` token goes in
  (e.g. `proxy_auth_token`); `auth: null` means no sign-in, so `login` is never asked for; an API that sends no `auth`
  (older) falls back to the stored sign-in's header, else `Authorization` (`signInHeaderOf`). An endpoint that sends
  that header gets the `login` token (not signed in -> exit 4 saying `docstar-cli login <slug>`), unless that header is
  marked as an API key or the user gave its value (flag, `config set`, `key save`). **API keys only where marked**, plus any other enabled header row with no value (`userValueHeaderRowsOf`: asked for as it is):
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
- `src/lib/http.ts` — `findEndpoint`, `executeEndpoint` (runs a contract just fetched), `executeCliCommand` (fetches
  then runs; what MCP-style callers use): builds and sends the actual HTTP request from an endpoint contract. This is where request-building
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

## Patterns added with 2.0.1

- **Exit codes** (`src/lib/run.ts`): 1 API error, 2 `EXIT_BAD_USAGE` (a required flag is missing and `canAsk()` is false, or an
  `InvalidParamError` from `buildBody`: a JSON-object body field given non-JSON), 4 credential missing. Prompts only run when
  `canAsk()` is true; never call an `@inquirer/prompts` function without that check.
- **Credential references**: `config set <slug> <name> --env VAR [--prefix Bearer]` stores no value (`credentialMeta.env`);
  `sendableCredentials` reads the variable from the environment or the project's `.env` (`readEnvFile`) on every call and
  leaves it empty (so it counts as missing) when unset.
- **Update notice**: oclif commands use `@oclif/plugin-warn-if-update-available`; endpoint commands run outside oclif, so
  `bin/run.js` calls `noticeIfOutdated` (`src/lib/update-check.ts`: daily cache in `~/.docstar/update-check.json`, refreshed by a
  detached process, stderr TTY only, never in CI or `mcp`). Switch off with `DOCSTAR_CLI_SKIP_NEW_VERSION_CHECK=1`.
- **Help** (`src/lib/endpoint-flags.ts`): flags state their shape (JSON object, list, boolean, number) from the docs' body
  template, name a look-alike twin (`content_type` body field vs `content-type` header), and `--help` ends with an example call.
