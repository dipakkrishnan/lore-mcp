---
id: MCP-005
title: Match each word of a paid-answer search, and % and _ literally
priority: P2
effort: S
component: mcp-server
status: in-review
related: [MCP-003, MCP-004, EVAL-002]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-16
updated: 2026-10-16
---

## Problem

The paid-answer agent's `memory_search` tool says it searches "for words".
In practice, `lore/node/src/answer-tools.ts` binds the whole query as one
`%query%` `LIKE` pattern, so it only finds pieces that contain the query as
one exact substring. A query with the right words in a different order, or
with other words between them, finds nothing. `%` and `_` are swapped for
spaces instead of being escaped, so `100%` searches for `100 `. When a search
misses, the agent can only refuse. A refused paid answer is owed back to the
buyer, and the refund is not automatic (`sales.ts`, and the `answer` tool text
in `index.ts`).

The piece used for testing contained "pricing tiers for a 100% café plan".
On 79f6881, a throwaway vitest file (deleted) called the tool directly with
these queries:

| Query | Found the piece? |
|---|---|
| `pricing tiers` | yes |
| `tiers pricing` | no |
| `pricing plan` | no |
| `100%` | no (the pattern becomes `%100 %`) |

## Proposed approach

Trim the query and split it on whitespace, dropping empty terms. Cap the
number of terms (for example 8) and the length of each term. Each term must
match at least one of title, teaser, content or topic (OR across fields), and
every term must match (AND across terms). Escape `\`, `%` and `_` in each term
and add `ESCAPE '\'`. Keep `LIMIT 8`. A query that has no terms left after
splitting answers `[]` without querying the database.

## Acceptance criteria

- [ ] `tiers pricing` and `pricing plan` both find a piece whose content is
      "pricing tiers for a 100% café plan". Both miss today.
- [ ] `100%` finds a piece containing `100%`, and does not find one containing
      only `100 x`.
- [ ] `a_b` finds a piece containing `a_b`, and does not find one containing
      only `axb`.
- [ ] A query containing a backslash, including a trailing one, finds a piece
      containing that literal text and does not throw.
- [ ] A piece missing one of the terms from every field is not returned (AND
      across terms), even when it matches the others.
- [ ] Terms beyond the term cap, and characters beyond the term-length cap,
      are ignored. Each cap has a test.
- [ ] A whitespace-only query answers `[]`.
- [ ] The existing Worker suite (`npm test` in `lore/node/`) passes, including
      the `memory_search` tests PR #468 adds if that PR has merged.

## Notes

- Cataloged from PR #468, which tested `answer-tools.ts` and listed these
  behaviours as noticed but not pinned.
- If MCP-004 lands first, every search fixture needs a non-empty teaser.
- **Open question, not a criterion:** case-insensitive matching only works
  for ASCII letters. With content "café", the queries `café` and `Café` find
  the piece, but `CAFÉ` and `cafÉ` do not. SQLite's `LIKE` and `lower()` fold
  ASCII only, and D1 has no ICU. A fix would need a case-folded column written
  at push time, or filtering in JS. Filing that as its own item is worth it
  only if non-English stores matter yet.
- Not filed: search matches on `content` it does not return. The agent then
  calls `memory_view`, and the result goes only to the agent, never to the
  buyer.
- Without an `ORDER BY`, which 8 rows come back from a large match is
  arbitrary. Ranking results is out of scope here.
