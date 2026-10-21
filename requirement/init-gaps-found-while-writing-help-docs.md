# CLI gaps found while writing the Help Doc CLI page

## 1. `init` fails for docs sites without a custom domain
- **Problem:** `init` expects a custom domain. A docs site served only from `<slug>.docstar.io` (or the default DocStar host) can't be initialised.
- **Repro:** run `docstar-cli init` against a collection with no custom domain.
- **Suggested fix:** accept the collection slug and fall back to the default DocStar host and `/p/module.json`.

## 2. `init` doesn't accept a domain with a path
- **Problem:** a docs site published under a path (e.g. `example.com/docs`) is rejected or resolved to the wrong host.
- **Repro:** `docstar-cli init https://example.com/docs`.
- **Suggested fix:** keep the path prefix when building the `module.json` URL.

## 3. Global npm install can fail on write permission
- **Problem:** `npm install -g` fails with EACCES on systems where the global prefix isn't user-writable, and the CLI docs give no workaround.
- **Suggested fix:** document a user-level npm prefix or `npx`, and add a clear error hint in the installer docs.
