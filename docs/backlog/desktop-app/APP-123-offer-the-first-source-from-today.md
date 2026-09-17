---
id: APP-123
title: Offer the first source from Today, not only from Settings
priority: P2
effort: XS
component: desktop-app
status: completed
related: [APP-120, APP-109, APP-020, APP-118, ONB-007, APP-122]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-17
updated: 2026-09-17
---

## Problem

A first-run owner opens Lore with nothing kept, meets an empty library, and
never learns that Lore can read what they already wrote. `APP-120` built the
door — the catalog sheet behind "Where memories come from" — but it left it
in Settings, where an owner who has not gone looking will not find it. Today
is the inbox (`APP-020`), and the inbox says nothing about it.

## Proposed approach

One quiet card on Today, in the Needs You section, shown only while the owner
has no source they added themselves and fewer than a handful of memories:
"Lore can read what you already wrote", one line under it ("A folder of
notes, to start. Nothing is kept until you say so."), and two actions.

- **Connect a source** opens `APP-120`'s catalog sheet — the same sheet
  Settings opens, no second path.
- **Not now** hides the card, remembered per Mac the way the "How selling
  works" card is, so it does not come back on the next launch.

The card also never returns once any owner-added source exists, dismissed or
not. Opt-in only, per `ONB-007`: nothing is scanned, nothing is connected,
and no folder is read until the owner picks one. No new primitives — the
existing card, row, and button helpers, and no colour beyond the app's
tokens.

## Acceptance criteria

- [x] A fresh owner sees the card on Today, and "Connect a source" opens the
      catalog sheet.
- [x] "Not now" hides the card, and it stays hidden across launches.
- [x] Once a source is added the card is gone without anyone pressing
      "Not now".
- [x] An owner with a populated library never sees it.
- [x] The edge `fresh` scenario covers the first two, and `sources` covers
      the third.

## Notes

Filed 2026-09-17 from `APP-120`'s note that Today was deliberately left alone
for this item.

Shipped 2026-09-17 as one row in the Needs You card, not a card of its own:
that section already is a card, and a second one would have been a new
primitive for a single sentence. It sits outside the setup rungs, so a
first-run owner sees it beside "Connect your agents".

"A handful" is fewer than five private memories. The row also needs the owner
to have no source of their own, which is what makes it vanish after a connect
without anyone pressing "Not now".

"Not now" writes one key to `localStorage`, the same per-Mac convenience the
"How selling works" card uses; that helper did not exist on this branch yet
and was added here, so `APP-118` will land on the same `remembered()`. The
edge `fresh` scenario reloads the renderer to prove the choice survives a
launch rather than only asserting the key, and ends by keeping five memories
so the populated-library arm is covered there too, not just reasoned about.
