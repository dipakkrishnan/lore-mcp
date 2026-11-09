---
id: XC-093
title: Say what a piece is, and isn't, on the home page
priority: P0
effort: S
component: cross-cutting
status: in-review
related: [MON-051, XC-114, MON-052, XC-094, XC-091, XC-070, APP-118, APP-280, XC-122]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-11-04
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

Nov 4: Dipak chose the live yourlore.dev page's layout plus a simple walkthrough, which replaces the criteria above
(PR #660, superseding #643). The page as built:

- [x] The live layout: the serif hero "Private memory you can sell to agents.", the lede, Download for Mac, and a "Gathers from" row of source logos.
- [x] A drawn app window that matches the app (Inbox, Inventory, Bids, Connectors; Inventory as one-line rows), captioned "Illustrative", with no invented sale.
- [x] "How it works" in four steps, each over a small drawn screen: connect, private memories, pick and price, get paid or answer a bid. All four follow one memory, priced at $8 and answering an $8 bid; every drawn price is $2–8.
- [x] The page ends on How it works: no beats and no bid list (Nov 4, Dipak). Live bids stay on /bids and in the page's structured data.
- [x] No worked piece and no maker's example anywhere; no never-does list; the nav says GitHub.
- [x] No protocol words on the page; no horizontal scroll at phone width; light and dark both work.

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.

- Oct 31: the home page's real example can be live bids. Show the top three open bids from XC-114 above the what-is and what-isn't list (mock in the bids proposal, https://claude.ai/artifact/EHfg2NK8ZsggCKohHrXUUi).
- Nov 1 rework (replaces PR #621): the Worker draws `/` from `src/home.js` around the live
  bids in the BidBook; `public/index.html` is gone. Order: hero (memory across your AIs, then
  bids) → one memory, every AI (illustrative) → open bids → how a bid gets answered, with
  Dipak's Bonaire piece end to end → who it's for → what Lore never does → download. One nav on
  every page (Bids · Markets · Open source · Download), one "For agents" link to `/llms.txt`.
  The board is rows with market tabs; bid pages get "Answer with Lore" (APP-280 for the deep
  link) and Share. FAQ dropped: its answers now live in the never-does list and the steps.
