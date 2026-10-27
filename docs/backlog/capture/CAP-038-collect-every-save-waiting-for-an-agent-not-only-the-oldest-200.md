---
id: CAP-038
title: Collect every save waiting for an agent, not only the oldest 200
priority: P2
effort: S
component: capture
status: in-review
related: [CAP-036, CAP-039, XC-067, APP-207]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-25
updated: 2026-10-25
---

## Problem

Reading an agent source collects one page: `Inbox.items()` selects that
agent's waiting saves `ORDER BY saved_at LIMIT 200` (`lore/inbox.py`), and
`AgentReader.waiting` (`lore/sources.py`) calls it once. A save this Mac can't
open counts as an error and is left waiting on purpose
(`test_a_save_that_will_not_open_is_an_error_left_waiting`). So once 200 saves
that won't open are the oldest rows, every read fetches the same 200, opens
none, and never reaches anything newer. The agent goes on saving and the owner
never sees it.

Nothing clears the jam. The node drops old payloads only inside a `write()`,
after 30 days (`LIMITS.retention` in `lore/node/src/inbox.ts`). A keyless save
is never replaced by a later save under the same key. The stuck rows count
against the store-wide cap of 2,000 waiting saves, which every agent shares.
The desktop makes it costlier: the waiting count includes them, so it never
reaches 0. The app's `Watch` (`app/desktop/src/agents.cjs`) then re-reads the
same 200 sealed payloads through wrangler every 10 s while on screen and every
60 s away.

The same cap strands openable saves outside the app. A CLI read of more than
200 brings in 200. `Agents.revoke(delete=False)` (`lore/agents.py`) reads once
and then revokes the agent. Anything past the first page is never collected,
although keeping is meant to bring in "what it saved but Lore hasn't brought
in, too".

## Proposed approach

Page the collect on a `(saved_at, id)` cursor until a page comes back short.
Every save in one `/agent` call shares a `saved_at`, so `id` must break the
tie. Make one wrangler call per page; `_read_all` is a single `--command`, and
2,000 full payloads won't fit one. The node's 2,000 cap bounds the loop at 10
pages. Confirm what was collected as today, per page or once at the end.
Update the Collect query in `contracts/inbox.md`, which spells out
`LIMIT 200`.

## Acceptance criteria

- [ ] With 200 saves this Mac can't open waiting, all older than one it can,
      one read brings in the openable save and reports 200 errors. In the test,
      seed the rows straight into the fixture's D1: the `/agent` stand-in takes
      20 per call and 100 per hour.
- [ ] With more than 200 openable saves waiting, one `lore sources read
      agent-<id>` brings in all of them, and `lore agents waiting` then reports
      0 for that agent.
- [ ] `lore agents revoke <source> --keep` with more than 200 saves waiting
      keeps every one of them as memories.
- [ ] A save that can't be opened is still left waiting; the existing test
      keeps passing.
- [ ] `contracts/inbox.md` describes the paged Collect.

## Notes

- Found by reading `lore/inbox.py`, `lore/sources.py`, `lore/agents.py` and
  `lore/node/src/inbox.ts` on main 4610a6f. Not reproduced against a real D1.
- Out of scope, worth a decision: whether the app should keep re-fetching saves
  it already failed to open on every `Watch` tick. Keeping them waiting is
  deliberate: a key restored later could still open them.
- Also out of scope: `Agents.revoke(delete=False)` goes on to revoke even when
  its read came back unreachable. Everything waiting is then stranded. That
  needs only the store to answer the revoke, not the read.
- Saves that won't open usually mean the store's key changed under this Mac.
  CAP-039 covers how that happens.
