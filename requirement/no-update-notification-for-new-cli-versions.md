# The CLI never tells users a newer version exists

> **Status:** `@oclif/plugin-warn-if-update-available` is added in `package.json` (daily check, notice from the plugin on stderr). Skip it in CI with `DOCSTAR_CLI_SKIP_NEW_VERSION_CHECK=1`. Still to check: that nothing prints in `docstar-cli mcp`, and a real 1.x → newer run after the next npm publish.

## Problem
A user on an old version (for example 1.7) is never told when a newer one (2.0.0) is published. Nothing checks the npm registry, so they keep running the old CLI until they happen to reinstall. The only version message today is the key-payload error `The payload is from a newer version: update docstar-cli` (`src/lib/key-crypto.ts`), which appears only when the payload format changes.

## Repro
1. Install an older `docstar-cli` globally (`npm install -g docstar-cli@1.7.0`).
2. Publish a newer version to npm.
3. Run any command (`docstar-cli list`, `docstar-cli <collection> ...`, `docstar-cli mcp`). No notice appears, now or later.

Cause: `package.json` has `"oclif": { "plugins": ["@oclif/plugin-help"] }` only, and there is no `init` or `prerun` hook in `src/`.

## Suggested fix
Add `@oclif/plugin-warn-if-update-available` to `dependencies` and to `oclif.plugins`. Suggested config:

```json
"oclif": {
  "plugins": ["@oclif/plugin-help", "@oclif/plugin-warn-if-update-available"],
  "warn-if-update-available": {
    "timeoutInDays": 1,
    "message": "<%= config.name %> update available from <%= chalk.greenBright(config.version) %> to <%= chalk.greenBright(latest) %>. Run: npm install -g docstar-cli",
    "registry": "https://registry.npmjs.org"
  }
}
```

Requirements:
- The notice goes to **stderr** and never blocks or slows a command (the plugin checks in the background and caches the result for `timeoutInDays`).
- It must not print in `docstar-cli mcp` (stdio MCP server) or when output is piped or not a TTY, so it can't corrupt tool output. Verify this; if the plugin prints there, skip it for `mcp` with a custom `init` hook.
- Respect `DOCSTAR_CLI_SKIP_UPDATE_CHECK` or the plugin's `<BIN>_SKIP_NEW_VERSION_CHECK` for CI.
- Optional: for a major bump (1.x to 2.x), the message should say what changed and link the changelog.

## Notes
- Users must already be on a version that includes the plugin to see the notice, so the first release with it only helps from then on. Users on versions before that still need to update by hand once.
- Document the update command in the CLI help doc (`docstar.io/help/integrations/cli`).
