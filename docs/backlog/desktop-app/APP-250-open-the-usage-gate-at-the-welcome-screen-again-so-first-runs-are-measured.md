---
id: APP-250
title: Open the usage gate at the welcome screen again so first runs are measured
priority: P0
effort: XS
component: desktop-app
status: ideation
related: [XC-090, XC-092, APP-058, APP-199]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
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
- [ ] The welcome screen shows the disclosure, matching PRIVACY.md.
- [ ] `app.installed` is in contracts/usage_events.json, and the relay test accepts it.
- [ ] Telemetry off still sends nothing.

## Notes

From the Oct 28 metrics audit: PostHog shows 2 new installs since launch, while RUM shows ~93
visits and GitHub shows 23 v0.1.19 downloads. That gap can't be explained until this lands.

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
