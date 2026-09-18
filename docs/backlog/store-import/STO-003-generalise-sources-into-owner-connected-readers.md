---
id: STO-003
title: Generalise sources into owner-connected readers
priority: P1
effort: M
component: store-import
status: in-review
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

- [ ] An owner can add a folder source pointing at any directory and `lore
      sources read` imports its markdown as private memories with the same
      dedupe as agent history.
- [ ] The snapshot reports connected, kept count, last read, and a named
      failure per source; a source whose root exists but whose read fails is
      not reported as connected.
- [ ] Removing a source asks whether to keep or delete the memories it kept,
      and either choice leaves the store consistent.
- [ ] Existing Claude Code and Codex sources behave exactly as before.

## Notes

Filed 2026-09-17 from the connector research. The macOS permission and
signed-in-window readers (`CAP-007`, `APP-116`) run in Electron main and hand
items to this layer; the Python side never opens a browser or sends an Apple
Event. Context budget: readers parse and chunk in Python; the agent only ever
sees the candidate memories the correction flow proposes, never a raw export.
