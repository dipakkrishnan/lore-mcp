---
id: STO-003
title: Generalise sources into owner-connected readers
priority: P1
effort: M
component: store-import
status: completed
related: [CAP-003, CAP-004, CAP-005, CAP-006, CAP-007, APP-120, ONB-004]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-17
updated: 2026-09-17
---

## Problem

`lore/sources.py` knows three fixed sources, each a root path plus a glob,
and treats a source as connected when its root exists. That fits Claude Code
and Codex history and nothing else. A trial owner with no agent history
(Zane, 2026-09-14) has an Obsidian vault, a Substack, and a year of ChatGPT
conversations, and Lore cannot read any of them because there is no way to
add a source the owner chooses, no reader that is not a glob, and no state
beyond "root exists". `enabled` rendering as "Connected" is also the trap
Glean warns about: it says the source is switched on, not that the last read
worked.

## Proposed approach

Keep `Source` as the unit and make the reader a strategy. A source has a
`kind` (`folder`, `feed`, `export`, `script`), an owner-supplied `locator`
(a path, a URL, a handle), and a label. `files()` becomes `items()`, which
yields `(title, content, source_path, dated)` tuples; the folder kind is
today's glob, the others are filed as `CAP-004`, `CAP-005`, `CAP-006`, and
`CAP-007`. Owner-added sources live in the store's settings alongside the
existing `sources` list. `scan()` stays the only write path, so dedupe by
fingerprint, `source_key`, and the private-by-default lifecycle all carry
over unchanged.

State the snapshot needs, per source: connected (the locator resolves and a
cheap real read succeeded), kept count, last read time, and a named failure
(`needs_permission`, `needs_sign_in`, `unreachable`, `nothing_found`) so the
app can name every state that is not fine. Add `lore sources add|remove|
read` so the Desktop app and the CLI share one path.

## Acceptance criteria

- [x] An owner can add a folder source pointing at any directory and `lore
      sources read` imports its markdown as private memories with the same
      dedupe as agent history.
- [x] The snapshot reports connected, kept count, last read, and a named
      failure per source; a source whose root exists but whose read fails is
      not reported as connected.
- [x] Removing a source asks whether to keep or delete the memories it kept,
      and either choice leaves the store consistent.
- [x] Existing Claude Code and Codex sources behave exactly as before.

## Notes

Shipped 2026-09-17 as the Python half of the sources contract the Desktop app
(`APP-120`) builds against. What landed:

- `Source` gained `kind`, `locator` (the string a reader interprets; `root` is
  now a property over it), `owned`, and `since`. Reading is a `Reader`
  strategy per kind with `probe()` and `items()`; only `FolderReader` exists,
  so `READERS` has one entry and `CAP-004` through `CAP-007` add the rest.
- Owner folders live in the `owner_sources` setting, last-read outcomes in
  `source_reads`. `scan()` is still the only write path, so dedupe by
  fingerprint and `source_key` is untouched.
- State vocabulary: `connected`, `nothing_found`, `needs_permission`,
  `unreachable`, `off`. `enabled && root.exists()` is deliberately *not*
  connected. `pathlib.glob` swallows a denied directory, so `probe()` asks
  `iterdir()` once to tell "no permission" from "nothing there".
- `lore sources list|preview|add|read|remove`, each with `--json`, exit 2 for
  a bad argument. `remove --delete` keeps any memory a publication cites,
  through the new `Store.delete_source_memories`.
- Two judgement calls worth knowing. Owner folders drop items shorter than a
  sentence (40 characters) and skip `.obsidian/`, `.trash/`, and `templates/`;
  built-ins keep every non-empty file exactly as before, so agent history is
  byte-identical. And a bare `lore sync` now refreshes connected folders too —
  otherwise the scheduled run and the app's Sync would never see them.
- Not built here: feed, export, and script readers; the Electron side of the
  contract; any per-source project label beyond `personal`.

Filed 2026-09-17 from the connector research. The macOS permission and
signed-in-window readers (`CAP-007`, `APP-116`) run in Electron main and hand
items to this layer; the Python side never opens a browser or sends an Apple
Event. Context budget: readers parse and chunk in Python; the agent only ever
sees the candidate memories the correction flow proposes, never a raw export.
