---
id: APP-096
title: Make the memory sheet a native modal
priority: P1
effort: XS
component: desktop-app
status: completed
related: [APP-075, APP-054]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-06
updated: 2026-09-06
---

## Problem

Opening a memory built a `div` with `role=dialog` and `aria-modal=true` but
nothing held keyboard focus inside it: Close → Tab moved focus to the page's
"Skip to content" link behind the open sheet, and closing did not return
focus to the row that opened it (audit 2026-09-06, live repro).

## Proposed approach

Use `<dialog>` and `showModal()`: focus containment, Escape, and focus
restore come from the platform. Keep the sheet's content, actions and style.

## Acceptance criteria

- [x] With a memory open, Tab cycles within the sheet.
- [x] Escape closes it unless a field is being edited, where Escape cancels the edit as before.
- [x] Closing returns focus to the element that opened it.

## Notes

Done 2026-09-06. The renderer's own Escape handler for the sheet is gone;
the rename and edit fields already `preventDefault()` Escape, which keeps
the dialog open while they cancel. A click outside the dialog's box closes
it, as the backdrop click did.
