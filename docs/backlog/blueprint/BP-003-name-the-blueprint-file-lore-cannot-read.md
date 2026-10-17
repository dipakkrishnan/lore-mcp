---
id: BP-003
title: Name the blueprint file Lore cannot read and say how to replace it
priority: P2
effort: S
component: blueprint
status: in-review
related: [BP-002, APP-181, APP-085, APP-119]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-13
updated: 2026-10-13
---

## Problem

When the saved `blueprint.json` is damaged (cut short, empty, not UTF-8),
`load_blueprint` in `lore/blueprint.py` lets the parser's own error out, and
the owner sees `lore: Expecting property name enclosed in double quotes: line
9 column 28 (char 208)` with no file named and nothing to do next.

That reaches further than `lore blueprint show`. Listing a store on the
marketplace takes its display name from the saved blueprint whenever no name
is passed, and the desktop app never passes one, so a damaged blueprint stops
every listing from the app with that same sentence. Meanwhile the app's setup
row still says the blueprint is set, because that only checks the file
exists.

`lore blueprint apply` has the smaller version of this for the file it is
handed: one that is not UTF-8, is a directory, or cannot be opened gets the
decoder's or the system's raw text, while a missing file and bad JSON get a
sentence of their own.

## Proposed approach

In `load_blueprint`, catch the read and parse failures and raise one error
that gives the file's path and says to capture the blueprint again with
`lore blueprint apply`. In `apply`, give the three unreadable-input cases the
same kind of sentence the missing file already has.

## Acceptance criteria

- [ ] With a saved `blueprint.json` that is cut short, empty, or not UTF-8,
      `load_blueprint` raises an error whose message contains the file's full
      path and `lore blueprint apply`, and none of `Expecting`, `codec`,
      `line 1`.
- [ ] A saved `blueprint.json` that is valid JSON but not an object is
      refused with a message that also contains the path and
      `lore blueprint apply`.
- [ ] `lore blueprint show`, with such a file and no `lore-map.md`, prints
      that message as its one `lore:` line on stderr and exits 1.
- [ ] `Marketplace.list()` called without a name, with such a file, fails
      with that same message; the listed-name setting is unchanged and the
      push function is not called. Tested through `Marketplace(push=…)`, as
      `tests/test_marketplace.py` already does.
- [ ] `Marketplace.list("Ada")` with such a file succeeds as it does today.
- [ ] `lore blueprint apply <file>` on a file that is not UTF-8, on a
      directory, and on a file the owner cannot read, each exit 1 with one
      stderr line that starts `lore: blueprint file`, contains the path, and
      contains none of `codec`, `[Errno`.
- [ ] After each of those three, a fresh home still has no `blueprint/`
      directory, and a home with a saved blueprint has both files unchanged.
- [ ] `lore blueprint apply` on a missing file still says
      `blueprint file not found: <path>`.

## Notes

Reported in PR #438 (tests for `lore/blueprint.py`), which left these
unpinned. Reproduced for this item on `main` at `edec94f` with a throwaway
`LORE_HOME`, each exit 1:

| What | stderr |
|---|---|
| `apply` on a file starting with byte `0xff` | `lore: 'utf-8' codec can't decode byte 0xff in position 0: invalid start byte` |
| `apply` on a directory | `lore: [Errno 21] Is a directory: '<path>'` |
| `apply` on a file with mode 000 | `lore: [Errno 13] Permission denied: '<path>'` |
| `show`, saved `blueprint.json` cut in half, no map | `lore: Expecting property name enclosed in double quotes: line 9 column 28 (char 208)` |
| `show`, saved `blueprint.json` empty, no map | `lore: Expecting value: line 1 column 1 (char 0)` |

While `lore-map.md` exists, `lore blueprint show` prints it and exits 0
whatever state `blueprint.json` is in, so a damaged blueprint can sit unseen
until something else reads it.

Read from the code, not run:

- `Marketplace.list` computes `name or _setup_name()`, and `_setup_name`
  calls `load_blueprint` (`lore/marketplace.py`). That happens before the
  empty and length checks and before anything is saved or pushed. I could not
  drive `lore marketplace list` that far from the command line, because it
  stops earlier at "open your store before listing it" on a home with no
  store.
- The desktop app runs `lore marketplace list --json` with no name
  (`listStore` in `app/desktop/src/state.cjs`).
- `lore/snapshot.py` reports `blueprint_configured` from
  `blueprint_path().is_file()`.

Not observed: a blueprint damaged in real use. `BP-002` removes the one way
Lore itself can cut the file; a hand edit or a sync tool can still do it.

`APP-181` (never show a seller a raw error message) is the desktop side of
the same complaint: it maps what the CLI says into sentences. This item fixes
the sentence at its source for one file, so `APP-181` has something readable
to pass on.

Not asked for:

- **Listing with a damaged blueprint by asking for a name instead.** Falling
  back to "a display name is needed; pass --name" would hide the cause and
  tell a desktop owner to do something the app gives them no way to do.
- **Making the app's setup row notice a damaged file.** Worth doing, but it
  is the app's change; the message above is what it would show.
- **`lore blueprint apply`'s message for JSON it cannot parse**, which names
  no path and ends in the parser's text. The path is the one the caller just
  typed, and the reader is usually the onboarding agent, which can use the
  position.
- **The text shown when the file parses but fails validation**, which is
  pydantic's own multi-line report ending in a documentation link. Same
  reader, same reasoning; a file holding `1` is one way to see it.
- `Marketplace.list("")` reads the blueprint like a call with no name. That
  is how an empty `--name` behaves today and this item leaves it.

Also seen and left alone: `"version": true` and `"version": 1.0` are accepted
as version 1 (`"1"` and `2` are refused). The saved file always says `1`, so
nothing downstream sees the difference.
