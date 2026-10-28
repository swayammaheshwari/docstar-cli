# Required-parameter prompt crashes when nobody is at a terminal

## Problem
An endpoint command with required parameters the user did not pass asks for them with an interactive prompt
(`promptForMissingParams` in `src/lib/prompt.ts`). It does not check for a terminal, unlike the credential prompts in
`src/lib/run.ts` (`canAsk`). With no TTY (an AI assistant, CI, `</dev/null`) the prompt aborts: the process dies with
"User force closed the prompt" (exit 13) and, since 2.0, Node also prints "Warning: Detected unsettled top-level await"
for `bin/run.js`. The caller never learns which parameters were missing.

## Repro
```sh
docstar-cli msg91 sms send-sms </dev/null
# ? Enter value for template_id ... User force closed the prompt with 13 null
```

## Suggested fix
In `runEndpoint`, when `canAsk()` is false and a required parameter is missing, stop before calling with exit 2 and a
message naming the missing flags (`--template_id --recipients ...`), the same way a missing credential exits 4.
`promptForMissingParams` should only run when `canAsk()` is true.
