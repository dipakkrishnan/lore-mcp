# Implementation

Take a single `ready` item to `completed`. Read `AGENTS.md` for the shared
rules first.

## Steps

1. **Pick the item.** Normally the highest-priority `ready` item with no
   open `blockers` (i.e. every id in `blockers` is `completed`). If asked to
   implement a specific id, use that one regardless of rank, but still check
   its blockers are actually done — if not, stop and say so rather than
   proceeding.
2. **Flip status to `in-progress`**, set `updated` to today.
3. **Restate `## Acceptance criteria` as a checklist** if it isn't already
   one — this is what you're implementing against, not your own
   interpretation of `## Problem`.
4. **Do the work in the repo** following this project's normal engineering
   practices (see the root `CLAUDE.md`/`README.md` for conventions — tests,
   lint, etc. as applicable to the touched code).
5. **Verify against every acceptance criterion explicitly.** Don't mark one
   done without checking it; if a criterion turns out to be wrong or
   unachievable, say so in `## Notes` rather than silently dropping it.
6. **If you discover the item was under-scoped** (real work is much bigger
   than described, or it turns out to depend on something not listed), stop,
   record what you found in `## Notes`, and either split off a new item via
   the `ideation` playbook or flag it back to `in-review` — don't silently
   expand scope mid-implementation.
7. **On success:** set `status: completed`, `updated` = today, check off all
   acceptance criteria, note anything a future reader should know (follow-ups
   spawned, tradeoffs made) in `## Notes`.
8. **Do not hand-edit `INDEX.md`.** Run (or hand off to) the `audit`
   playbook afterward so the index reflects the new status.
9. **If a PR is warranted for this item**, render its body from
   [`pr-templates/completed-item.md`](./pr-templates/completed-item.md) via
   [`render_pr_body.py`](./render_pr_body.py) rather than composing it
   freehand.

## What implementation does not do

- Does not re-prioritize other items.
- Does not pick a different item than the one selected in step 1 just
  because it looks easier — if the top item seems wrong, that's a
  `prioritization` finding, not a reason to skip it silently.
- Does not mark an item `completed` with unchecked acceptance criteria.
