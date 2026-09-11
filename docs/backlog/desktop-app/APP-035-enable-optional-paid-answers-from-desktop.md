---
id: APP-035
title: Enable optional paid answers from Desktop
priority: P2
effort: M
component: desktop-app
status: completed
related: [APP-006, APP-008, APP-019, APP-030, APP-106, XC-017, MCP-003, MON-017, MON-024]
blockers: [MON-017]
dependencies: ["Publication-only desktop dogfood shows paid answers are worth surfacing"]
github_issue: null
created: 2026-08-25
updated: 2026-09-11
---

## Problem

Lore already supports an optional paid-answer tier, but every way to turn it on
runs through a terminal: `lore answer on <proxy-file> <price>` behind an
interactive confirm, and `wrangler secret put` for the model provider key. That
is the last owner-facing step in the product that Desktop cannot do, and it
lands on the owner right after a deploy flow that otherwise never leaves the app.

Everything the tier needs already exists: the paid `answer` tool, the ticket
contract, the Pi loop, the charter setting in D1, and `lore push` to carry it
there. What is missing is the card.

## Proposed approach

One seller-side Desktop action for the existing tier, shaped like
`propose_price`: the agent drafts, the owner sees the exact charter and price on
a card, and only what they confirm is saved. Turning it off is a plain Settings
button. Keep charter drafting in the payments skill and keep the answer runtime,
pricing storage, and `lore push` mechanics where they already live.

This item does not add a buyer chat, `answer`/`result` controls, answer-job
analytics, or per-publication pricing to Desktop.

## Acceptance criteria

- [x] Desktop shows the exact public proxy charter and per-answer price before
      the owner can enable the tier; declining changes nothing.
- [x] Enabling and disabling go through the same attended-surface gate
      `lore publication decide` uses, so answers are not a second, weaker path
      into the store than the decisions beside them.
- [x] Turning the tier off keeps the approved charter and price, so it is
      genuinely reversible rather than a rewrite from nothing.
- [x] The implementation reuses Lore's answer-settings validation and does not
      duplicate answer, pricing, or push mechanics in Electron.
- [x] Enabling and disabling remain optional; the publication-only deploy flow
      works unchanged without configuring an answer model or provider secret.
- [x] An approved change refreshes Desktop state; the UI does not claim the
      live node changed before a push succeeds, and says nothing about a node
      it could not reach.
- [x] Desktop adds no buyer-side `answer` or `result` experience.
- [x] Tests cover the approved Desktop path and a bare pipe without the marker,
      on both the CLI and the `.cjs` side.

## Notes

Split from APP-030 on 2026-08-25.

**Implemented 2026-09-11**, alongside `MON-017`. What shipped:

- `propose_answers` agent tool → a charter-and-price card → `lore answer apply`,
  gated by the attended-surface marker (`_desktop_decision`), the same one
  `lore publication decide` uses.
- Turning off is a Settings button → `lore answer off`, which writes one
  setting key and leaves the approved charter and price alone.
- `store_secret` gained `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` so the model
  provider key can be vaulted from a masked card like the Coinbase ones.
- Desktop reads a live-probed `answer_price_usd` back from `discover`
  separately from the saved setting, mirroring the publication-price handling,
  and stays quiet when the node is unreachable.

**An earlier revision of this item tried to make the gate unforgeable** — a
per-launch token in a file under Electron's `userData`, a sandbox deny rule for
that path, and a Python re-derivation of the same path on three platforms. That
was dropped during review, because it did not hold and could not:

- The Bash sandbox grants write access to the whole Lore home (capture,
  sessions, and the blueprint all need it) and `lore.db` lives there, so
  `sqlite3 "$LORE_HOME/lore.db" "update settings ..."` reaches every setting
  without touching the CLI at all. Reproduced inside the shipped policy.
- The token path itself read `LORE_DESKTOP_USER_DATA` from the environment, so
  the same shell could point it at a directory it owned and plant a matching
  token. Also reproduced.

No per-command check in front of the store can be stronger than the store
itself. The gate answers now use is the honest one, and it is the same gate the
publication price and the publication set already use — see `docs/desktop-app.md`
rule 3, corrected in this change, and `APP-106` for the design item that would
actually raise it for every owner decision at once.
