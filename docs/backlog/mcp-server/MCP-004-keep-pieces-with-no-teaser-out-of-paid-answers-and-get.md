---
id: MCP-004
title: Keep pieces with no teaser out of paid answers and get
priority: P2
effort: S
component: mcp-server
status: in-review
related: [MCP-001, MCP-003, MON-015, MON-040]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-16
updated: 2026-10-16
---

## Problem

`lore/store.py` promises that a publication without a teaser "is never
advertised, and its unguessable public_id means absence from the catalog is
true absence". The manifest honours that on both sides
(`Store.manifest()` and `manifest()` in `lore/node/src/answer-state.ts` both
filter `teaser <> ''`), and so do the storefront and card paths, which look
pieces up through `pieces(catalog)`. But `lore push` sends every active piece,
teaser or not (`_push` → `list_publications(active_only=True)`), and four
Worker reads take the `publications` table with no teaser filter:

- `memory_search` in `lore/node/src/answer-tools.ts` returns them;
- `memory_view` returns their full content and marks them viewed;
- `submit_answer`'s `validCitations` accepts them as citations;
- the MCP `get` tool and its `freeFirst` free-copy path, through
  `publication(id)` in `lore/node/src/index.ts`, return their full content.

These chain together. A paid answer can be built from a piece the owner never
wrote an advertisement for. `result()` (`answer-state.ts`) then hands the
buyer `cited_publication_ids`, and with that id `get` sells, or gives away,
the whole piece. Reproduced on 79f6881 with a throwaway vitest file (deleted)
that called the tools directly. The fixture was an active row with teaser
`''`. It was absent from `manifest(env)`. `memory_search` returned it,
`memory_view` returned its content, and `submit_answer` citing it finished
`{status: "complete", cited: [<id>]}`. The `get` half was read from code, not
run.

## Proposed approach

Write one predicate for "this piece is for sale": active on the edge (every
pushed row is active) and `teaser <> ''`. Share it between `manifest()` and
the four reads above, so the answer agent, `get` and `discover` see exactly
the same set. A teaser-less piece then answers "publication not found"
everywhere on the Worker. An alternative, or an addition, is for `_push` to
send only teasered pieces. That keeps the content off the edge entirely, but
it changes the Python side and the push SQL tests. Pick one in implementation
and say why in Notes.

## Acceptance criteria

- [ ] `memory_search` never returns a row whose teaser is `''`. Test: a
      teaser-less row matching the query is absent from the results, and a
      teasered row matching the same query is present.
- [ ] `memory_view` of a teaser-less id answers
      `{"error":"publication not found"}` and does not add the id to `viewed`.
- [ ] `submit_answer` citing only a teaser-less id is refused with the "read
      and cite" message, and `finish` is not called. This holds even when the
      id is already in `viewed`, as it would be after a checkpoint resume
      (test by passing a pre-filled `viewed` Set to `createAnswerTools`).
- [ ] The MCP `get` tool, and its free-copy path, answer
      `publication not found: <id>` for a teaser-less id, and nothing is charged
      or recorded as a sale or a free copy.
- [ ] Code review: the predicate is written once and used by `manifest()`
      and all four reads. No call site re-spells `teaser <> ''`.
- [ ] Teaser-less test rows use a new checksummed id inserted inside the test,
      not in `test/setup.ts`, which pins the suite's two shared fixtures.
- [ ] The existing Worker suite (`npm test` in `lore/node/`) passes.

## Notes

- Filed from reading the code while PR #468 added tests to
  `answer-tools.ts`. That PR's tests insert only teasered rows, so this
  item should not conflict with them.
- **Intent check.** `docs/answer-tier.md` describes `memory_view` as reading
  "active publications only — the same rows `get` serves". MCP-003's
  criterion is that every cited id "resolves to an active publication". So
  the documents tie answers to what `get` serves and say nothing about
  teasers. No document says a teaser-less piece should be usable in an answer
  or sold. This item aligns `get` and the answer tools with the store.py
  promise and with what `discover` shows. If the owner's intent is the
  opposite, that teaser-less pieces are sellable but unlisted, then the store.py
  comment is what is wrong. Close this item and fix the comment instead.
- **How often it happens.** The CLI and desktop publish flow refuses an empty
  teaser (`_candidate` in `lore/cli.py`), and no update path clears one. The
  real source is legacy rows. The `teaser` column arrived with MCP-001 and was
  added by migration with `DEFAULT ''` and no backfill, so pieces approved
  before then have no teaser. `Store.add_publication` also accepts
  `teaser=""`. It is P2 rather than P3 because the answer → cited id → `get`
  chain sells the full content.
- Filed under `mcp-server` beside MCP-003, which designed these tools. It
  could equally sit under `monetization`, which owns the paid `answer` path.
- Checked and fine: the storefront (`/p/<id>`, the listing, `/paid`,
  `/free`), receipts and card checkout all resolve through `pieces(catalog)`.
