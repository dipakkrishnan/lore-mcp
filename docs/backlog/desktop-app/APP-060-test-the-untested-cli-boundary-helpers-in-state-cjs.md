---
id: APP-060
title: Test the CLI-boundary helpers in state.cjs that no test reaches
priority: P2
effort: XS
component: desktop-app
status: completed
related: [APP-066, APP-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-03
updated: 2026-10-21
---

## Problem

`app/desktop/src/state.cjs` exports 15 functions; `test/app.test.cjs` reaches
10 of them. Three of the misses carry real logic:

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

- [x] `searchMemories` has tests for the dash drop, the empty-query
      short-circuit, the 8-term cap, and the forced `--status private
      --limit 30`.
- [x] `readSales` and `candidates` each have a round-trip test and a defined,
      tested behavior for a malformed CLI payload.
- [x] The Memories search box is exercised by at least one renderer persona.

## Notes

Found by cross-referencing `state.cjs`'s `module.exports` against the
identifiers `test/app.test.cjs` mentions (2026-09-03). `stream` is exercised
only indirectly through `loreStream`, which is fine — it's the transport, and
the streaming contract already has its own test.

**Prioritization 2026-10-19:** promoted to `ready`. No open blockers, no commit on main implements it, and the acceptance criteria are concrete and checkable. Priority and effort unchanged.

**Completed 2026-10-21:** tests live in their own file, `app/desktop/test/state-cli.test.cjs`, against a shell stub that records argv and prints a fixture (no uv, no store), rather than in `test/app.test.cjs`, which many open PRs edit.

- `searchMemories`: a query of only blanks or dash terms (`-rf --all`, `--status=public -v`) runs no CLI; dash terms are dropped wherever they sit and don't count toward the eight; a ten-term query sends the first eight; the argv always ends `--status private --limit 30 --json`.
- `readSales` / `candidates`: a well-formed list (and `[]`) round-trips with the exact argv. **Malformed payloads now throw** (`Lore returned unreadable sales` / `unreadable drafts`), like `readState`, through a shared `records()` helper in `state.cjs` that accepts only an array of objects and logs the first 200 characters of what came back. Throwing rather than returning `[]` because every caller already handles a throw from `lore()`: the sales poller in `main.cjs` catches it and keeps polling, `loadSales` shows "Lore couldn't read your sales", and the renderer's drafts load catches to `[]`. One behavior change: the agent's `drafts` tool (`main.cjs` → `agent.mjs`) now fails the turn on a malformed drafts payload, as it already does on a CLI failure, instead of counting `NaN`. Non-JSON output still rejects with the `SyntaxError` from `JSON.parse`.
- The third criterion was already met on main when this was picked up. The `seller` persona's APP-107 ⌘K palette checks in `support/edge.cjs` type "management" and assert the title match ranks first, with the match marked. That goes through `window.lore.search` → `search:query` → `searchMemories` → the real CLI, and CI runs `support/edge.sh seller`. So no persona step was added.
- Not covered here: `readViews` and `extrasCandidates` parse CLI JSON unchecked in the same way.
