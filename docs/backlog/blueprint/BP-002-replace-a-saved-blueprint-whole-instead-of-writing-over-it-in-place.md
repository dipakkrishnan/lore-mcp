---
id: BP-002
title: Replace a saved blueprint whole instead of writing over it in place
priority: P2
effort: S
component: blueprint
status: in-review
related: [BP-003, XC-064]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-13
updated: 2026-10-13
---

## Problem

`save_blueprint` in `lore/blueprint.py` writes `blueprint.json` and then
`lore-map.md`, each straight over the file already there. Three things follow:

- A save that fails partway through the first write leaves a cut
  `blueprint.json`, which nothing can read afterwards (`BP-003` is about how
  that is reported).
- A save that fails after the first write leaves the new blueprint beside the
  old map. `lore blueprint show` prints the map when there is one, so the
  owner is shown the blueprint they just replaced.
- Writing in place follows a symlink. If either path is a link to another
  file, a save sets that other file to owner-only and overwrites it.

## Proposed approach

Write each file somewhere new inside `blueprint/`, already owner-only, and
move it over the old one only when it is complete (`os.replace`). Have both
new files complete before either is moved, so a full disk fails the save
before anything the owner had is touched.

That still leaves a moment between the two moves. The simplest way to close
it is for `lore blueprint show` to stop trusting a stored map over the
blueprint: only `blueprint_show` in `lore/cli.py` reads `lore-map.md`, so it
could print the map of the blueprint it loads.

## Acceptance criteria

In `tests/test_blueprint.py` and `tests/test_cli.py`, on a temporary
`LORE_HOME`. "Fails" means the save raises; a killed process is in the notes.

- [ ] With a blueprint already saved, a save that fails before either new
      file is in place (the failure injected while the content of
      `blueprint.json` is being written, and again while the content of
      `lore-map.md` is) leaves both saved files byte-identical to before.
- [ ] On a fresh home the same two failures leave no `blueprint.json` and no
      `lore-map.md`.
- [ ] After any of those failed saves, `blueprint/` holds nothing but the two
      saved files, or nothing at all.
- [ ] With a blueprint already saved, a save that fails after the new
      `blueprint.json` is in place and before the new map is: `lore blueprint
      show` prints the name `blueprint.json` now holds, not the older one.
- [ ] Under a umask of 0, with `blueprint/` left at 0755 and both files at
      0644 beforehand, a save ends with the directory at 0700 and both files
      at 0600, and each file that becomes `blueprint.json` or `lore-map.md`
      is already 0600 before any content is written to it.
- [ ] With `blueprint.json` or `lore-map.md` a symlink to another file, a save
      leaves that other file's content and mode as they were, and the path
      then holds the new content at 0600.

## Notes

Reported in PR #438 (tests for `lore/blueprint.py`), which left these
unpinned. Reproduced for this item on `main` at `edec94f` with a throwaway
`LORE_HOME`:

- `Path.write_text` patched to raise "No space left on device" for
  `lore-map.md`: `blueprint.json` held the new name, while `lore-map.md` and
  `lore blueprint show` gave the old one.
- The same patch writing half of `blueprint.json` and then raising:
  `load_blueprint` raised a JSON error and the map was still the old one.
- `blueprint.json` and `lore-map.md` each made a symlink to a 0644 file
  elsewhere: `lore blueprint apply` exited 0, both of those files were 0600
  and held the blueprint and the map, and both links were still links.
- `blueprint/` itself made a symlink to a 0755 directory: that directory
  became 0700 and received both files.

Not observed: a real save failing. The files are a few kilobytes, so a full
disk or a crash landing inside the write is unlikely; what makes this worth
doing is that the result is a blueprint nothing can read, or a map that is
quietly out of date.

The symlink case is a robustness gap, not an exposure. `blueprint/` is 0700,
so placing a link there takes the owner's own account.

For a maintainer to decide:

- **Whether a link at `blueprint.json` or `lore-map.md` is replaced or
  written through.** The last criterion replaces it, which protects the file
  it points at. An owner who links the file into a dotfiles folder on purpose
  would find the link gone after the next save. Dropping that criterion keeps
  today's behaviour.
- **A symlinked `blueprint/` or `LORE_HOME`** is left alone here: pointing
  the home at another disk is a reasonable thing to do. The fifth criterion
  keeps the directory `chmod`, which follows such a link, as it does today.

Not asked for:

- Surviving a kill or a power cut. A killed save can leave its unfinished new
  file in `blueprint/`, and nothing here syncs to disk before the move.
  Whether a later save clears a leftover is up to the implementation.
- Anything about what is in the blueprint (`XC-064`).

Tests this changes: `test_both_artifacts_are_owner_private` in
`tests/test_blueprint.py` checks the end modes and should keep passing. PR
#438, if merged first, adds two tests that pin the files as private at the
moment `write_text` is called on them; a save that never calls `write_text`
on the final paths will need those two rewritten against the fifth criterion.

Moving a file onto a path that is a directory raises a raw
`IsADirectoryError`; that message is `BP-003`'s kind of problem.
