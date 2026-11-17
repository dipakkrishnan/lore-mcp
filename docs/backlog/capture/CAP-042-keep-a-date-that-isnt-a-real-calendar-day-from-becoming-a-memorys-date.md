---
id: CAP-042
title: Keep a date that isn't a real calendar day from becoming a memory's date
priority: P2
effort: S
component: capture
status: in-review
related: [CAP-004, CAP-040, APP-208, XC-136]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-17
updated: 2026-11-17
---

## Problem

The readers check that a date has the shape `YYYY-MM-DD`, but not that it names a
real day. A note with `date: 2026-13-45`, `date: 2026-02-30` or a template's leftover
`date: 0000-00-00` gets stored with that string as its `created_at` and
`updated_at`. In the unfiltered memory list and the inventory, which order by
`updated_at DESC`, "2026-13-45" sorts above every real memory forever.

The desktop shows each one as a different, wrong real day with no error:
`2026-13-45` reads "Feb 14", `2026-02-30` reads "Mar 2" and `0000-00-00` reads
"Nov 30". `lore sources preview` reports `"from": "0000-00-00", "to": "2026-13-45"`.
The same happens when a personal agent saves `occurred_at: "2026-11-31"`.

Reproduced on main 3498496b with a temp `LORE_HOME`. A folder held three notes with
those frontmatter dates and one plain note. `lore sources add --folder` stored the
three dates verbatim, and the store listed "Month thirteen" above the plain note
dated today.

## Proposed approach

Accept a date only when `date.fromisoformat` accepts it. `_day` (`lore/sources.py`)
already does that check; it raises `SourceError`, so split out a non-raising form or
share a small helper with it rather than adding a third date parser.

- `_date` (`lore/sources.py`): it is start-anchored, so only the ISO branch needs the
  check. When the `YYYY-MM-DD` prefix isn't a real day, return `None`; the RFC 822
  branch already returns `None` for those values. Callers: Maps reviews, Mastodon and
  site feeds, Letterboxd, Goodreads (falls back to the feed's date), Granola, Notion,
  Readwise and the agent inbox.
- `FolderReader._dated`: an impossible `date:` falls through to `created:`, then to
  the file time.
- `AgentReader.items`: `_date(save.occurred_at or opened.saved_at)` never reaches
  `saved_at` when `occurred_at` is set but impossible. Use
  `_date(save.occurred_at) or _date(opened.saved_at)` instead. `saved_at` is the node's
  `toISOString()`, so it is always valid. It is the UTC day, the same as today's
  behaviour when `occurred_at` is null.
- With `dated=None`, `Store.put` dates a new memory when it was read, which is right.

## Acceptance criteria

- [ ] In a fresh store, a folder note whose frontmatter `date:` is `2026-13-45`,
      `2026-02-30` or `0000-00-00` becomes a new memory dated by a valid `created:` when
      it has one, or by its file time when it doesn't.
- [ ] `_date` returns `None` for `2026-13-45`, `2026-11-31T09:00:00Z` and
      `0000-00-00 00:00:00`. It still returns `2026-11-30` for `2026-11-30T09:00:00Z`
      and for `Mon, 30 Nov 2026 09:00:00 GMT`.
- [ ] In a fresh store, an agent save with `occurred_at: "2026-11-31"` becomes a new
      memory dated the UTC day of its `saved_at`, not left undated and not
      `2026-11-31`.
- [ ] `lore sources preview --folder <the folder above> --json` reports only real days
      in `from` and `to`.
- [ ] The existing feed, folder and agent tests still pass, and the per-file coverage
      gate holds for `lore/sources.py`.

## Notes

- Found by ideation 2026-11-17.
- `Store.put` (`lore/store.py`) uses `dated` only on insert. An already-stored
  memory with an impossible date keeps it, because a re-read with the same content is
  `unchanged` and an update writes `updated_at=now`. This item does not migrate
  stored rows. Whether to rewrite them is an open question.
- Maps reviews and Goodreads put the date into the memory's text ("Reviewed X on
  <date>"). After this fix, such an item whose date was impossible reads as changed
  content: one `updated` and its publications flagged as changed. That is expected
  and fine.
- **Out of scope:** dates in the future, such as `2099-01-01`, are real days. A note
  about a planned event can rightly carry one. Whether a future date should still
  order a memory above today's is a separate decision.
- **Desktop follow-up:** `when()` (`app/desktop/src/renderer.js`) builds
  `new Date(y, m - 1, d)`, which rolls over. Rows already stored with an impossible
  date will keep showing a wrong real day. An APP item could show those as blank (see
  APP-208).
- The node-side half, which tells the agent its date is wrong, is XC-136. This item
  is still needed for older nodes and for every other reader.
- `lore/sources.py` is also touched by open PRs #747 (CAP-041) and #626. Check for
  collisions when claiming.
