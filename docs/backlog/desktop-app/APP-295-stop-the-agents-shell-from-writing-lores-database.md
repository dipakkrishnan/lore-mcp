---
id: APP-295
title: Stop the agent's shell from writing Lore's database
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-008, APP-048, APP-226]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-15
updated: 2026-11-15
---

## Problem

The agent's sandbox (`sandboxPolicy` in `app/desktop/src/agent.mjs`) gives it
write access to all of `$LORE_HOME` except the app-only folders `node/` and
`automation/` (`APP_ONLY`). `lore.db` sits in that writable area, so the
agent's shell can change any row directly, for example with `sqlite3` or a
Python one-liner. That bypasses the approval cards APP-008 kept as the gate
for owner-meaning writes: a prompt-injected or confused agent could mark a
draft approved, change the price, or edit selling settings without the owner
saying yes. `app/desktop/test/component/sandbox.test.cjs` records the gap as a
`todo` test, "the agent's shell cannot change Lore's database" (around line
461), with the reason "lore.db is writable inside the sandbox until an
owner-only store for approvals and selling settings is decided".

## Proposed approach

The fix is not a plain `denyWrite` on `lore.db`. The agent legitimately runs
`lore` commands that write it inside the same sandbox (the skills call
`lore publication draft`, `lore blueprint apply`, `lore price`, `lore profile`
and `lore setup --yes`). Unclear, needs a short design first; two shapes:

1. **Split the store.** Move what only the owner may set (publication
   approval state, prices, payout and selling settings in `settings` /
   `node_settings`) into an owner-only database or folder under `APP_ONLY`,
   written only by the app's own processes. The agent keeps `lore.db` for
   memories and drafts.
2. **Read-only database for the agent.** Deny writes to `lore.db`, `lore.db-wal`
   and `lore.db-shm` inside the sandbox and route every agent write through an
   app tool or card that runs the CLI outside it.

Whichever is picked, the agent must still be able to read the library
(`lore search`, `lore memory show`, `lore status`), since WAL mode needs the
`-shm` file for readers.

## Acceptance criteria

- [ ] The `todo` test "the agent's shell cannot change Lore's database" in
      `sandbox.test.cjs` loses its `todo` and passes: a shell write to the
      owner-only state fails with a non-zero exit.
- [ ] A test shows the agent's shell cannot change a publication's approval
      state or price, by `sqlite3` or by any `lore` command that bypasses a card.
- [ ] The agent can still read the library and draft from inside the sandbox;
      the existing component tests and the desktop walks stay green.
- [ ] A blocked write returns a reason the model can act on, without ending
      the turn (as APP-008's criterion 4 does for other refusals).

## Notes

Filed 2026-11-15 from the in-review close-out. Left over from APP-008, which
closed 2026-11-13 with this hole named in its Close-out note. Security gap,
so priority starts at P1.
