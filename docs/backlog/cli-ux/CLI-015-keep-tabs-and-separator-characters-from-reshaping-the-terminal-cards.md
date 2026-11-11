---
id: CLI-015
title: Keep tabs and separator characters from reshaping the terminal cards
priority: P3
effort: S
component: cli-ux
status: in-review
related: [CLI-013, XC-019]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-14
updated: 2026-10-14
---

## Problem

The memory and publication cards in `lore/ui.py` show text the owner is
asked to approve, so they should look like that text. Two things make them
differ:

- **Tabs are deleted.** `CONTROL_CHARACTERS` covers `0x00`-`0x1f`, which
  includes the tab, so `four<tab>tab` prints as `fourtab`. Indented code or
  tab-separated columns in a memory lose their spacing on both cards. The
  fields affected are the title, the metadata line, the teaser, "useful if",
  "not useful if", "free sample" and the body.
- **Bodies break on characters that are not newlines.** The body goes
  through `str.splitlines()` before the control characters are removed, and
  `splitlines` also splits on `\x0b`, `\x0c`, `\x1c`, `\x1d`, `\x1e`, `\x85`,
  `\u2028` and `\u2029`. `one\x85two\x1cthree` prints as three lines.
  `Store.flag_detail` splits snapshot and current text the same way before
  diffing, so the flagged-publication diff (CLI-013, CLI-014) breaks the
  same lines.

Both reproduced on a239aa9 by calling `memory_card` directly.

## Proposed approach

Change the card text in two ways:

- Expand tabs to spaces before removing control characters. In the body, do
  it before `textwrap.fill`. Single-line fields are never wrapped, so they
  need their own expansion.
- Split bodies only on `\n`, `\r\n` and `\r`, then remove the rest of the
  control range from each line.

Use the same split in `flag_detail`'s diff so the card and the diff agree,
and the same tab rule for diff lines (CLI-013 adds the cleaning there).

## Acceptance criteria

- [ ] A tab in each of the title, metadata, teaser, useful if, not useful
      if, free sample and body prints as one or more spaces on both cards,
      never as a raw tab and never as nothing.
- [ ] `\x0b`, `\x0c`, `\x1c`, `\x1d`, `\x1e`, `\x85`, `\u2028` and `\u2029` in a
      body do not start a new line on either card, and none of them is
      printed.
- [ ] `a\rb` in a title prints `ab`. In a body it prints as two lines, which
      is today's behaviour, kept so that a lone carriage return can never
      move the cursor back over a line.
- [ ] A memory changed only by one of the characters above shows the same
      line split in its flag diff as on its card.
- [ ] The existing control-character tests in `tests/test_ui.py` still pass.

## Notes

Found by PR #445 (tests for `lore/ui.py`), which reported both and kept its
fixtures away from them.

Open question, not a criterion here: zero-width and direction-changing
characters (U+200B, U+202E and the like) pass through both cards. U+202E can
visually reverse part of a title, so this is not just cosmetic. XC-064, filed
in open PR #439 for blueprint text and the listed store name, covers the same
class of character. Whichever of the two is implemented first should pick
one character policy that both use, rather than each component choosing its
own.
