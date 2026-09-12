---
id: APP-085
title: Surface a readable error when a CLI read fails at launch
priority: P2
effort: S
component: desktop-app
status: completed
related: [APP-089, MON-018]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-06
---

## Problem

On launch of the owner's real Lore (2026-09-05 14:56), the main process
logged `Error occurred in handler for 'store:sales': Error: }`. The CLI
wrapper (`state.cjs:33`) reports only the last line of stderr, which here was
a closing brace, so the log says nothing about what failed. The same command
succeeds when run by hand a few minutes later, so it looks like a race at
startup (runtime provisioning or two instances starting at once), but the
message gives no way to tell. The For Sale view loaded normally afterwards.

## Proposed approach

Keep the full stderr in the thrown error's cause and log it, while still
showing the owner the last meaningful line. Delay reads that hit the CLI
until provisioning reports the binary is present.

## Acceptance criteria

- [x] A CLI failure logs the complete stderr, not only its last line.
- [x] No `store:sales` error is logged on a normal launch of a configured Lore.

## Notes

Reproduction attempts: `runtime/bin/lore node sales --json` against `~/.lore`
returns `[]` with exit 0. Log kept in the 2026-09-05 session evidence
(`logs/current.log`).

Done 2026-09-06. Root cause of the lone `}`: `lore node sales` runs
`wrangler d1 execute --json`, and under `--json` wrangler reports a refused
request as a pretty-printed JSON object (`{"error": {"text": "A request to
the Cloudflare API (...) failed.", "notes": [{"text": "Authentication error
[code: 10000]"}], ...}}`), reproduced by running the same command with a bad
token. `deploy.sales()` raised the whole blob, `cli.main` printed it to
stderr, and `state.cjs` kept only its last line: `}`. What Cloudflare
refused at 14:56 was not preserved, so it cannot be named; the most likely
cause is the same first-request-after-sign-in-refresh refusal that
`lore push` already retries once (APP-089), since the read succeeded by hand
minutes later and three consecutive reads of the live node succeed today.

Fix: `deploy._run` learned two things every wrangler call benefits from: a
`retry` flag with the push's pause, and a failure detail that recognises
wrangler's JSON refusal and reports Cloudflare's sentence on one line with
the account/database path stripped. `sales()` passes `retry=True`;
`state.cjs` logs the complete stderr of any failed CLI call before throwing
the last line; Sales shows the line with a Try again button.
Not a startup race: For Sale reads the ledger only when opened, after
provisioning, so no read is delayed behind the binary check.
