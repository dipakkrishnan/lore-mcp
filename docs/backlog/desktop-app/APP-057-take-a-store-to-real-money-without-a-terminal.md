---
id: APP-057
title: Take a store to real money without a terminal
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-055, APP-056, MON-005, MON-018]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-02
updated: 2026-09-02
---

## Problem

"Switch to real payments" reopens the deploy conversation, but the cutover
itself needed three values entered through `wrangler secret put` in a real
terminal, and the skill rightly forbids pasting them into the conversation.
A non-technical seller dead-ended there.

## Proposed approach

The owner types exactly two things. A `store_secret` tool, limited to the
two Coinbase Developer Platform values, shows the existing secret-entry
card; the main process pipes the value into `lore node secret <NAME>`,
which vaults it through wrangler under the owner gate, and the agent only
ever hears "stored". `lore node deploy --network real` sets the network
after the deploy and `--network test` goes back; without the flag the
network stays as it is. Settings' Payments row flips to "Switch to play
money" once the node reports real money. The skill's cutover section gains
a desktop path built on the hand-off card from APP-056.

## Acceptance criteria

- [x] `lore node secret` vaults only `CDP_API_KEY_ID` and
      `CDP_API_KEY_SECRET`, reads the value from an attended stdin, and
      refuses an unattended pipe.
- [x] `lore node deploy --network real|test` sets `LORE_NETWORK` after the
      deploy; omitting it leaves the network alone.
- [x] The agent's tool never receives the value; it gets "stored" or
      "the owner did not provide it".
- [x] Settings offers the way back once the node reports real money.

## Notes

Shipped in PR #198. Reuses the sign-in secret card rather than adding a
fourth card shape; the message carries the vault note.
