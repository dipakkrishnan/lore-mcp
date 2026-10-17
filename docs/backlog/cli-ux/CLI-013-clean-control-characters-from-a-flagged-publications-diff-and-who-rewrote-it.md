---
id: CLI-013
title: Clean control characters from a flagged publication's diff and from who it says rewrote the memory
priority: P1
effort: XS
component: cli-ux
status: in-review
related: [XC-019, CLI-002, CLI-014, CLI-015]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-14
updated: 2026-10-14
---

## Problem

`lore publication list` shows what changed behind a flagged publication
(XC-019) through `flag_diff` in `lore/ui.py`. Two parts of that output reach
the owner's terminal without the cleaning the two cards apply
(`CONTROL_CHARACTERS`, which removes `0x00`-`0x1f` and `0x7f`-`0x9f`):

- **Who rewrote the memory.** `changed_memory_note` cleans the memory's title
  but prints the actor as given: the source's label, or its stored name when
  there is no label. The label is remote text. `Registry` saves
  `source.label or reader.label` (`lore/sources.py`, `add`), and the readers
  set that label from a feed's `<title>` or JSON Feed `title`, a Bluesky
  author, or a Mastodon display name. Whoever runs a feed the owner follows
  chooses it.
- **The diff itself.** Every diff line is printed as it is, and its text is a
  memory's content: imported web pages, feeds, notes, the same text
  `tests/test_ui.py` treats as untrusted for the cards.

A changed line `b\x1b[2Jevil\x9b` was printed byte for byte, and a source named
`s\x1b[2J` came back in the note unchanged (both reproduced on a239aa9 by
calling the functions directly). An escape sequence there can clear the
screen, move the cursor over earlier lines, or rewrite what the owner reads
just before deciding to re-approve or take a publication down.

## Proposed approach

Run the actor and every diff line through the same cleaner the cards use,
preferably one shared helper in `lore/ui.py` rather than a third copy of
`.translate(CONTROL_CHARACTERS)`. Keep each diff line's first character (`+`,
`-`, space or `@`) and its colour. How tabs are kept (expanded, not deleted)
is decided in CLI-015; whichever lands second should apply the same rule to
diff lines.

## Acceptance criteria

- [ ] A test in `tests/test_ui.py`: a source whose label contains `ESC`,
      `BEL` and `0x9b` is named in the note without them.
- [ ] The same with no label, where the note falls back to the source's
      stored name.
- [ ] Added, removed, unchanged and `@@` lines that contain `ESC`, `BEL` or
      `0x9b` are printed without them, and each still starts with its
      `+`/`-`/space/`@` and keeps its colour when colour is on.
- [ ] The "Lore's synthesis" wording for `origin: automation` is unchanged.

## Notes

Found by PR #445 (tests for `lore/ui.py`), which reported this and left it
unpinned. `updated_at` is out of scope: the store writes it and the note cuts
it to its first ten characters. CLI-002's subprocess smoke test runs
`lore publication list` and could carry an end-to-end case once this lands.
