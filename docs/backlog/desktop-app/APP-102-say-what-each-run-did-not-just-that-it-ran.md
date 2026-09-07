---
id: APP-102
title: Say what each run did, not just that it ran
priority: P2
effort: XS
component: desktop-app
status: in-review
related: [APP-007, APP-084, MON-013]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-07
---

## Problem

Recent runs read "Store update · Your store was updated" three times in a
row, and a capture run was plain "Capture" (final pass 2026-09-07). Push and
deploy rows never carried a title; the summary is a closed vocabulary by
design (APP-007), so every push reads the same; and run naming only asked
Luna, so an owner signed in with Claude alone got no name at all.

## Proposed approach

Keep the closed vocabulary. A finished push already stores how many
publications it wrote, so the row says "19 publications on your store, 2 more
than before", computed at read time against the push before it. Deploy gets
two more summary keys that name the network it landed on. Run naming falls
back from Luna to whichever signed-in model is cheapest. Today shows five
runs so a push is visible beside the capture, synthesis, and deploy rows.

## Acceptance criteria

- [x] A finished push says how many publications the store serves and how
      that changed.
- [x] A deploy says whether the store went live on the test network or with
      real money.
- [x] A capture run gets a name when Claude is the only signed-in provider.
