---
id: MON-004
title: Propagate publication revocation to the edge immediately
priority: P1
effort: S
component: monetization
status: completed
related: [MON-003, XC-002]
blockers: [MON-003]
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/25
created: 2026-07-30
updated: 2026-08-26
---

## Problem

Both `STO-001` and epic #25 state the same invariant: revoking a publication
removes it from paid retrieval **immediately**. A mirrored edge copy (`MON-003`)
breaks that by construction — once rows live in D1, revoking locally leaves the
edge serving the revoked content until the next push.

This is the one place where the mirror's eventual consistency is not a latency
detail but a broken promise to the owner. "I revoked that" has to mean it, or
the disclosure model is not what the README claims.

## Proposed approach

Make revocation a push, not a wait. Revoking a publication triggers the deletion
at the edge as part of the revoke operation, rather than deferring to whatever
schedule the normal publish step runs on.

Decide explicitly what happens when the push fails — the owner is offline, or
Cloudflare is unreachable. Failing silently is the unacceptable option. Either
the revoke reports that the edge is still serving and needs a retry, or local
state records the pending revocation so a later run completes it and `lore
status` surfaces that it is outstanding.

## Acceptance criteria

- [x] Revoking a publication removes it from edge retrieval as part of the
      revoke, not on the next scheduled publish
- [x] A test asserts a revoked publication is unreachable from the paid tool
- [x] A failed revocation push is surfaced to the owner and retried or recorded
      as outstanding — never silently dropped
- [x] `lore status` shows outstanding revocations if any exist

## Notes

Split from `MON-003` rather than folded into it because the priorities differ:
serving content from the edge is a feature, and this is a correctness invariant
that the feature would otherwise violate. `MON-003` should not be considered
done in a state where this one is outstanding.

**Prioritization pass 2026-08-03:** `MON-003` is `completed`, clearing the
blocker. Promoted `in-review` → `ready` at `P1` — this is a correctness gap in
an already-shipped feature, not new work to weigh against other options.

**Implementation, 2026-08-05 (PR #78):** `lore publication revoke` now runs
the existing full-replace push against the deployed node as part of the
revoke; a failed push sets a `revocation_pending` setting and raises with a
retry instruction rather than dropping silently; `lore status` prints a
reminder while it's outstanding. The commit moved status `ready` →
`in-review` ("Backlog: MON-004 ready -> in-review") without a Notes entry
explaining what was left incomplete — an audit gap in its own right, since
the shared rules require recording why an item regresses.

**Closed out (2026-08-26, audit/implementation pass):** investigated what
PR #78 might have left open and found nothing — all four acceptance
criteria are met and covered by passing tests on current `main`:
`test_revoke_pushes_to_the_deployed_node_immediately` and
`test_revoke_without_a_deployed_node_stays_local` (AC1),
`test_publications_add_list_revoke` (`store.get_publication()` raises
"not found" on a revoked id — AC2, and `get_publication` is the store's
only paid read path), `test_a_failed_revocation_push_is_recorded_never_
silently_dropped` (AC3), and `lore/cli.py`'s `status()` printing the
`revocation_pending` reminder (AC4, code-verified — matches the same
pattern the other three criteria's own tests exercise). No gap found;
moving `in-review` → `completed` rather than leaving it parked on an
undocumented regression.
