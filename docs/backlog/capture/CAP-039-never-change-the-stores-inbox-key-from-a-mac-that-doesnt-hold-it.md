---
id: CAP-039
title: Never change the store's inbox key from a Mac that doesn't hold it
priority: P1
effort: M
component: capture
status: in-review
related: [CAP-036, CAP-038, XC-067, APP-224]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-25
updated: 2026-10-25
---

## Problem

The store learns its inbox key (`inbox_public_key`, `inbox_salt` in
`node_settings`) from whichever Mac last wrote it. Nothing checks that this Mac
holds the key already there.

- **Push:** `_push_sql` (`lore/cli.py`) runs `DROP TABLE node_settings`, then
  inserts `Inbox().settings()`. That is `{}` when this Mac's Keychain has no
  inbox keys, so a push from such a Mac deletes the store's key. From then on
  every agent write fails with "Lore isn't ready for agents on this store yet".
  A Mac with a different key replaces the store's key on every push.
- **Connect:** `Inbox.mint()` (`lore/inbox.py`) makes a fresh key pair when the
  Keychain has none. It then writes `INSERT OR REPLACE` into `node_settings` on
  every connect, whatever key the store had.

Either way, every save sealed to the old key (up to 2,000 waiting) no longer
opens on any Mac (see CAP-038). Any Mac still holding the old key can't open
new saves either. It takes one routine push from a second or restored Mac,
which the desktop runs whenever the owner updates their store
(`app/desktop/src/state.cjs` `push()`). This breaks XC-067's
criterion that a push always carries the keys. `contracts/inbox.md` states the
same rule, and it assumes the pushing Mac holds them.

## Proposed approach

Treat the store's key as owned by the Mac that holds its private half:

- Push carries any existing `inbox_*` rows across the table rebuild when this
  Mac has no keys, instead of dropping them.
- Mint, and a push from a Mac whose key differs, read the store's key first.
  When a different key is there, they refuse with a plain message: saves are
  sealed to another Mac's key.

Moving the key to a new Mac on purpose belongs to APP-224, not here. Amend
`contracts/inbox.md` ("never omitted, because a push replaces that table") to
match.

## Acceptance criteria

- [ ] A push from a Mac with no inbox keys leaves the store's
      `inbox_public_key` and `inbox_salt` as they were.
      `test_a_push_before_any_agent_carries_no_keys` changes to pin this.
- [ ] With the store holding a key this Mac doesn't have (empty Keychain or a
      different key), `lore agents connect` and allowing a sign-in leave
      `node_settings` unchanged and fail with a message that names the cause.
- [ ] A push from a Mac with a different key doesn't replace the store's key.
- [ ] A store with no inbox key yet still gets one on the first connect. A Mac
      whose key matches the store's connects and pushes as today.
- [ ] `contracts/inbox.md` states the new rule.

## Notes

- Found by reading `lore/inbox.py`, `lore/cli.py` (`_push_sql`, `cmd_push`) and
  `contracts/inbox.md` on main 4610a6f. Not reproduced against a real D1.
- Nothing in the app deletes the Keychain entry (`Lore` / `inbox keys`).
  Reaching this takes a second Mac, a restored lore folder without its
  Keychain, or a Keychain reset. APP-224 is the deliberate version of that
  path and should carry the key over.
- P1 is a first guess: the failure is silent and stops every agent at once.
  `prioritization` decides.
