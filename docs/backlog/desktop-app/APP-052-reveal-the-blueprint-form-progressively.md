---
id: APP-052
title: Reveal the blueprint-review form progressively instead of all at once
priority: P3
effort: M
component: desktop-app
status: in-review
related: [APP-022, APP-028]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-02
updated: 2026-09-02
---

## Problem

The blueprint-review card (`event.type === "blueprint"` handling,
`src/renderer.js:763-810`) renders every field at once as soon as the event
arrives: Name, Told as, Organized by, Topics, In depth, Lightly, and Voice,
several of them pre-filled with multi-sentence generated text. For a first
setup pass this reads as a wall of text the owner has to digest in one go,
in contrast to the single-question, one-at-a-time exchanges earlier in the
same conversation. The owner can still work through it — this is a
readability/digestibility issue, not a blocker.

## Proposed approach

Owner's suggestion: reveal the fields one section at a time as the owner
works through them, rather than the whole card at once — but keep earlier
sections visible on screen as reference once "digested," rather than hiding
them behind a strict single-field wizard. Needs a design pass to work out
the actual mechanic (e.g. reveal-on-scroll, reveal-on-confirm-previous,
or a lighter progressive-disclosure animation) and how it interacts with
editing a field after a later one is already revealed.

## Acceptance criteria

- [ ] The blueprint-review card no longer presents all seven fields at full
      readable weight simultaneously on first render.
- [ ] Once a section has been shown, it stays visible (not collapsed away)
      so the owner can still reference or edit it while later sections
      appear.
- [ ] Verified against a real setup pass with a populated blueprint (not an
      empty/short one) where the readability problem is most visible.

## Notes

Reported by the owner while dogfooding (2026-09-02); explicitly framed as
lower priority than the other setup-flow reports from the same session
(APP-049, APP-050, APP-051) since it doesn't block getting through setup.
