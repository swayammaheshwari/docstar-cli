# Published package ships stale test commands

## Problem
`docstar-cli@2.0.1` on npm contains command folders that have no source in `src/commands`:
`api-test`, `auth_testing`, `dump-test`, `github`, `hm_demo`, `reqres`. They show up as topics in
`docstar-cli --help` for every user (for example "hm_demo: Creates an hm_ token for the signed-in user").

## Cause
`"build": "tsc -b"` never deletes `dist/`, and `package.json` `files` ships `./dist`. Command folders that
were generated into `dist/commands` during local testing survived every later build and were packed.

## Repro
1. `npx -y docstar-cli@2.0.1 --help` and read the TOPICS list.
2. `ls ~/.npm/_npx/*/node_modules/docstar-cli/dist/commands` shows the extra folders.

## Fix
- `build` is now `rm -rf dist && tsc -b --force`, so a build contains only what `src` produces.
- Verified: `dist/commands` has no test folders and `npm pack --dry-run` lists none of them.
- Still to do by a maintainer: publish a new version (2.0.2) so users stop receiving the old files.
