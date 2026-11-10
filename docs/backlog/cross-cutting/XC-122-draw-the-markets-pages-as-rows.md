---
id: XC-122
title: Draw the Markets pages as rows, in the site's one look
priority: P2
effort: S
component: cross-cutting
status: completed
related: [XC-093, XC-114, XC-094]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-02
updated: 2026-11-10
---

## Problem

XC-093 moved the home page, the bids board and bid pages to one-line rows on hairlines
(docs/design-principles.md §4, §9). `/marketplace` still groups pieces into per-market columns
with a seller picker, a "Latest" strip and a stores list, so Markets and Bids look like two sites.

## Proposed approach

One list of rows (question · market · seller · price), the markets as text tabs as on `/bids`,
search kept. Each market's own page is the same list, narrowed. Drop the card grid styles from
`src/layout.js` once nothing draws them.

## Acceptance criteria

- [x] `/marketplace` and `/marketplace/:id` are rows with text-tab filters, no cards.
- [x] 390px wide with no horizontal scroll; dark and light both checked.

## Notes

The audit's step 4 (lists to rows). Kept out of XC-093 to keep that PR to the front door.

2026-11-10, done:

- **One list on both pages.** `/marketplace` and `/marketplace/:id` are drawn by the same rows
  (`site/src/worker.js` `list()`), with the `/bids` markup: `.line` rows (price · question · market,
  seller, updated) under `<nav class="tabs">` text tabs. The tabs are All plus one per market with a
  listing, each with its count, fullest first. A market's page is that list narrowed to it, with its tab lit.
  A piece listed in two markets is two rows on All, one per market.
- **Removed:** the per-group card columns, the seller `<select>` picker, the "Latest" strip, and on a
  market's page the sample/"Useful if"/"View & buy" blocks and the "More in …" list. Every row opens the
  piece on its store, where the sample is shown. `/marketplace/stats.json` no longer carries `latest`/`latest_key`.
  `Exchange.recent()` and `Exchange.tabs` went with them. The card-grid styles are gone from
  `src/layout.js`, and a test pins that.
- **Kept:** search, now also server-side inside a market (`/marketplace/:id?q=`). The `?seller=` narrowing
  stays for old links. The Stores list stays, because it is already hairline rows and is the only on-page
  way to a seller. `?tab=` (the registry's groups) no longer filters; the markets are the tabs.
  The market page's counts are fixed, not `data-stat`, because the page poll follows the whole exchange.
- **390px check.** Headless Chrome won't go below a 500px window. So each page (index and one market,
  plus `/bids` for comparison) was rendered from a fixture with long questions, a long unbroken
  seller name, test stores and 10 markets. Each was loaded inside a 390px iframe with `--hide-scrollbars`.
  innerWidth = clientWidth = scrollWidth = 390 for all, in `data-theme="dark"` and `"light"`.
  A 600px control element read 616, so the probe does catch overflow. Screenshots of both themes
  were looked at. The tab strip scrolls inside itself, as on `/bids`, and the lit tab is scrolled into view.
  Long seller names wrap anywhere at <=640px rather than widen the page.
- **Conflict to settle:** XC-094 (idea stage) wants a sample line on overview rows. This item follows
  design-principles §4 ("never a second line of description in a list"), so samples now live one level
  down, on the piece page. If XC-094 goes ahead, it should decide that against §4.
