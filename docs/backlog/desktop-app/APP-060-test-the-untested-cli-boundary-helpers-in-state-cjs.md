---
id: APP-060
title: Test the CLI-boundary helpers in state.cjs that no test reaches
priority: P2
effort: XS
component: desktop-app
status: in-review
related: [APP-058, APP-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-03
updated: 2026-09-03
---

## Problem

`app/desktop/src/state.cjs` exports 14 functions; `test/app.test.cjs` reaches
9 of them. Three of the misses carry real logic:

- `searchMemories(loreHome, query)` trims the query, splits it on whitespace,
  **drops every term starting with `-`** so a query can't be read as CLI
  options, caps at 8 terms, returns `[]` without calling the CLI when nothing
  survives, and forces `--status private --limit 30`. Every one of those is a
  guard or a clamp, and none is asserted. Its siblings `readMemory`,
  `renameMemory` and `editMemory` each have a "validates before any CLI call"
  test; search has none, at any layer — no persona in `support/edge.cjs`
  types in the Memories search box either.
- `readSales(loreHome)` and `candidates(loreHome)` parse CLI JSON with no
  shape check. `readState` rejects an unsupported `version`; these two hand
  whatever parsed straight to the renderer.

## Proposed approach

Extend `test/app.test.cjs` in the style already there — a scratch `LORE_HOME`
plus `useRuntime()` pointed at a shell stub that echoes fixture JSON and
records its argv:

- `searchMemories`: a leading-dash term is dropped, a blank/whitespace query
  makes no CLI call at all, a nine-term query sends eight, and the argv
  carries `--status private --limit 30`.
- `readSales` / `candidates`: a well-formed payload round-trips, and decide
  what should happen on a malformed one (throw like `readState`, or return
  empty) rather than leaving it undefined.

## Acceptance criteria

- [ ] `searchMemories` has tests for the dash drop, the empty-query
      short-circuit, the 8-term cap, and the forced `--status private
      --limit 30`.
- [ ] `readSales` and `candidates` each have a round-trip test and a defined,
      tested behavior for a malformed CLI payload.
- [ ] The Memories search box is exercised by at least one renderer persona.

## Notes

Found by cross-referencing `state.cjs`'s `module.exports` against the
identifiers `test/app.test.cjs` mentions (2026-09-03). `stream` is exercised
only indirectly through `loreStream`, which is fine — it's the transport, and
the streaming contract already has its own test.
