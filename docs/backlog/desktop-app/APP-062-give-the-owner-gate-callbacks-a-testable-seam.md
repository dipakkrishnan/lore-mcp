---
id: APP-062
title: Give main.cjs's owner-gate callbacks a testable seam
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-056, APP-057, APP-006, APP-066]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-03
updated: 2026-09-03
---

## Problem

Every attended owner action runs through a callback defined inline inside
`start()` in `app/desktop/src/main.cjs`. They are closures over `agent`,
`request()` and `loreHome`, so nothing outside a running Electron process can
call them, and `test/app.test.cjs` doesn't. What that leaves untested is not
plumbing — it's the wording and the branching the owner actually meets:

- **`openUrl`** — `openable()` is unit-tested, but the refusal string for an
  address off the allowlist is not, and neither is the mapping from the
  owner's answer to what the agent is told (`done` → "verify from state before
  going on", `stuck` → "ask what happened", anything else → declined). The
  agent's next move depends on which of those three it gets.
- **`storeSecret`** — an empty paste must return "The owner did not provide
  it" rather than vaulting a blank, and the value must reach
  `lore node secret <NAME>` over stdin and never appear in the tool result.
  The tool's own description promises the agent never sees it; no test holds
  that promise.
- **`cloudflareLogin`** — the decline path, the `https://dash.cloudflare.com/`
  URL extraction from streamed output, and the error unwrap that strips a
  leading `lore: ` off the last line. Line-scraping logic with no test.
- **`before-quit`** — every pending owner request is rejected with "Lore
  closed". `closingRecord` covers the session side of an interrupted turn;
  the renderer-facing rejection is untested.

`agent.mjs`'s `#attended` wraps each of these with a `needs_you` record and a
`finally` that restores `working`. That the record is restored even when the
owner declines or the callback throws is the reason the app doesn't strand a
task in "needs you" forever — also untested.

## Proposed approach

Lift the callbacks out of `start()` into a module (e.g.
`src/owner.cjs`) that takes its dependencies as arguments — `request`, `lore`,
`loreStream`, `emit`, `openable` — and have `start()` build them from that.
`state.cjs` already demonstrates the shape: pure-ish functions over an
injected runtime, tested with a stub binary and a scratch home. Then test the
branches above directly, plus one `#attended` test asserting the task record
returns to `working` after a throw.

## Acceptance criteria

- [ ] The owner-gate callbacks live in a module importable from
      `node --test` without Electron.
- [ ] `openUrl`'s refusal and its three answer mappings each have a test.
- [ ] `storeSecret` refuses an empty value, and a test asserts the secret
      reaches the CLI over stdin and is absent from the returned text.
- [ ] `cloudflareLogin`'s decline path, dash-URL extraction, and error unwrap
      each have a test.
- [ ] A pending owner request rejects on quit, and `#attended` restores
      `working` when its action throws.

## Notes

Found while auditing desktop test coverage (2026-09-03). `agent.mjs`'s
exported surface is well covered by contrast — every export it has is reached
by `test/app.test.cjs`; the gap is specifically the Electron-only half in
`main.cjs`. The four tool handlers that funnel through `#attended`
(`cloudflare_login`, `open_url`, `store_secret`, `finish_task`) have no direct
test either, which is the same gap seen from the agent's side.
