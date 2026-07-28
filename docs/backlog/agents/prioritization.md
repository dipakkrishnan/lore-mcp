# Prioritization

Re-rank existing `ready` and `in-review` items. Read `AGENTS.md` for the
shared rules first. This playbook never invents new work — if you think
something's missing, that's an `ideation` finding to report, not something
to add here.

## Steps

1. **Gather every `ready` and `in-review` item** (via `INDEX.md`, or by
   re-running `audit` first if the index might be stale).
2. **Filter out items with unmet `blockers`.** An item with an incomplete
   blocker cannot be `ready` regardless of how valuable it is — it stays
   `in-review` (or gets moved there if it was miscategorized) until its
   blockers reach `completed`.
3. **Score the rest on impact vs. effort:**
   - Impact: how much it unblocks other work (check `related`/reverse
     `blockers` references), how visible/painful the problem is, whether it
     touches something on the critical path (`store-import`, `mcp-server`
     tend to be higher-leverage than `docs`, all else equal — but don't
     apply this mechanically, read the actual item).
   - Effort: the existing `effort` t-shirt size; correct it if it looks
     wrong given what you now know.
   - Prefer small-effort/high-impact items for `P0`/`P1`; large-effort items
     need a clearly stated payoff to justify `P0`.
4. **Assign `priority`** (`P0`-`P3`) to each item based on the score.
   Set `updated` to today on any item whose priority changed.
5. **Promote `in-review` -> `ready`** only for items that are both unblocked
   and have clear enough acceptance criteria to hand to `implementation`
   as-is. If acceptance criteria are missing or vague, leave it in
   `in-review` and note what's missing in `## Notes` — don't promote and
   hope implementation figures it out.
6. **Do not hand-edit `INDEX.md`.** Run (or hand off to) `audit` afterward so
   the index reflects the new ordering.
7. **Report the ranking rationale**, especially for anything non-obvious
   (why a small `docs` fix outranked a `blueprint` feature, say) — the "why"
   matters more than the list itself for anyone reviewing the pass later.

## What prioritization does not do

- Does not create new items (that's `ideation`).
- Does not implement anything.
- Does not promote an item to `ready` if it has unmet blockers, no matter
  how high-impact it is.
