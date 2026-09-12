---
id: APP-095
title: Keep a memory card within what Lore can save, and keep the draft when a save fails
priority: P1
effort: XS
component: desktop-app
status: completed
related: [APP-046, APP-009, APP-090]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-06
updated: 2026-09-06
---

## Problem

The capture tool and the memory card accepted titles up to 300 characters
and projects up to 300, while `lore capture apply` allows 200 and 200 (and
1,000 for a source path, where the tool allowed 2,000). A 201-character
title passed `validEntries()` and failed `CaptureEntry` (audit 2026-09-06).
Keep cleared the card before the save ran, so a refused save lost the
owner's edits and left the agent holding an error.

## Proposed approach

Python stays authoritative: copy its limits into the tool schema, the
renderer's `maxLength`, and `validEntries()`. When the CLI refuses a save,
put the card back with the entries exactly as the owner edited them and say
why, instead of clearing it.

## Acceptance criteria

- [x] Every limit the card or tool enforces equals the CLI's (`lore/capture.py`).
- [x] A save the CLI refuses returns the card with the owner's edits and a one-line reason.

## Notes

Done 2026-09-06. `proposeMemories` in `main.cjs` loops: a refused save emits
the reason into the thread and re-requests the card with the decided
entries. `validEntries` now also bounds `project` and `source_path`.
