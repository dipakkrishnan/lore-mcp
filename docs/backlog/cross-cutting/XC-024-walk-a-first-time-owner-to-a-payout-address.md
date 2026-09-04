---
id: XC-024
title: Walk a first-time owner to a payout address
priority: P1
effort: S
component: cross-cutting
status: in-review
related: [APP-056, APP-071, APP-036, XC-025]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-09-04
---

## Problem

The wallet step is the first place a stranger can fail silently, and the card
it gets is one line: "Open or create the self-custody wallet; skip
purchases, then use Receive → Base → Copy." The `open_url` tool takes one
title and one note, so the payments skill's step-by-step guidance is
compressed into that line. The second-stage heading is fixed at "Finish in
your browser" although the wallet is created in an app. The two traps the
skill knows (the exchange app is not the wallet; Base is a network inside the
wallet, and the address is the same on every EVM chain) never reach the card,
so even the owner could not tell which address Lore wanted (dogfood
2026-09-04).

## Proposed approach

Spans `app/desktop` (tool schema, card) and
`plugins/lore/skills/lore-enable-payments/SKILL.md` §3:

- Let the open tool take a short ordered list of steps and a second-stage
  heading; the card renders numbered steps.
- Split the journey into two cards: get a wallet (ends at Done), then the
  address (APP-071's text field with format validation).
- Put the two traps on the card in one line each: "The app with prices and
  Buy buttons is the exchange, not the wallet." and "Your wallet has one
  address that starts with 0x; it is the same on Base and Ethereum, so any
  Copy next to it is right. Never paste a recovery phrase."

## Acceptance criteria

- [ ] The wallet card shows numbered steps and a heading that matches where
      the owner finishes.
- [ ] The address is asked for on its own card and validated before Continue.
- [ ] Both traps are on the card, not only in prose.

## Notes

