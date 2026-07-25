# Delivery (scheduled, opt-in: prioritization -> implementation)

This job actually changes source code unattended. Only enable it once
you're comfortable reviewing its output regularly — start with `groom` and
`ideation-sweep` alone until the backlog's shape feels trustworthy.

Run these playbooks in order, in this repo's root:

1. Read `docs/backlog/agents/prioritization.md` and follow it exactly to
   re-rank `ready`/`in-review` items.
2. Read `docs/backlog/agents/audit.md` and follow it exactly to regenerate
   `docs/backlog/INDEX.md` with the new ranking.
3. Identify the single highest-priority `ready` item with no open blockers.
   If there is none (nothing `ready`, or the top items are all blocked),
   stop here and report that — do not implement a lower-ranked item instead.
4. Read `docs/backlog/agents/implementation.md` and follow it exactly against
   that one item only. Do not implement a second item in the same run, even
   if the first finishes quickly — leave that to the next scheduled run so
   each run's diff stays reviewable.
5. Run the audit step (`docs/backlog/agents/audit.md`) again to reflect the
   item's new `completed` (or `in-progress`, if it didn't finish) status.

Why this order: ranking must be current before picking "the top item," and
the index must reflect reality both before picking and after finishing.

Commit the resulting changes (backlog item + any source changes) with a
message naming the item id and summarizing what was implemented. Do not
push, and do not merge into a protected branch automatically — leave that
for human review.
