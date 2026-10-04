---
id: APP-134
title: Paste writing to sell, and preview its page before approving
priority: P1
effort: M
component: desktop-app
status: in-review
related: [MON-035, MON-025]
blockers: []
dependencies: []
github_issue: 368
created: 2026-10-04
updated: 2026-10-04
---

## Problem

A first-time seller's path to a piece runs capture → library → publish draft
→ approval → deploy, and nothing along the way shows what a buyer will see.
There is no "here is something I wrote, sell it" entry, and the approval card
is a stack of fields, not a page.

## Proposed approach

- **Sell something you wrote** on Today: paste text, press **Draft it for
  sale**. Lore keeps it as a private memory and starts the publish thread from
  it, so the agent drafts the teaser, sample, fit lines and price-ready piece
  in one step.
- **Preview page** on every approval card renders the draft with the store's
  own `publicationPage()` (bundled into the app from `lore/node`, kept in sync
  by `npm run check`) in its own window, with scripts off and navigation
  blocked. Nothing is published.
- The store and payout steps already come after the first approval
  (MON-025). A deploy without a Cloudflare account is DOC-003's question.

## Acceptance criteria

- [x] Pasted text is saved privately and the publish thread starts from it,
      with no account setup.
- [x] Preview shows the page a buyer would see, with only free fields.
- [x] The approval card names what is free and what is paid.
- [x] The bundled renderer can't drift from the store's: CI fails when it does.
