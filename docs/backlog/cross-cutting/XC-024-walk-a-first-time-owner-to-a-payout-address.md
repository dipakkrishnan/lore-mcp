---
id: XC-024
title: Walk a first-time owner to a payout address
priority: P2
effort: XS
component: cross-cutting
status: completed
related: [APP-056, APP-071, APP-036, XC-025]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-11-13
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

No new schema. Render the open card's `note` through the existing markdown
renderer so the skill can send three numbered lines, and replace the fixed
"Finish in your browser" heading with neutral text: "Come back here when you
are done." The rest is prose in `lore-enable-payments` §3: two cards, get a
wallet then the address (asked as a typed value per APP-071), with the two
trap sentences on the wallet card.

## Acceptance criteria

- [x] The wallet card shows numbered steps and a heading that matches where
      the owner finishes.
- [x] The address is asked for on its own card and validated before Continue.
- [x] Both traps are on the card, not only in prose. The network trap is on
      it ("Set the network to Base. Not Ethereum or Solana." / "Pick the Base
      network."). ~~The exchange app is not the wallet.~~ Struck: MON-025 made a
      Coinbase account's deposit address a supported payout path, so that warning
      would now be wrong.

## Notes
Reviewed 2026-09-04: a steps array and a per-tool heading duplicated what markdown and one copy change already give.

**Review 2026-10-19:** not completed. Shortened in 408ba80, then superseded by MON-025's in-app payout card, which covers criteria 1 and 2. The wallet-app-versus-exchange-app warning is no longer on the card. Rewrite criteria against MON-025 or fold into it.

**Prioritization (2026-11-12):** Priority P2 (was P1), effort XS (was S).
Stays in-review. Before it can be ready: Fold the "the exchange app is not
the wallet" sentence into MON-025's payout card, or rewrite the criterion
against that card. Prioritization flag (not acted on): duplicate of MON-025.

**Close-out (2026-11-13):** Completed by MON-025's in-app payout card (5c0a96eb,
#339), with the card-only path from MON-047 (c25eb46e, #506).
`app/desktop/src/renderer.js` `PAYOUT_PATHS` / `payoutField()` renders the address
question as its own card. Each path's steps are an `<ol>`: By card, "My Coinbase
account" ("In the Coinbase app, tap Receive, then USDC." / "Set the network to
Base. Not Ethereum or Solana." / "Copy the address and paste it here.") and "A
wallet app". The card finishes in the app, with no "Finish in your browser"
heading. The address input is `required` with `pattern` from
`PUBLIC_ADDRESS = /^0x[0-9a-fA-F]{40}$/`, so it is checked before Continue. The
human-gated MON-025 criteria (a real 1¢ settlement, Zane's run) stay on MON-025.
