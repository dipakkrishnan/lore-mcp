---
id: APP-247
title: Offer the update to a store opened for agents only
priority: P1
effort: S
component: desktop-app
status: ready
related: [APP-231, XC-067]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-26
---

## Problem

A store put online from 0.1.18 or earlier for personal agents only (the inbox, no sales) wrote neither `deployed.json` nor `payout.json`. After upgrading, `store_state()` (`lore/deploy.py`) returns `unknown` for it, and the app offers Update only for `outdated` (`app/desktop/src/renderer.js`). That store never gets the new Worker.

Found by the Codex review of v0.1.19 (Oct 25) and deferred past launch.

## Proposed approach

Recognize a store this Mac put online before the record was kept by something an inbox-only deploy does write, the way a payout record is recognized now. Write `deployed.json` on the next successful push so the check is one-time.

## Acceptance criteria

- [ ] An agents-only store deployed from 0.1.18 shows Update after upgrading
- [ ] A store set up from another Mac still shows nothing
