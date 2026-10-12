---
id: APP-136
title: Tidy Settings into console-style rows and make approval cards read first
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-135, APP-019, MON-039, MON-040, XC-039]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-05
updated: 2026-10-05
---

## Problem

Settings → Your store had grown one row per feature: two "Payouts ↗" buttons,
two price controls (Prices' "Change price" and Card payments' "Change price"),
"Live on Base" jargon, payouts shown only as a wallet, the answer price folded
into the piece price with no explanation, and no sign of free copies (MON-040).
Status dots looked different from row to row, the Lore home path was a long
unselectable mono string, and notices were plain boxes that stayed after the
state they described had changed: "Finish with Stripe in your browser" stayed
up after Stripe was already checking.

On Today, each MON-039 update card for a piece already on sale repeated the
same disclaimer and opened as three always-editable boxes, an empty one where
there was no sample, with no way to approve a batch.

## Proposed approach

Use the row layout of the Claude Console, Stripe Dashboard and Linear settings:
a title, one line of description, and the value, status and action on the right.

- Your store: **Address** (URL, Cloudflare as a quiet secondary link, a Live
  pill, one Open ↗), **Price** ("$1.00 per piece · first 3 copies free" and one
  Change, which opens the For Sale editor, now with a free-copies field;
  Stripe's $0.50 minimum appears only as a warning on this row, when cards are
  connected and the price is below it), **Get paid** (By card, covering every
  Stripe state, and By AI agents → wallet with View ↗), **Paid answers** only
  when that tier is on, then Marketplace.
- One `pill()` shape for every status, in ok, wait, attention and neutral tones.
- Notices become banners with an icon and a tone. The Stripe-form notice clears
  itself once Stripe is checking, ready or on.
- Where it lives: the path in a quieter mono style with `~` for home, plus Show
  in Finder (`shell.openPath`).
- Approval cards read like the buyer page (title, Good for, Not for, Sample
  only when present, and for new pieces the teaser and what buyers get) until
  Edit swaps in the fields. Clicking the title opens the preview, and Preview
  page also appears while editing. MON-039 updates sit under one header with
  "Approve all N" and a confirm step. That step still sends one attended
  `publication extras decide` per piece.
- Snapshot gains `pricing.free_copies`. The desktop saves it through the
  existing `lore free-copies N`. After a change on a live store, a notice
  offers Push now.

## Acceptance criteria

- [x] Settings has no "Base", "mainnet" or "USDC", one price control, and no duplicate payouts link
- [x] Price row shows free copies and warns about the card minimum only when it applies
- [x] Get paid shows the card state and the wallet, with Stripe's states in the card line
- [x] Paid answers has its own row only when enabled
- [x] Status pills, row anatomy and notice banners are consistent; the Stripe notice auto-clears
- [x] Update cards are read-only by default, batched under one header, with Approve all going through the per-item attended decide
- [x] New-piece cards use the same read-first pattern
- [x] Edge scenario `settings` and updated `cards`/`store`/`extras`/`sell` walks; node test for `setFreeCopies`

## Notes

There is no bank detail to show: `lore cards --json` returns only the Stripe
account id. The card line therefore says "Stripe pays you out to your bank" and
links to the Stripe dashboard instead of showing "Chase ••3816".

The For Sale bar still says "Live, answering on Base" and keeps its own
Payouts ↗. That was out of scope for this pass.
