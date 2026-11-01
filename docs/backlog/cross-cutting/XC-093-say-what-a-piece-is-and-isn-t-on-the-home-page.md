---
id: XC-093
title: Say what a piece is, and isn't, on the home page
priority: P0
effort: S
component: cross-cutting
status: in-review
related: [MON-051, XC-114, MON-052, XC-094, XC-091, XC-070, APP-118]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-31
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

- [x] The first screen says what Lore keeps, that it's private, and that selling is optional and approved.
- [x] The page shows one real piece with its free sample and price.
- [x] A can't-sell list names facts about you and raw chats as never sold.
- [x] The FAQ answers "is this selling my data" and "is Lore an AI assistant".
- [ ] A non-technical reader and a developer each explain Lore back in one sentence after 30 seconds.
- [x] No horizontal scroll at phone width; light and dark both work.

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.

- Oct 31: the home page's real example can be live bids. Show the top three open bids from XC-114 above the what-is and what-isn't list (mock in the bids proposal, https://claude.ai/artifact/EHfg2NK8ZsggCKohHrXUUi).
- Oct 31 build: the Worker now serves `/` (`site/src/home.js`). It fills the page's example
  slot with the top three open bids from `GET /bids.json` (called in-process, so it works as
  soon as MON-051's route lands), else up to three real pieces from the Marketplace (mainnet
  stores only, with sample and price), else leaves the block out. Nothing invented is ever drawn.
  The real piece shows only in the fallback; once bids are live the bids are the example.
  Sections kept to Dipak's direction: hero, example block, can/never sell, three steps, a short
  FAQ, download block. "Who buys and why a dollar" is one FAQ answer, not a section.
- Left open: the 30-second explain-back check needs two real readers. Codex review also asked
  for an app view of what keeping looks like (not done: no invented app content) and found
  the live pieces skew technical (that's the real inventory).
