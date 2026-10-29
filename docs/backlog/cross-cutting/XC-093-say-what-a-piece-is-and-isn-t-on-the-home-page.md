---
id: XC-093
title: Say what a piece is, and isn't, on the home page
priority: P0
effort: S
component: cross-cutting
status: ideation
related: [MON-052, XC-094, XC-091, XC-070, APP-118]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

First users can't tell what Lore sells. a first user guessed personal facts, hidden preferences or prompt
packs. Another user needed telling that Lore isn't "Muse for desktop". The hero ("Private memory
you can sell to agents") and the invented sample cards in `site/public/index.html` leave all
three readings open, and no page shows a real piece.

## Proposed approach

Rewrite the home page in this order: hero (option A in the audit), "Useful even if you never
sell", one real piece drawn as a card (sample, useful-if, price, a sample buyer question), a
can-sell / can't-sell list, three steps, "Who buys and why a dollar", privacy facts, FAQ, and a
download block with next steps. Replace the made-up window cards with plainer examples. Remove
"stablecoin", "store" and "memory" from the first screen.

## Acceptance criteria

- [ ] The first screen says what Lore keeps, that it's private, and that selling is optional and approved.
- [ ] The page shows one real piece with its free sample and price.
- [ ] A can't-sell list names facts about you and raw chats as never sold.
- [ ] The FAQ answers "is this selling my data" and "is Lore an AI assistant".
- [ ] A non-technical reader and a developer each explain Lore back in one sentence after 30 seconds.
- [ ] No horizontal scroll at phone width; light and dark both work.

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
