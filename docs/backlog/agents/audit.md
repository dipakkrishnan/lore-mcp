# Audit

Integrity check plus `INDEX.md` regeneration. This is the only playbook
allowed to write `INDEX.md`. Read `AGENTS.md` for the shared rules first.

## Steps

1. **Enumerate every item file** under each component folder (everything
   matching `<component>/<PREFIX>-NNN-*.md`; skip `README.md` and
   `_template/`).
2. **Validate each item's frontmatter:**
   - All required fields present (`id`, `title`, `priority`, `effort`,
     `component`, `status`, `related`, `blockers`, `dependencies`, `created`,
     `updated`).
   - `id` matches the file's own prefix/number and the `component` field
     matches the folder it's actually in.
   - `priority` in `{P0,P1,P2,P3}`, `effort` in `{XS,S,M,L,XL}`, `status` in
     `{ideation,in-review,ready,in-progress,completed}`.
   - `id` is unique across the whole backlog (no dupes within or across
     folders).
3. **Check id sequencing per prefix.** Flag gaps (e.g. `AUT-001`, `AUT-003`,
   no `AUT-002`) as informational only — gaps from deleted items are fine,
   just note them. Flag actual duplicates as a hard error.
4. **Validate cross-references.** Every id listed in `related`, `blockers`,
   or `dependencies` (when it looks like a backlog id) must exist. Flag
   references to unknown ids.
5. **Detect blocker cycles.** If A blocks B and B (transitively) blocks A,
   flag it — this is a real problem, not just an audit note, since it makes
   both items impossible to schedule.
6. **Flag stale `in-progress` items** — items whose `updated` is old relative
   to the rest of the backlog's activity (use judgment; there's no fixed
   threshold since this runs at varying cadence). Note them in the audit
   report; don't change their status yourself unless asked to.
7. **Flag `ideation` items that look complete enough for `in-review`** (have
   a concrete `## Problem` and at least one acceptance criterion) — promote
   them to `in-review` directly, since this is a mechanical check, not a
   judgment call about priority.
8. **Regenerate `INDEX.md` from scratch** from the validated item files:
   table sorted by `status` in lifecycle order
   (`ideation, in-review, ready, in-progress, completed`), then `priority`
   (`P0` first), matching the column order and header already in
   `INDEX.md`. Overwrite the whole table — don't try to diff/patch it.
9. **Report findings** (dupes, broken refs, cycles, stale items, promotions
   made) to whoever invoked the audit. Hard errors (dupes, cycles, broken
   refs) should be surfaced clearly, not buried in a wall of routine notes.

## What audit does not do

- Does not change `priority` (that's `prioritization`).
- Does not implement anything or write code.
- Does not delete items, even ones that look abandoned — flag them for a
  human decision instead.
