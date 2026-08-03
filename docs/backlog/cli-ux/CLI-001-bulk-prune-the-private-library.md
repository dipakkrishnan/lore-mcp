---
id: CLI-001
title: Bulk-prune the private library instead of one card at a time
priority: P1
effort: S
component: cli-ux
status: ready
related: [STO-001, XC-001, XC-002]
blockers: [STO-001]
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/6
created: 2026-07-26
updated: 2026-08-03
---

## Problem

`lore review` walks memories one at a time, requiring a keystroke per item. With a
library of any size, pruning it is tedious for no good reason: keep-or-discard are
cheap, repetitive *retention* calls, and there is no reason to spend one keystroke
each on them.

The original framing of this item — "clear the ~50-item `pending` queue", the
friction issue #6 opens with — **no longer applies.** STO-001 retires `pending`
entirely, so imports arrive `private` and there is no queue to clear. What remains
worth doing is bulk pruning of the private library, which is a smaller and
different feature than the one first specified here.

## Proposed approach

Add a bulk path to `review` that applies one retention status to a filtered set in
a single action — primarily `lore review <query> --status private --all discarded`
for pruning — plus an "apply to all remaining" choice inside the interactive loop.
Keep the per-card flow for everything else.

Disclosure is not reachable from this path, and after STO-001 that is structural
rather than a rule this item has to enforce: no memory status discloses anything,
so there is no externalizing action for a bulk path to accidentally offer.
`Store.set_status_many` is the right primitive and already exists on the branch.

## Acceptance criteria

- [ ] A non-interactive way to set one retention status across a filtered set in
      one command, with a printed count of how many were changed.
- [ ] The interactive loop offers an "apply to all remaining" option.
- [ ] The reported count reflects rows actually *changed*, not rows matched.
- [ ] Tests cover the bulk paths and the interactive apply-all, against the
      private library rather than a `pending` queue.

Dropped as void: "external is never assignable via any bulk action." STO-001
retires the `external` status, so this is trivially true and no longer testable.

## Notes

Cataloged from https://github.com/dipakkrishnan/lore-mcp/issues/6; realigned to
Dipak's "Private by Default, Publish by Intent" doc — bulk is now retention-only
and the `external` bulk path (and its confirmation gate / `--yes`) was removed.

Implemented on `feat/cli-bulk-review` (PR #18): `lore review --all
private|discarded`, uppercase P/D "apply to all remaining", and
`Store.set_status_many`.

**Parked 2026-07-30 (Shane), moved `in-progress` → `in-review`.** PR #18 is a draft
pending re-scoping after STO-001 (PR #19) merges. Moved back rather than left
`in-progress` because no one is working it, and back to `in-review` specifically
because the surviving feature — bulk pruning rather than queue-clearing — needs a
prioritization pass to confirm it is still worth doing at P1.

What a rebase has to deal with, recorded so it isn't rediscovered:

- A mechanical conflict in `tests/test_lore.py` against `main`.
- Two tests seed a `pending` queue that no longer exists; they need re-pointing at
  the private library.
- The `--all` choices and interactive keys must match the retired status model —
  the review card is `[k] keep private / [d] discard` after STO-001, so the
  uppercase P/D convention needs revisiting.
- `Store.set_status_many` returns `rowcount`, which counts rows *matched*, so it
  reports "Marked 3 memories private" even when all three already were. Hence the
  new acceptance criterion above.

**Prioritization pass 2026-08-03:** `STO-001` is `completed`, so the blocker this
was parked on is clear. Promoted `in-review` → `ready` at `P1` — the acceptance
criteria are concrete and the rebase notes above are a punch list, not an open
design question.
