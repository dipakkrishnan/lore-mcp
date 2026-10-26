---
id: XC-064
title: Keep invisible and direction-changing characters out of blueprint text and the listed store name
priority: P2
effort: M
component: cross-cutting
status: in-review
related: [XC-042, CAP-001, XC-036, XC-040, MON-036, APP-119, BP-002]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-13
updated: 2026-10-13
---

## Problem

Blueprint text is cleaned so that an interview answer cannot steer a
terminal, but the cleaning only replaces the C0 and C1 control characters
(`CONTROL_CHARACTERS` in `lore/ui.py`). Characters that show nothing, or that
change the direction text is drawn in, pass through. A name of
`Ada​ ‮gnp.exe⁦` is saved as is, written into `lore-map.md`,
and printed by `lore blueprint show`.

The same name becomes the store's public display name. `lore marketplace
list` takes the blueprint's name when none is passed, cleans it with the same
table, and pushes it to the node, which hands it to every buying agent in
`discover` and prints it on the store's pages. A name passed with `--name`
has the same gap.

The person this protects is the owner. The name and outline are often
proposed by an agent or pasted from somewhere, and the card the owner
approves cannot show what is invisible. Two outline entries that differ only
by a zero-width space are also kept as two.

## Proposed approach

One list of characters to remove, next to `CONTROL_CHARACTERS`, applied in
the blueprint's two cleaning validators and in `Marketplace.list`. Then
refuse a name, and drop an entry, that has nothing visible left.

## Acceptance criteria

"The removed characters" are U+00AD, U+061C, U+180E, U+200B, U+200E, U+200F,
U+202A to U+202E, U+2060 to U+2064, U+2066 to U+206F, U+FEFF and U+FFF9 to
U+FFFB.

- [ ] A blueprint's name, storytelling and every list entry are saved, and
      written to `lore-map.md`, without any removed character.
- [ ] Two list entries that differ only in removed characters are one entry,
      and the first keeps its place.
- [ ] The length limits are measured after removal: a name of 200 visible
      characters plus removed ones is accepted.
- [ ] U+200C and U+200D are kept: a family emoji joined with U+200D and a
      Persian word containing U+200C come back unchanged.
- [ ] A name or storytelling made only of removed characters, U+200C, U+200D
      and whitespace is refused the way an empty one is; a list entry like
      that is dropped the way an empty one is.
- [ ] `Marketplace.list` saves and pushes the display name without any
      removed character, whether it came from the blueprint or was passed in.
- [ ] `Marketplace.list` refuses a name with nothing visible left with the
      existing "a display name is needed; pass --name", saving and pushing
      nothing.

## Notes

Reported in PR #438 (tests for `lore/blueprint.py`), which left it unpinned.
Reproduced for this item on `main` at `edec94f` with a throwaway
`LORE_HOME`: `lore blueprint apply` with the name above and the outline
`["x‮y", "﻿z"]` exited 0; `blueprint.json`, the first line of
`lore-map.md` and the output of `lore blueprint show` all carried the
characters unchanged. The expression `Marketplace.list` uses for the default
name (`_setup_name().translate(CONTROL_CHARACTERS).strip()`) returned the
name with all three still in it.

Read from the code, not run: the push and everything after it. The Worker
reads `listed_name` from its settings as stored
(`lore/node/src/answer-state.ts`), returns it as `name` in `discover`
(`lore/node/src/index.ts`), and `storefront.ts` HTML-escapes it into the page
title, heading, byline and JSON-LD. Nothing on that side removes anything.

Not observed: a real blueprint or listing containing any of these.

**What this does not protect.** A seller controls their own node's database,
so cleaning the name in the CLI is no barrier to a seller who wants a
deceptive name; that would have to be enforced where the name is read: the
Worker, the registry refresh (`XC-036`) or the buyer's side (`XC-042`). This
item is scoped to what an honest owner can end up publishing without seeing
it. Cleaning in the Worker as well is a reasonable follow-up and not asked
for here.

**The character list is a first proposal, for a maintainer to settle.** All
of the removed characters are in Unicode's format category, none is treated
as whitespace by `str.split()` or `str.strip()`, and none is needed to write
a word. Left out on purpose, each with a cost:

- U+200C and U+200D are kept because emoji sequences and Persian and Indic
  spelling need them. That leaves look-alike entries possible.
- The tag characters (U+E0001, U+E0020 to U+E007F) can carry hidden ASCII
  text, which is the kind of thing `XC-042` worries about, and they are also
  how the flags of England, Scotland and Wales are written. Not removed here;
  decide with `XC-042`.
- Variation selectors (U+FE00 to U+FE0F) are invisible too, and U+FE0F is
  what makes many emoji draw as emoji. Not removed.
- Fillers that are letters or symbols by category (U+115F, U+1160, U+3164,
  U+FFA0, U+2800, U+034F) are not removed, so a name made only of those still
  passes the "nothing visible" criteria. Removing the whole format category
  instead of a list would not catch these either, and would delete visible
  Arabic signs (U+0600 to U+0605, U+06DD).

Not asked for:

- **The other users of `CONTROL_CHARACTERS`**: memory and publication titles
  and bodies printed by `lore/ui.py`, captured memories (`lore/capture.py`,
  the way into what gets published) and feedback reports
  (`lore/feedback.py`). The same characters pass through all of them.
  Capture is the one that matters most and belongs with `XC-042`.
- **Blueprints already saved and names already listed.** They are cleaned
  the next time they are saved or listed.
- **Spacing inside a `--name`.** `Marketplace.list` trims the ends only, so a
  no-break space or line separator inside a passed name survives, where a
  blueprint name has every run of whitespace collapsed to one space.

The id skips XC-060 to XC-063 because open pull requests #432 and #434
already use them (and #355 uses XC-048 to XC-057); XC-064 is the first id
none of them can collide with.

Effort is `M` rather than `S` because the list has to be agreed before the
code, which is small, can be written.
