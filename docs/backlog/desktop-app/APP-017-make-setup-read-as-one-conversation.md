---
id: APP-017
title: Make setup read as one conversation, and let the checkpoint actually save
priority: P1
effort: S
component: desktop-app
status: completed
related: [APP-011, APP-014, APP-015, APP-016, APP-004]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

The second onboarding dogfood (2026-08-23) surfaced three things. A memory
imported from a Claude memory file opens with its YAML frontmatter rendered
as prose — `name: … description: … ---` becomes a setext heading in serif,
above the real content. The setup flow reads as disconnected: the composer
sits above the thread, so replies land *below* the box the owner typed
into; the log keeps only eight lines, so earlier answers vanish; Lore's
lines show raw `**bold**`; and answers given through cards disappear with
the card, so the thread never shows what the owner chose. And the
onboarding checkpoint never saved — `~/.lore/automation/` stayed empty —
because the desktop bash policy demands exactly ten fields and ends the
turn on any mismatch with a reason the model cannot act on, while Phase 1
answers have no field to live in at all. Lore told the owner "the last save
checkpoint didn't complete" and carried on from memory.

## Proposed approach

Strip the frontmatter in the memory sheet and surface its `description` as a
lede. Put the composer under the thread; drop the line cap; render Lore's
lines with `marked`; echo card answers and approval decisions as "You"
lines; scroll new lines and cards into view; label the button "Send" while
a session is active. In the bash policy, validate the checkpoint field by
field, accept the blueprint's fields as optional draft state, and on a
mismatch block with the specific problem *without* terminating the turn so
the model fixes the shape and writes again. Tell the skill the same.

## Acceptance criteria

- [x] A memory whose content starts with `---` frontmatter renders without
      it, with `description` (if any) shown as a lede under the title.
- [x] On Today, the thread sits above the composer; every owner message,
      card answer, and approval decision appears as a "You" line; Lore's
      lines render markdown; no line cap.
- [x] The composer's button reads "Send" while a setup or publish session
      is active.
- [x] A well-formed checkpoint, with or without Phase 1 fields, is allowed
      without a prompt; a malformed one is blocked with a reason naming the
      field and does not end the turn.
- [x] `lore-onboard` documents the Phase 1 fields in the checkpoint.
- [x] Desktop typecheck and tests pass.

## Notes

Why the checkpoint failed is reconstructed, not logged: the in-memory pi
session leaves no transcript. The most likely shape was the model adding
`name`/`persona` to remember Phase 1 answers, or writing `"model": null`;
both now produce a reason it can act on. The blueprint itself is still
written only through `lore blueprint apply`.

Found while verifying: Electron prefixes every rejected IPC call with
`Error invoking remote method '…': Error:`, which leaked into the thread;
the renderer now strips it. Question cards were centered and shrunk to
content because `.request` inherits `.lead { align-items: center }`; the
fieldset now stretches. Verified with a driven screenshot (preview sign-in,
synthetic messages and cards) against the owner's real library.
