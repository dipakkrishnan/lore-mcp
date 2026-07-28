# Ideation sweep (scheduled: ideation scan -> audit)

Run these two backlog playbooks in order, in this repo's root:

1. Read `docs/backlog/agents/ideation.md` and follow it exactly, but instead
   of a single supplied idea, scan for un-tracked work across these sources:
   - `git log --since="8 days ago" --all --grep-source` messages or commit
     bodies that mention deferred work, follow-ups, or known gaps.
   - `TODO`/`FIXME`/`XXX` comments anywhere under `lore/`, `skills/`, `tests/`
     that aren't already referenced by an existing backlog item (check
     `docs/backlog/INDEX.md` first — don't create duplicates).
   - `## Notes` sections of existing backlog items that mention follow-up
     work not yet filed as its own item.
   File a well-formed item (per the ideation playbook's steps) for each
   distinct piece of un-tracked work you find. If you find nothing new,
   that's a valid outcome — don't invent items to have something to report.
2. Read `docs/backlog/agents/audit.md` and follow it exactly to validate the
   new items and regenerate `docs/backlog/INDEX.md`.

Why this order: newly-filed items need the same integrity check as anything
else before they're visible in the index.

Commit the resulting changes to `docs/backlog/` with a message listing the
new item ids. Do not push.
