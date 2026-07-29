# Groom (scheduled: audit -> prioritization)

Run these two backlog playbooks in order, in this repo's root:

1. Read `docs/backlog/agents/audit.md` and follow it exactly: validate every
   item's frontmatter and cross-references, flag duplicate ids / broken
   references / blocker cycles, promote any `ideation` items that are
   actually complete enough to `in-review`, and regenerate `docs/backlog/INDEX.md`
   from the item files.
2. Read `docs/backlog/agents/prioritization.md` and follow it exactly:
   re-rank every `ready` and `in-review` item by impact vs. effort,
   respecting `blockers`, and promote unblocked, well-specified `in-review`
   items to `ready`.
3. Run the audit step (`docs/backlog/agents/audit.md`) a second time to
   regenerate `docs/backlog/INDEX.md` with the new priorities/statuses —
   prioritization must never hand-edit the index itself.

Why this order: prioritization needs an honest, validated backlog to rank
against — running it before audit risks ranking against stale or broken
data (dangling blockers, duplicate ids).

If step 1 finds hard errors (duplicate ids, blocker cycles, broken
references), stop after reporting them rather than proceeding to
prioritization against known-bad data.

Commit the resulting changes to `docs/backlog/` with a message summarizing
what changed (promotions, re-ranked items, audit findings). Do not push.
