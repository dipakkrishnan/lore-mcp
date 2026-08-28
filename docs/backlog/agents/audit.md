# Audit

Integrity check plus `INDEX.md` regeneration. This is the only playbook
allowed to write `INDEX.md`. Read `AGENTS.md` for the shared rules first.

## Steps

1. **Enumerate every item file** under each component folder (everything
   matching `<component>/<PREFIX>-NNN-*.md`; skip `README.md` and
   `_template/`).
2. **Validate each item's frontmatter:**
   - All required fields present (`id`, `title`, `priority`, `effort`,
     `component`, `status`, `related`, `blockers`, `dependencies`,
     `github_issue`, `created`, `updated`).
   - `id` matches the file's own prefix/number and the `component` field
     matches the folder it's actually in.
   - `priority` in `{P0,P1,P2,P3}`, `effort` in `{XS,S,M,L,XL}`, `status` in
     `{ideation,in-review,ready,in-progress,completed,obsolete}`.
   - `id` is unique across the whole backlog (no dupes within or across
     folders).
3. **Check id sequencing per prefix.** Flag gaps (e.g. `AUT-001`, `AUT-003`,
   no `AUT-002`) as informational only — gaps from deleted items are fine,
   just note them. Flag actual duplicates as a hard error.
4. **Validate cross-references.** Every id listed in `related`, `blockers`,
   or `dependencies` (when it looks like a backlog id) must exist. Flag
   references to unknown ids. Multiple items sharing the same `github_issue`
   is expected (one issue can split into several items) — not a duplicate.
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
8. **Flag completion drift** — an item whose own body contradicts its
   `status`: every `## Acceptance criteria` checkbox is `[x]` while `status`
   isn't `completed`/`obsolete`, or the body contains self-reported
   completion language ("Completed", "Closed out", "shipped and merged", "all
   N acceptance criteria met/addressed/checked") that `status` disagrees
   with. Run
   [`detect_completion_drift.py`](./detect_completion_drift.py) rather than
   eyeballing ~100 files by hand. This is a real, recurring failure mode, not
   a hypothetical: `MCP-001`, `MON-004`, `MCP-002`, `CLI-001`, `MON-006`, and
   `DOC-002` all sat with a closing note nobody turned into a status change,
   in one case for three weeks. Report each hit; **do not flip `status` or
   check boxes yourself** — a hit means the item's own text disagrees with
   itself, not that the claim is true. Verifying it against the real
   deliverable (re-run the tests, re-read the shipped code or doc) and
   closing it out is `implementation`'s job, or an audit pass explicitly
   scoped to also do that verification — say so in the report either way.
   The script is a narrow, low-false-positive net, not a complete one: it
   will miss an item that's genuinely done but never says so in those words
   (that class needs the same direct verification, just triggered by
   something other than this check — e.g. a `prioritization` pass reading
   the item and getting suspicious).
9. **Regenerate `INDEX.md` from scratch** from the validated item files:
   table sorted by `status` in lifecycle order
   (`ideation, in-review, ready, in-progress, completed, obsolete`), then `priority`
   (`P0` first), matching the column order and header already in
   `INDEX.md`. Overwrite the whole table — don't try to diff/patch it.
10. **Report findings** (dupes, broken refs, cycles, stale items,
    completion-drift hits, promotions made) to whoever invoked the audit.
    Hard errors (dupes, cycles, broken refs) should be surfaced clearly, not
    buried in a wall of routine notes.
11. **If a PR is warranted for this pass**, render its body from
    [`pr-templates/index-regenerated.md`](./pr-templates/index-regenerated.md)
    via [`render_pr_body.py`](./render_pr_body.py) rather than composing it
    freehand.

## What audit does not do

- Does not change `priority` (that's `prioritization`).
- Does not implement anything or write code.
- Does not delete items, even ones that look abandoned — flag them for a
  human decision instead. Closing a decided-against item is a status change
  to `obsolete`, never a deletion.
- Does not flip `status` to `completed` on a completion-drift hit — the
  item's own text claiming it's done is the thing being flagged, not
  verified fact. Report it; verifying and closing is a separate step.
