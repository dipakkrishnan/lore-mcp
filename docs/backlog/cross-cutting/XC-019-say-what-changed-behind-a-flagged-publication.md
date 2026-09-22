---
id: XC-019
title: Say what changed behind a flagged publication
priority: P1
effort: M
component: cross-cutting
status: in-progress
related: [MON-004, APP-006, APP-011, STO-001, XC-035]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-22
updated: 2026-09-22
---

## Problem

When a source memory is re-imported with a new fingerprint, `Store.put` flags
every active publication in its provenance with `source_changed_at` and the
app shows "The memory behind this changed after you approved it" with
Take down / Re-approve. The owner cannot answer the only question that
decides the action: *what* changed. The store overwrites the memory's
`content` in place and keeps nothing from approval time, so the flag is a
timestamp and nothing else. In the owner's own library, one rewrite of memory
30 ("Lore Launch Weekend State", an agent-maintained memory file re-synced on
2026-08-11) flagged publications 3 and 4 — two cards, eleven days old, for a
change nobody can see. The copy also says the memories "were edited", which
implies the owner did it; here an agent rewrote its own notes.

## Proposed approach

Two layers. First, show what is already knowable: the row should name the
source memory, its date, and who wrote it ("Lore Launch Weekend State was
rewritten by Claude on Aug 11"), derived from `provenance` plus the memory's
`updated_at` and `source`. Group cards that share a cause so one change is one
decision. Second, make the change itself visible: at approval time record the
source memories' fingerprints and content (a `publication_sources` table or a
snapshot column keyed by publication id), so a later flag can show a diff
between approved-time and current text. `lore publication list` and the
desktop Store view then both get a "what changed" surface; `reapprove`
refreshes the snapshot. Decide whether a change that does not touch the text
the publication was drafted from should flag at all — it may be enough to
flag only when the diff is non-empty.

## Acceptance criteria

Scoped 2026-09-22 to the Python core and CLI surface only; the desktop
Store/Today equivalents are split off to [[XC-035]] (see Notes).

- [ ] `lore publication list` names the changed memory, its author, and the
      change date for a flagged publication.
- [ ] At approval time, the source memories' fingerprint/content is recorded
      (snapshot table or column) so a later flag can compute a diff.
- [ ] Re-approving a publication and then changing its source memory shows a
      diff of the source text between approval and now, in the CLI.
- [ ] Publications flagged by the same memory change are presented together
      in `lore publication list`, and can be re-approved as one group via
      `lore publication reapprove <id> [id...]`. Take-down stays per-publication
      (revoke pushes to the edge immediately; batching that is a bigger,
      separate risk this item doesn't take on).
- [ ] Copy no longer implies the owner edited the memory when an agent did.
- [ ] Existing flags with no snapshot degrade to the first layer (name, author,
      date) rather than an empty diff.

## Notes

2026-08-22, later the same evening: the owner judged the alert noise — "if
there's no point to showing it to someone and it's confusing to me, it'll be
confusing to someone else" — and the desktop surfaces were removed on PR #121
(Today card, Store "Needs you" section, "Changed" chip, and the app-side
reapprove/revoke IPC that only they used). The flag and both CLI commands
remain. This item is therefore about *reintroducing* the surface, and the
bar for doing so is the second layer: do not show the owner a flag without
showing them the diff. If that never becomes worth building, the store-level
flag should be reconsidered too rather than left as CLI-only debt.

Spans `lore/store.py` (snapshot at approval), `lore/cli.py` / `lore/ui.py`
(publication card), `lore/snapshot.py` (desktop-state fields), and the desktop
Store and Today views — hence cross-cutting. Found while dogfooding the
packaged app on 2026-08-22. Live evidence: `publications` 3 and 4 have
`provenance [29, 30]`, `source_changed_at 2026-08-11T01:09:57Z`, matching
memory 30's `updated_at`.

**Prioritization pass 2026-08-26:** No blockers; the "flag on any change vs. only a non-empty diff" question in the approach doesn't block the AC, which are self-contained. Promoted `in-review` → `ready`.

**Implementation attempt 2026-09-22:** a scoping pass before writing code found
the "self-contained" call above didn't hold once the desktop side was
inspected: PR #121 removed both the flag UI *and* the data plumbing feeding
it (`publication_inventory()` doesn't select `source_changed_at`,
`snapshot.py`/`types.d.ts` carry nothing for it, no `reapprove` IPC exists),
and the new diff/grouping requirement has no precedent in `renderer.js`'s
hand-rolled DOM code to build on — a near-M lift on its own, not the "wire it
back up" job the original scope implied. Split the desktop Store/Today diff
+ grouping surface into [[XC-035]] (blocked on this item's snapshot layer)
and narrowed this item's AC to the Python core + CLI surface, which the
migration/query patterns in `store.py`/`cli.py` make genuinely mechanical.
Proceeding to implement this item as narrowed.
