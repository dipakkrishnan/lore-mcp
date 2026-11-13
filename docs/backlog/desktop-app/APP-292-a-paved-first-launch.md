---
id: APP-292
title: A paved first launch, from the move prompt to the first AI connected
priority: P3
effort: S
component: desktop-app
status: in-review
related: [APP-215, APP-126]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-06
updated: 2026-11-12
---

## Problem

A Nov 6 walk of v0.1.24 as a new user, from yourlore.dev to the Inbox, found the first launch rougher than the rest:

- Opened from Downloads (or, once APP-291 ships, from the installer), Lore asks to move to Applications in a box with
  no window, which on macOS holds the whole app: the window loaded behind it takes no clicks until it's answered.
- The welcome screen still says "Turn what you've learned into pieces agents pay for", while the site says "Private
  memory you can sell to agents."
- First run says "Connected Obsidian, Codex and 1 more" for three apps, offers Muse greyed out as "Coming soon", and
  repeats the note about Lore's own routines under every step and again on the Inbox.
- Connecting Claude when its app isn't on this Mac is three steps by hand on the web, with "Private link, shown once"
  and no way on but Skip for now at the top of the page.

## Proposed approach

- The move prompt is a sheet on Lore's window; run from a mounted disk image it says Lore is running from its installer.
- The welcome headline matches the site's.
- First run names up to three apps, drops Muse from its question, and leaves the routines note to the Inbox.
- An agent with no app on this Mac gets Open <agent>, which copies the link and opens its connector settings on the
  web; the wait line gets Do this later; the link note says Connectors makes a new one.

## Acceptance criteria

- [ ] Launched outside Applications, the move prompt is a sheet on Lore's window instead of an app-wide alert, and setup keeps running behind it.
- [ ] Run from /Volumes, the prompt reads "Lore is running from its installer".
- [ ] First run with three apps found says all three names; Muse is not offered in first run (Connectors still lists it).
- [ ] The routines note shows once, on the Inbox, not in the first-run chat.
- [ ] Claude, not installed: Open Claude copies the link and opens claude.ai's connector settings; Do this later lands
      on the Inbox like Skip for now.
- [ ] Desktop tests and the agents/fresh walks pass.

## Notes

**Prioritization (2026-11-12):** Priority P3 (was P1). Stays in-review.
Before it can be ready: Close as completed. Prioritization flag (not acted
on): done: #671.
