---
id: APP-197
title: Meet sellers where they are: one Sell button, subscriptions, less on screen
priority: P1
effort: M
component: desktop-app
status: in-progress
related: [MON-044, MON-045]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-09
updated: 2026-10-09
---

## Problem

Sellers arrive from Gumroad and Substack, and the desktop app asks them to
learn Lore's nouns first: a "New" menu with Memory and Collection, an "Add
Memory" header button, a "feed" that means a subscription, "publication" where
they say "piece", a Today page that stacks five setup cards, and an FAQ tab
that sits in the sidebar beside the things they use every day.

## Proposed approach

1. **One primary button.** The sidebar's New menu becomes "Sell something". The
   header "+ Add Memory" button goes.
2. **The sell sheet.** It takes files (drop, or Choose files) and pasted text,
   lists what will be sold, and offers the one thing that fits: Put on sale
   for one piece; Sell together (a prefilled price at 80% of the pieces at the
   store price) or Sell one by one for two or more; or Keep private, which sends
   the same material to the capture composer. "From an app you use" opens
   Connectors.
3. **Drop anywhere.** Outside a collection, a file dropped on the app opens the
   sell sheet with it already added. Dropping on a collection still adds to it.
4. **Subscriptions, not feed, in visible copy.** "Paid subscription", "Turn on
   subscriptions", "Subscriptions on · $X a month". The snapshot fields and IPC
   names stay as they are.
5. **"Piece", never "publication", in visible copy.** Identifiers, IPC names and
   CLI arguments are unchanged.
6. **Today shows one next step.** The first setup card that applies, in the
   order Bring in, Shape, Set the rhythm, Open your store, Sell, Publish. "Connect
   your agents" leaves Today and stays in Connectors. The standing store cards
   (a new price not yet live, approved pieces not yet on the store) still show
   beside it, because a buyer is already seeing the old state.
7. **FAQ out of the sidebar.** A "Help" link sits in the sidebar footer beside
   Report Feedback, and a "Help & FAQ" row sits in Settings. The FAQ view stays.

The sale goes through a new `sell:pieces` IPC, which runs the CLI's `sell -`
command with the same validation as `collection:add`.

## Acceptance criteria

- [x] The sidebar has one "Sell something" button; "New" and "+ Add Memory" are gone.
- [x] "Sell something" opens the sheet; one piece offers Put on sale and Keep private; two or more offer Sell together at a prefilled price, Sell one by one, and Keep private.
- [x] Sell together makes a collection titled by its first text (or "Untitled collection" when files are in it), prices it, and opens it.
- [x] Keep private attaches files to the composer and puts pasted text in it.
- [x] A file dropped outside a collection opens the sell sheet with it added; a drop on a collection still adds to it.
- [x] Subscription copy replaces feed copy in the For Sale card and its messages.
- [x] "piece" replaces "publication" in every user-visible string in the renderer.
- [x] Today shows one setup card; "Connect your agents" is gone from Today.
- [x] FAQ is reached from the sidebar Help link and Settings, not from the nav.

## Notes

Checks in `support/edge.cjs` were updated for the new labels and for the
one-card Today rule. The collections walk now covers Sell something, the
two-text prefilled price, Sell one by one, and Sell together. The sell walk
covers a drop on the app and Keep private.
