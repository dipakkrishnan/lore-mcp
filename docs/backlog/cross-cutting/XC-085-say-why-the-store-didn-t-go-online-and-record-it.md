---
id: XC-085
title: Say why the store didn't go online, and record it
priority: P0
effort: S
component: cross-cutting
status: ideation
related: [XC-086, XC-087, APP-249, XC-090, APP-250, XC-069, APP-058]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

When "Set it up" fails, the app shows "Your store didn't go online. Try again in a
minute." for every cause except two, and the reason is lost:
`deployStore` keeps only the `lore: deploy failed:` line and drops the reason on the
next line (`state.cjs:408`); `main.cjs:371` only `console.error`s it; and `cli.failed`
carries no reason. A first-time user (Oct 27 launch) hit it four times and we can't
tell why. "Try again in a minute" is false for most causes.

## Proposed approach

- The CLI prints one summary line `lore: <reason>` for store failures (no trailing
  colon + detail), and the full detail to `~/.lore/logs/store.log`.
- `deployStore` returns the summary plus the log path; the agent's `open_store` sees it too.
- Classify into a closed set (no_subdomain, email_unverified, many_accounts,
  exists_elsewhere, not_answering, timeout, other) in `deploy.py`; send it as a coded
  property on a new `store.failed` event, plus `store.online` on inbox-only success.
  Add both to `contracts/usage_events.json`.
- Plain copy per reason; the unknown case offers "Send details" via the feedback report.

## Acceptance criteria

- [ ] A failed deploy's reason line reaches the renderer and the agent, not just "deploy failed".
- [ ] `~/.lore/logs/store.log` holds the full failure; no account ids or emails in telemetry.
- [ ] PostHog shows `store.failed{reason}` and `store.online`; the relay accepts them.
- [ ] No user-facing message says "try again in a minute" for a cause a minute can't fix.
- [ ] Tests cover each reason's classification from real wrangler output.

## Notes

One launch-day install: four `cli.failed node` 14:39–14:42Z Oct 27, then gave up.

Merged with the metrics audit's draft: also emit `store.attempted`, and make the first-run "online for agents only" path fire `store.online` (today `store.opened` fires only on a full for-sale deploy). Reason codes already exist in `lore/deploy.py`; reuse them.

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
