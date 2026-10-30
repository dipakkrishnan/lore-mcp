---
id: APP-265
title: Report a setup failure when Lore's own command line is what failed
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-182, APP-105, APP-181, XC-028, XC-085]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

APP-182 asks for Report this problem on the setup failure screen, sending the full
error. On the failures that matter most, today's code can't do that. This comes from
reading the code, not from running a packaged build.

- **There is no error to send.** uv's output goes only to `console.error`
  (`runtime.cjs`), and what reaches `boot()` is `<resources>/uv exited with N`.
- **`lore` isn't usable.** When `provision()` throws, `useRuntime` never runs, so
  `lore()` falls back to `uv run lore` and answers "Lore could not finish that". Dev
  builds skip `provision()`, so a dev test misleads.
- **The one permitted path needs `lore`.** `lore/feedback.py` says neither surface
  talks to the relay directly: both go through that module, which needs the `Store`
  and the spool. An unwritable `~/.lore`, APP-182's own example, breaks it too.
- **The likeliest failure has no network.** Python isn't bundled; uv fetches it. With
  no network there's no Python and no relay either, so a direct send alone doesn't
  cover it.
- **The way in is hidden.** The feedback button waits for a snapshot, which comes from
  `lore`, and the setup screen only offers Try again. The `feedback:report` IPC itself
  isn't gated.

Failures after `useRuntime` (loading the agent) leave `lore` working, so reporting can
already work there once the button is reachable.

## Proposed approach

Capture uv's last lines, then pick a route. **Decision needed**, since option 3
changes a rule XC-028 set:

1. A pre-filled GitHub issue link or Copy details: no relay, the owner sees everything,
   needs a GitHub account and a connection.
2. Save locally and send after the next successful setup: nothing lost, but an owner
   who never recovers never reports.
3. A sender in the app: amends `feedback.py`'s rule and the contract, and has to
   produce `install_id` and the spool without the `Store`.
4. Bundle Python: removes the main failure instead of reporting it.

The report becomes a public issue, and `PRIVACY.md` promises nothing leaves unless the
owner submits the form. So the owner sees the exact text first, and it's built from an
allowlist (cause class, exit code, capped uv lines passed through redaction). Replacing
the home path alone misses `/Volumes/<name>`, percent-encoded paths, case variants and
proxy URLs with credentials.

## Acceptance criteria

- [ ] With `provision` failing in a packaged-style test (uv stubbed to exit 1 with a
      path and a proxy URL in its output), the setup screen offers Report this problem
      without a snapshot.
- [ ] uv's last lines are captured in memory and written to a log file.
- [ ] The owner sees the exact text before sending, and nothing leaves until they
      submit.
- [ ] The text has no home path (fixtures: a home with spaces, `+`, a different case,
      percent-encoding) and no URL credentials.
- [ ] With the network off, the report isn't lost and the owner is told where it is.
- [ ] Setup failing after `useRuntime` still sends through `lore report-feedback`.

## Notes

Effort S is for option 1; the others are unsized. XC-085's Send details and APP-181's
"reachable for a bug report" need the same redaction, so they should share it.
