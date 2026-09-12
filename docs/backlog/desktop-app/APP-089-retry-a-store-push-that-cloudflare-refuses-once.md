---
id: APP-089
title: Retry a store push that Cloudflare refuses once, and say it plainly when it fails
priority: P1
effort: S
component: desktop-app
status: completed
related: [APP-072, MON-019]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

The first "Push now" from the desktop on the real Lore failed (dogfood
2026-09-05). Wrangler's log shows why: it refreshed the owner's Cloudflare
sign-in, then the D1 import endpoint answered 401 to the write, while the
same command with the same token succeeded minutes later and an earlier
refresh-then-import had also succeeded. The write is transactional, so the
edge was untouched and a retry is safe; nothing retried.

What the owner saw was worse than the failure: the CLI's terminal line,
"wrangler could not write the edge database — check `npx wrangler login`
and that `lore-publications` exists (npx wrangler d1 create
lore-publications)", pasted into the publish thread. The CLI already keeps
that cause out of owner history on purpose; the desktop lifted it back in.

## Proposed approach

In the CLI, run the edge write a second time after a short pause when the
first exits non-zero, then fail as before. In the desktop, say what the
push failure means to a seller instead of relaying the CLI's reason.

## Acceptance criteria

- [x] A push whose first edge write fails and whose second succeeds reports success, with the same command run twice.
- [x] Two failures still fail the push with the terminal cause and the `edge_write_failed` run summary.
- [x] A failed push in the desktop says that the store was not updated and buyers see what they saw before, with no command names.

## Notes

Done 2026-09-05. `act()` takes optional owner-facing failure copy; only the
push uses it so far. The other CLI reasons the desktop relays (revoke,
decide) are short and name nothing, so they stay.
