# CLI metadata goes stale when an endpoint's docs are edited

Found on 2026-10-19 while correcting the Docstar_mcp docs (developers.docstar.io) against the hitman-api code.

## 1. `cli.description` and `cli.parameters` don't follow edits to the endpoint docs
- **Problem:** each endpoint in the module JSON carries a `cli` block (`description`, `parameters.required/optional`) next to the visible `description`. After an endpoint was edited and republished, the visible `description` and `sampleResponse` were new, but the `cli` block still held the old text. The CLI help and the MCP tool descriptions are built from `cli`, so they keep showing the old behaviour.
- **Repro:**
  1. Edit "Set Default Published Version" (page id `imBCbJ2h2f3X`) with `update_endpoint`, adding an "Errors:" sentence to `description`.
  2. Publish it (`publish_pages`).
  3. Call `get_docstar_api_docs` with `{ "path": "published-versions" }`: the top-level `description` has the "Errors:" text, `cli.description` does not.
  4. Same for Create Collection (`n2B-bmjjd1MO`): the CLI text still says hyphens are allowed in the slug and `isPublic` defaults to false.
- **Not investigated:** whether `cli` is stored separately, generated once at create time, or regenerated only by another path. `update_endpoint` has no field for it.
- **Suggested fix:** derive `cli.description` and `cli.parameters` from the endpoint fields on every publish (see hitman-api `generate-module-json` and `.agent/rules/cli-rule.md`), or document how to refresh them.

## 2. `cli.parameters.required` lists optional fields
- **Problem:** it lists fields that the body or Joi schema treats as optional.
- **Examples:**
  - Import Collection (JSON Body): `required` is `["0","spec","orgName"]`; `orgName` is optional and `"0"` is a leftover path-variable key (the key itself was fixed to `orgId`).
  - Generate FAQs Async: `webhookUrl` is listed as required but is optional.
  - Find Matches: `collectionIds` and `getUrl` are listed as required, but only `query` is.
  - Trigger Page Content Updated: `isEmbed` is listed as required, but the body says optional.
  - Update Page, Update Endpoint: optional body fields are listed as required.
- **Impact:** the CLI rejects calls that omit a field the API doesn't need.
- **Suggested fix:** compute required/optional from the endpoint's own `checked`/`required` flags and the body field descriptions, not from a one-off snapshot.
