---
id: MON-006
title: Move deploy mechanics from the skill into the CLI when edge serving lands
priority: P1
effort: S
component: monetization
status: completed
related: [MON-002, MON-004, MON-005, XC-005]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-08-26
---

## Problem

The `lore-enable-payments` skill (PR #42) contains the deploy steps as prose an
agent follows: wrangler login, `LORE_WALLET`, deploy, smoke check. Every one of
those steps is deterministic — no decision anywhere — which makes them mechanics
living at the wrong layer. Prose mechanics are only testable by manual dry-runs
(XC-005), drift silently when the worker changes, and forced this PR to solve
problems (URL recovery from wrangler state) that code would not have. A skill
split was tried and reverted in PR #42: two skills added a hand-off seam without
removing any of the underlying problem.

## Proposed approach

When MON-003 lands and reworks deployment anyway (D1 push has to go somewhere),
move the mechanics into the CLI instead of extending the prose: a `lore node
deploy` command that wraps wrangler (login check, secret, deploy, smoke),
records the node URL in settings so `lore payment test-buy` and `lore status`
can default to it, and grows the publication push and re-push on publish/revoke.
The skill's deploy section then collapses to one command plus the Cloudflare
account framing, and stays what skills are for: judgment, consent, and stakes.
Mainnet cutover mechanics (MON-005) land in the same command when that gate
opens. Also at that point: remove the canary-content honesty note once the node
serves real publications, rename the worker from its canary name, and name
`lore-publish` in the skill's publishing route (deferred from PR #42 until
XC-002 / PR #38 merges).

## Acceptance criteria

- [x] `lore node deploy` (name negotiable) takes an owner from a Cloudflare
      account to a live, smoke-checked node serving their active publications,
      and records the node URL in settings.
- [x] Revocation reaches the deployed node.
- [x] The skill's deploy section contains no wrangler invocations, and neither
      skill nor CLI claims the node serves canary content.

## Notes

History: filed as "split deploy into its own skill", pulled forward into PR #42,
then reverted there in favor of one skill — the durable conclusion was that the
mechanics belong in code, not in a second skill. See the PR #42 discussion.

2026-07-30: `lore node deploy` landed early, with the canary as payload — the
CLI-ization turned out not to depend on MON-003, only the payload swap does.
The Worker source moved into the package (`lore/node/`, shipped as setuptools
package data) so deploy needs no git checkout, and the deploy artifact is
version-locked to the CLI that will later `lore push` into its D1 schema.
The command materializes to `~/.lore/node` (never touching `.buyer.env`),
drives npm/wrangler (login, deploy, `LORE_WALLET` secret), records `node_url`
in settings (shown by `lore status`), and runs the smoke check.

2026-08-01: MON-003 landed (#45), unblocking this: the node serves
publications from D1, and `lore node deploy` now creates the database,
resolves the config placeholder, and runs a first `lore push`, so the smoke
check passes before anything is published. Remaining here: revocation
reaching the node without a manual `lore push`, and renaming the worker from
its canary name.

**Prioritization pass 2026-08-03:** most of acceptance criterion 1 is already
built per the notes above; what's left (revocation reaching the node, the
canary rename) is small. Corrected `effort` to `S`, added `MON-004` to
`related` since it owns the revocation-push mechanism this item's second
criterion depends on, and promoted to `P1` / `ready`.

**Completed 2026-08-05.** Deploy mechanics moved into `lore node deploy` (#44);
revocation reach landed as MON-004 (#78); the worker rename — the last
remainder — shipped here: `lore-x402-canary` → `lore`, live at
lore.dipakrkrishnan.workers.dev/mcp, old worker deleted, rename verified by a
settled Sepolia paid retrieval of real publication content (tx 0xfd3ef8b0...).

**Re-closed (2026-08-26, prioritization/audit pass):** frontmatter had stayed
`ready` despite the "Completed 2026-08-05" note above already documenting
closure. Re-verified against current `main`: `lore node deploy` exists in
`lore/cli.py`; `skills/lore-enable-payments/` has zero `wrangler` references;
`lore/node/wrangler.jsonc`'s default environment is named `lore`, not the
canary name. All three acceptance criteria hold. Status was simply never
flipped — moving `ready` → `completed`.
