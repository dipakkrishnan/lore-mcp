---
id: APP-211
title: Notices only on Today, a calmer store card, and a first save that counts
priority: P2
effort: S
component: desktop-app
status: completed
related: [APP-207, APP-210]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-17
updated: 2026-10-19
---

## Problem

Three small things make the app feel noisier than it is:

- The automations and usage notices sit at the top of every tab until
  dismissed, including Automations itself. The automations one also tells an
  owner with nothing connected that Lore reads their connected apps.
- The store card on Inventory is busy: the host and prices in monospace,
  bordered Cloudflare and Payouts chips, "no free copies", and a big "Not set"
  when there is no price.
- Connecting an agent says "Grok Bot saved its first memory" even when it
  saved two.

## Proposed approach

- Notices said once carry the page they belong to (Today) and show only
  there. The automations notice waits until something is connected.
- The store card is one row in the UI font: Live (· Test mode) over the host,
  with quiet Cloudflare ↗ and Payouts ↗ links; prices on the right as
  "$1 a piece · $0.10 an answer", free copies only when there are some, no
  trailing ".00", sub-cent prices kept whole. No "Not set".
- The first-save line counts: "Grok Bot saved 2 memories".

## Acceptance criteria

- [x] The usage and automations notices show on Today only, never on Inventory, Connectors or Automations.
- [x] With nothing connected, Lore doesn't say it reads connected apps; once something is connected, Today says it once.
- [x] The store card has no monospace, no bordered chips and no "Not set".
- [x] A notice is remembered as said only once it has been seen on Today, is shown at most once a session, and appears when a snapshot that makes it apply lands while Today is open.
- [x] A Today notice is remembered only while it is on screen (signed in, on Today, no thread over it), a failed write is retried, and only its × or its own action removes it.
- [x] A store card has one Update store: pending pieces are pushed first, a new price is redeployed after; sale amounts are in the UI font with tabular figures.
- [x] Sales never show CLI text, and no price link shows that can't be acted on.
- [x] The first-save line counts what arrived.
- [x] All edge scenarios pass.

## Notes

**Completed (verified 2026-10-19, by reading code and tests, no suites run):** on main in e58bd8c. Closed out in the review-queue pass.
