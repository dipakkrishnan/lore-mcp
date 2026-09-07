---
id: APP-090
title: Let a long memory draft scroll instead of clipping at the field's cap
priority: P2
effort: XS
component: desktop-app
status: completed
related: [APP-055]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

The "What to remember" field on a memory card grows with its text up to
200px and then stops, and its stylesheet hid overflow. A long draft showed
its first dozen lines and nothing else: no scrollbar, no way to read the
rest without editing it. The blueprint card's fields had the same rule
(dogfood 2026-09-05: "there should be scroll when you give me a memory
card").

## Proposed approach

Drop the overflow rule. The field still sizes to its text below the cap
and shows a scrollbar only past it, the way the composer already does.

## Acceptance criteria

- [x] A memory draft longer than the cap scrolls inside its field.
- [x] A short draft shows no scrollbar.

## Notes

Done 2026-09-05. Checked on the sandbox window with a forty-line draft:
824px of text in a 200px field, scrollable with the rule gone.
