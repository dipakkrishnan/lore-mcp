---
id: MON-048
title: Read a dropped folder that sits inside a hidden folder or is named with ../
priority: P3
effort: XS
component: monetization
status: in-review
related: [MON-044, MON-049, MON-050]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-23
updated: 2026-10-23
---

## Problem

When an owner drops a folder on a collection, `Collections._files`
(`lore/collection.py`) skips hidden files with
`any(part.startswith(".") for part in child.parts)`. `child.parts` is the
whole path, not the part below the dropped folder. So a folder anywhere
under a dot-folder (`~/.notes/essays`, a vault kept in `~/.config/...`)
yields no files at all, and `lore collection add` says "there was no text
to add" about a folder full of Markdown. The same happens on the CLI with a
relative path: `Path("../notes").parts` starts with `".."`, which starts
with `"."`.

Checked on main 1c127ed: with `h/.notes/essays/a.md` on disk,
`Collections._files([".../h/.notes/essays"])` returns `[]`. From inside
`h/plain`, `Collections._files(["../plain"])` returns `[]`.

## Proposed approach

Test only the path below the dropped folder:
`child.relative_to(path).parts`. Hidden files and folders inside the drop
stay skipped. A hidden file dropped directly is still accepted, because the
owner picked it.

## Acceptance criteria

- [ ] `_files([dropped])` returns the `.md` files of `dropped` when a folder
      above it is dot-named (e.g. `tmp/.notes/essays`).
- [ ] `_files(["../plain"])` run from inside `plain/` returns its files.
- [ ] `dropped/.hidden/x.md` and `dropped/.x.md` are still skipped.
- [ ] `tests/test_collection.py` covers all three cases.

## Notes

`tests/test_collection.py` has no tests of `_files` or `_read` yet, so
these would be the first. Open PR #427 moves `add`'s body into
`Collections.entries()` and reuses `_files`/`_read` for a new `sell()`. The
fix reaches both paths either way, but land it after #427 if that merges
first. The desktop app passes only absolute paths (`state.cjs`), and Finder
hides dot-folders by default, so the CLI is the likelier trigger. Hence P3.
