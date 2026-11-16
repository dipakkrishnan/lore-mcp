---
id: APP-297
title: Preview an on-sale piece on hover, as memory rows do
priority: P3
effort: S
component: desktop-app
status: in-review
related: [APP-110, APP-108, APP-187]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-15
updated: 2026-11-15
---

## Problem

APP-110 shipped a hover and focus preview for memory rows (`peekable()` in
`app/desktop/src/renderer.js`), but not for pieces on sale. Inventory's
publication rows (the On sale / Ready to sell shelf, built in the Inventory
`row()` method) call no `peekable()`, so an owner deciding whether a piece
should stay up has to open its store page per row. The renderer can't preview
them today: the snapshot carries a publication's title and topic only, and
`lore publication` has no command that reads one piece's content (its
subcommands are review, draft, extras, list, revoke and reapprove).

## Proposed approach

- Add `lore publication show <id> --json`, returning the piece's title, topic,
  updated date, price and the opening of its content (or its sample), read
  from the local store.
- Add a `publication:show` IPC, and give `peekable()` a reader so it can
  preview a piece as well as a memory (same 450 ms delay, same read-only
  card, cached per snapshot like `peeked`).
- Wire it to the publication rows in Inventory. Clicking the card opens the
  piece's page on the store when it is live, else its memory.

## Acceptance criteria

- [ ] `lore publication show <id> --json` exists, with a CLI test, and refuses
      an unknown id plainly.
- [ ] Hovering or focusing an on-sale or ready-to-sell row in Inventory shows
      the preview card after a short delay; leaving or esc hides it.
- [ ] The card shows title, date and clipped content, and offers no actions.
- [ ] A taken-down piece shows no preview.
- [ ] `design-review` run; dark-mode screenshot attached to the PR.

## Notes

Filed 2026-11-15 from the in-review close-out. Split from APP-110, which
struck its For Sale criterion as needing new CLI work. The Related-row half
of APP-110 went to APP-108 as a criterion.
