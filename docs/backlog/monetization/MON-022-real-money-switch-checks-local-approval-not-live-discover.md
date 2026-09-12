---
id: MON-022
title: Real-money switch verifies gate 1 against local approval, not the live discover manifest
priority: P1
effort: S
component: monetization
status: in-review
related: [MON-005]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/261
created: 2026-09-09
updated: 2026-09-09
---

## Problem

Switching a node to real money is gated on "at least one active publication
pushed to the node," specifically checked against the live node's `discover`
manifest — `plugins/lore/skills/lore-enable-payments/SKILL.md:280-282` states
this explicitly: "a real buyer must never pay real USDC against an empty
catalog." A manual test run against a real node (empty live catalog left
behind by `MON` sandbox-isolation gap, tracked separately) found the agent
asserted "Publications are live — good" and proceeded past this gate anyway,
twice in the same verification sequence. The catalog was, in fact, empty.

Root cause: the deploy agent has no dedicated liveness-check tool
(`app/desktop/src/agent.mjs:468`'s tool list is `bash` plus a handful of
attended actions — no `discover`/liveness tool), so it verifies "state" by
shelling out to the `lore` CLI. The two commands that describe publication
counts do so using language indistinguishable from liveness while actually
describing pure local approval state:

- `lore status` (`lore/cli.py:719,724`) prints
  `"{n} active publications (**externally usable**)"` from
  `store.list_publications(active_only=True)` — a local SQLite query
  (`lore/store.py:781-786`, `WHERE active=1`) with zero reference to the
  deployed node.
- `lore publication list` (`lore/cli.py:1045-1055` → `lore/ui.py:74-81`)
  labels rows "active" from the same local `publication.active` boolean.

The skill's general instruction (`SKILL.md:59-60`, "Verify from state, never
by asking") names `lore status` by name — the misleading command. The one
command that actually cross-references the live node
(`lore desktop-state`'s `live` field, backed by a real `discover` call via
`lore/snapshot.py:107-131`'s `remote_manifest()`) is never named anywhere in
the skill.

Ruled out as an alternate explanation: a stale `LIVE_CACHE_SECONDS` cache
(`lore/snapshot.py:134-170`) — `forget_live()` is correctly invoked after
every push (`lore/cli.py:1207-1209`); no evidence of a stale-positive.

## Proposed approach

- Change gate 1's instruction in `SKILL.md` to name `lore desktop-state` and
  its `live` field specifically, not `lore publication list` or
  `lore status`.
- Separately (smaller, same root confusion): reword `lore status`'s
  "(externally usable)" label so it doesn't claim liveness for a purely
  local count — e.g. "N active, awaiting push" vs. distinguishing pushed
  publications explicitly.
- Consider whether the skill's general "verify from state" instruction
  should stop naming `lore status` as a catch-all liveness check at all,
  since it structurally cannot answer that question.

## Acceptance criteria

- [ ] The mainnet gate-1 instruction in `SKILL.md` directs the agent to
      check the live `discover` manifest (`lore desktop-state`'s `live`
      field), not local approval state
- [ ] Attempting a real-money switch against a node with local publications
      approved but none live on `discover` is blocked, with a message naming
      the gate, per the skill's own "Any gate fails → say which, stop"
      instruction
- [ ] `lore status`'s publication count label no longer implies liveness for
      a purely local count

## Notes

Cataloged from GitHub issue #261. Root-caused during the same manual-test
session that filed it — see the issue's later comments for the full trace
(exact file:line citations for every claim above).

Reproduced via `docs/manual-test-walkthrough.md` Scenario 4 (S4-01); the
empty catalog that triggered this specific run was itself caused by a
sandbox-isolation gap (issue #257) — that's a separate, already-filed
problem, not a precondition for this bug. A store can legitimately have zero
live publications for other reasons (a fresh deploy, a bad push, manual
intervention) and this gate should catch all of them, not just the #257 case.
