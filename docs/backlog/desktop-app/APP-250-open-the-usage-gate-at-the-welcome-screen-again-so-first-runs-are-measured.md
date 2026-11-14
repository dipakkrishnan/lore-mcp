---
id: APP-250
title: Open the usage gate at the welcome screen again so first runs are measured
priority: P3
effort: XS
component: desktop-app
status: in-review
related: [XC-090, XC-092, APP-058, APP-199]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-11-13
---

## Problem

APP-199 (ddc4bdf6, #446) removed the welcome screen's usage line and its `usage("noticed")` call.
Since then, a new install only becomes "noticed" when the Today notice shows, after the first run.
`lore/usage.py` drops every event before that, with no queue. So sign-in, the first-run chat, and
a first-run Cloudflare attempt are never seen. `signin.completed` has arrived 2 times ever, and
installs that give up before Today send nothing at all. PRIVACY.md still says the notice is on the
welcome screen.

## Proposed approach

Put the one-line disclosure back on the welcome screen. Call `usage("noticed")` when it renders,
as #428 did. Keep the Today notice for installs that predate it. Add a once-per-install
`app.installed` event sent right after, so first launches can be counted. That number is the
install ground truth that GitHub's download_count (which includes auto-updates) can't give.

## Acceptance criteria

- [ ] A fresh LORE_HOME, launched and signed in, logs `app.installed`, `signin.completed`, and
      `app.opened` in `~/.lore/usage.log` before the first-run chat ends.
- [x] The welcome screen shows the disclosure, matching PRIVACY.md.
- [x] `app.installed` is in contracts/usage_events.json, and the relay test accepts it.
- [x] Telemetry off still sends nothing.

## Notes

From the Oct 28 metrics audit: PostHog shows 2 new installs since launch, while RUM shows ~93
visits and GitHub shows 23 v0.1.19 downloads. That gap can't be explained until this lands.

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.

**Prioritization (2026-11-12):** Priority P3 (was P0). Stays in-review.
Before it can be ready: Run criterion 1 once on a fresh LORE_HOME, then
close. Prioritization flag (not acted on): done: #634.

**Close-out (2026-11-13):** stays in-review. Shipped in 6611fc01 (#634). Criteria
2-4 are on main:
- **Disclosure.** `USAGE_NOTICE` and `noticed()` (`app/desktop/src/renderer.js`
  ~6604-6609) send `usage("noticed")` and then `usage("app.installed")` from the
  welcome screen. `PRIVACY.md:27` says the notice is on the welcome screen.
- **Contract.** `contracts/usage_events.json:4` lists `app.installed`.
  `feedback-relay/test/events.test.ts` imports that contract, and
  `tests/test_usage_rules.py:22` covers it. `ipc.cjs:19` allows it.
- **Telemetry off.** `tests/test_usage.py::test_nothing_is_sent_with_telemetry_off`.
- **Ordering.** The renderer unit tests (`renderer-harness.test.cjs:47`,
  `renderer-notices.test.cjs:69`) assert noticed, app.installed, app.opened.

What remains is criterion 1 only, a manual run. Launch on a fresh `LORE_HOME`,
sign in, and confirm that `~/.lore/usage.log` has `app.installed`,
`signin.completed` (recorded at `ipc.cjs:142`) and `app.opened` before the
first-run chat ends. No walk or test reads `usage.log` end to end. Record the
run here and close.
