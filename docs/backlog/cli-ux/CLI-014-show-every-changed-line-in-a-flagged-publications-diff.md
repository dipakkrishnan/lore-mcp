---
id: CLI-014
title: Show every changed line in a flagged publication's diff, including lines that start with -- or ++
priority: P2
effort: XS
component: cli-ux
status: completed
related: [XC-019, CLI-013]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-14
updated: 2026-11-11
---

## Problem

`flag_diff` in `lore/ui.py` hides the `--- approved` / `+++ current` file
headers that `Store.flag_detail` gets from `difflib.unified_diff` by skipping
every line that starts with `---` or `+++`. A changed line gets a `-` or `+`
in front of it, so it is skipped too when its own text starts with `--` or
`++`. That covers a markdown rule or front-matter fence (`---`), a command-line
flag (`--force`) and similar lines.

With approved text `title / --- / body / --flag` and current text
`title / body / ++x`, the owner saw only the `@@` line and the two unchanged
lines. Three changes were hidden, and the diff read as if nothing had
changed (reproduced on a239aa9). This diff is the only thing the owner has to
decide whether to re-approve or take the publication down.

## Proposed approach

Have `flag_detail` leave the two header lines out of the list it returns.
`unified_diff` emits exactly one header pair, at the start, before the first
`@@`. `lore/cli.py`'s `publication list` is the only caller, and the desktop
app does not read it. `flag_diff` then prints every line it gets. The
alternative is for `flag_diff` to skip the first two entries when they are
exactly the headers; either way, do not match by prefix.

## Acceptance criteria

- [x] With the fixture above, `lore publication list` (or `flag_diff` on what
      `flag_detail` returns) prints `----`, `---flag` and `+++x` as removed,
      removed and added lines.
- [x] Neither `--- approved` nor `+++ current` is printed.
- [x] A diff with several hunks still prints every hunk's `@@` line and no
      header.
- [x] A memory whose snapshot matches (no diff) and one with no snapshot
      print what they print today.

## Notes

Found by PR #445 (tests for `lore/ui.py`), which reported this and kept its
fixtures away from it. Same function as CLI-013. They could ship together but
don't depend on each other.

**Prioritization pass 2026-11-11:** Promoted `in-review` → `ready`: no blockers or dependencies, criteria are concrete fixture assertions. Can ship with CLI-013.

**Implemented 2026-11-11:** Took the preferred option. `Store.flag_detail`
drops the leading `---`/`+++` header pair (`diff[2:]`; `unified_diff` emits
exactly one, first, and only when there is a hunk, so an unchanged text still
gives `[]`). `flag_diff` no longer matches any prefix and prints every line,
coloured by its first character after CLI-013's clean step. Tests pin the
fixture in `tests/test_ui.py`, `tests/test_store.py` and `tests/test_cli.py`,
plus a two-hunk diff and the empty-diff case.
