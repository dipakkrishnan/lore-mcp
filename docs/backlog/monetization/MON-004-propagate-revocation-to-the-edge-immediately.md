---
id: MON-004
title: Propagate publication revocation to the edge immediately
priority: P1
effort: S
component: monetization
status: ready
related: [MON-003, XC-002]
blockers: [MON-003]
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/25
created: 2026-07-30
updated: 2026-08-03
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

- [ ] Revoking a publication removes it from edge retrieval as part of the
      revoke, not on the next scheduled publish
- [ ] A test asserts a revoked publication is unreachable from the paid tool
- [ ] A failed revocation push is surfaced to the owner and retried or recorded
      as outstanding — never silently dropped
- [ ] `lore status` shows outstanding revocations if any exist

## Notes

Split from `MON-003` rather than folded into it because the priorities differ:
serving content from the edge is a feature, and this is a correctness invariant
that the feature would otherwise violate. `MON-003` should not be considered
done in a state where this one is outstanding.

**Prioritization pass 2026-08-03:** `MON-003` is `completed`, clearing the
blocker. Promoted `in-review` → `ready` at `P1` — this is a correctness gap in
an already-shipped feature, not new work to weigh against other options.
