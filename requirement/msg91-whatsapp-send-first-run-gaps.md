# MSG91 WhatsApp send: what is still open

The CLI side of the first-run gaps is fixed (invalid `--payload` JSON exits 2 with a message, `--help` shows each body field's
shape, tells `--content_type` (body field) from `--content-type` (header), and prints an example call; a required flag with
no terminal exits 2 naming the flags). What remains is in the MSG91 collection's docs, not the CLI:

## `send-message-in-text` marks every field optional
`integrated_number`, `recipient_number`, `content_type` and `text` are all listed as optional, but the API cannot work without
them. The CLI only knows what the docs say, so it neither prompts for them nor lists them as required.
- **Fix:** in the MSG91 collection, mark the four fields required on that endpoint (path/query params: required flag; JSON body
  fields are required unless their description says "optional"), then republish.

## Not tested
A real send (needs a real authkey and a WhatsApp integrated number), and the MCP path (`docstar-cli mcp` and the hosted
DocStar MCP tools).
