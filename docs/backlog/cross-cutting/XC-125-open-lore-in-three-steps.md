---
id: XC-125
title: Turn /download into an "Open Lore in 3 steps" page
priority: P2
effort: XS
component: cross-cutting
status: in-review
related: [APP-291, XC-093, APP-126]
blockers: []
dependencies: [APP-291]
github_issue: null
created: 2026-11-06
updated: 2026-11-12
---

## Problem

`yourlore.dev/download` was a bare 302 to a 331 MB zip on GitHub Releases. The page someone clicked from never
changed, so nothing told them where the file went or what to do with it, and `?bid=` (from a bid page's "Answer with
Lore") was dropped on the floor. Wispr Flow's download page is the bar: the page turns into "Open Wispr Flow in 3
steps" with the browser's downloads button pointed out.

## Proposed approach

- `/download` renders a page in the site frame. On a Mac it starts the download itself (a one-second meta refresh to
  the file: the browser saves it and stays on the page) and says: open the download from the browser's toolbar,
  double-click `Lore-macOS-arm64.dmg`, drag Lore into Applications and open it from there.
- Beside the steps, a drawn toolbar (not a screenshot) with the downloads button lit, the file in a popover under it,
  and an arrow to it, placed the way the visitor's browser places it: Chrome-family, Safari, Firefox, or generic,
  chosen from the user agent on the server.
- Off a Mac (a phone, a PC) nothing downloads: the page says Lore is for a Mac and offers "Send this page to your Mac"
  (the share sheet, so AirDrop on an iPhone) or the file.
- `?bid=<id>` (a bid id, nothing else) adds "Once Lore is open, answer the bid you came from" linking to `/b/<id>`.
- The download link becomes `releases/latest/download/Lore-macOS-arm64.dmg`, the disk image APP-291 adds to each
  release.

## Acceptance criteria

- [x] `/download` answers 200 with the three steps, `private, no-store` and `vary: user-agent`.
- [x] Each browser family gets its own step 1 wording and toolbar drawing.
- [x] Off a Mac there is no auto-download and no steps; the share button keeps `?bid=`.
- [x] A bid id comes back as a link to its page; anything else is ignored.
- [x] Light and dark, desktop and phone width, checked by screenshot.
- [ ] Deployed only after a release carries `Lore-macOS-arm64.dmg` (APP-291); before that the link 404s.

## Notes

**Prioritization (2026-11-12):** Priority P2 (was P1), effort XS (was S).
Stays in-review. Before it can be ready: APP-291 must complete (add it as a
blocker), then deploy and close. Prioritization flag (not acted on): done
(code).
