---
id: MON-024
title: Network switch re-asks for an already-known payout address
priority: P2
effort: S
component: monetization
status: in-review
related: [MON-022, MON-023]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/248
created: 2026-09-11
updated: 2026-09-11
---

## Problem

Switching an already-deployed node's network (Settings -> "Switch to play
money" / "Switch to real payments", which sends the agent
`PLAY_MONEY`/`REAL_MONEY` in `app/desktop/src/renderer.js`) makes the agent
ask the owner for their payout address again before running
`lore node deploy --network <test|real>`, even though that node already has
one configured. Found during a manual test of Scenario 2 (understand a sale)
in `docs/manual-test-walkthrough.md`.

Two independent pieces of evidence say the wallet shouldn't be needed here:

- `plugins/lore/skills/lore-enable-payments/SKILL.md` documents the
  network-switch commands (section 7, `lore node deploy --network real` /
  `--network test`) without a `--wallet` argument.
- `lore/deploy.py`'s `deploy()`/`_deploy()` only requires `--wallet` when no
  `LORE_WALLET` secret already exists on the node (checked via
  `wrangler secret list`); if the secret is already set, the CLI proceeds
  without it.

The agent asks anyway, most likely because the only invocation of
`lore node deploy` the skill spells out with surrounding narration is the
initial-setup one (section 3/4, always shown with `--wallet <payout-address>`),
and nothing in the skill tells the agent that a network-only switch on an
already-deployed node never needs to ask for it. Re-prompting also creates a
real risk: a slightly different or mistyped address entered out of habit on
what the owner expects to be a routine toggle would silently change their
payout wallet as a side effect.

## Proposed approach

Add an explicit instruction to `plugins/lore/skills/lore-enable-payments/SKILL.md`
near the network-switch commands (section 7) stating that a network-only
switch on a node that already has a deploy (`lore status` shows a URL) never
needs the payout address and the agent must not ask for it — `deploy` only
needs `--wallet` for the first deploy, or if `wrangler secret list` shows
`LORE_WALLET` is unexpectedly missing.

## Acceptance criteria

- [ ] Switching an already-deployed node's network (either direction) does not
      re-prompt for the payout address when `LORE_WALLET` is already set
- [ ] The skill text makes the first-deploy-vs-network-switch distinction
      explicit rather than relying on the agent inferring it from the
      `--network` flag's absence of a `--wallet` example

## Notes

Cataloged from GitHub issue #248.
