---
id: APP-093
title: Show a taken-down publication the store still serves as pending removal
priority: P1
effort: S
component: desktop-app
status: completed
related: [MON-004, MON-013, APP-091, APP-089]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-06
updated: 2026-09-06
---

## Problem

Taking a publication down pushes the change to the node as part of the
revoke (MON-004). When that push fails, the app set an in-memory banner ("It
stays on sale until you push") and nothing else: `unpushed()` counted only
approved items the node lacked, never revoked items the node still held. Quit
and relaunch, and For Sale said "Revoked" under Taken down while a buyer's
agent could still pay for it, with no Push offered anywhere (audit
2026-09-06). The banner also appeared after a push that had succeeded, since
the revoke command already pushed. The failed-push notice was the CLI's
sentence, naming `--worker-dir` and a path, and the take-down confirmation
said "Buyers lose it for good", which a downloaded copy makes untrue.

## Proposed approach

Derive both directions of drift from the snapshot the app already reads:
approved items with `live === false` and revoked items with `live === true`.
Drop the banner. Label a still-served revoked item "Still on your store",
count it under Today's standing Push row and the For Sale push button, and
say the failed push in plain words from the typed revoke handler.

## Acceptance criteria

- [x] After a take-down whose push failed, relaunching still shows the item as still on the store and offers Push on For Sale and under Needs you.
- [x] A take-down whose push succeeded shows no push offer.
- [x] The failed-push notice names no command or path.
- [x] The take-down confirmation does not claim buyers lose copies they already have.
- [x] The For Sale heading says "N not on your store yet", not "N on your store yet".

## Notes

Done 2026-09-06. `unpushed(s)` is now `item.live === (item.state ===
"revoked")` over the snapshot, which the probe cache keeps fresh for a
minute and a push invalidates. Walked in `support/edge.sh store`: the
scratch home has no node source, so the revoke's push fails there, which is
exactly the state this item is about; the harness then re-seeds the probe
cache as a node that still lists the item and checks For Sale, Today and
the notice. The "Not live yet" chip check in the harness was stale since
APP-091 made the heading say a list's shared state once; it now checks the
heading.
