---
id: APP-296
title: Show a folder's preview before the app imports it
priority: P3
effort: S
component: desktop-app
status: in-review
related: [CAP-004, CAP-027, CLI-011, APP-120]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-15
updated: 2026-11-15
---

## Problem

Lore can already say what a folder would import without importing it:
`preview()` in `lore/sources.py` returns `count`, the `from`/`to` date range,
`skipped` (notes too short to keep) and `state`, and `lore sources preview
--folder PATH --json` exposes it. The desktop app never shows it.
`openConnect()` in `app/desktop/src/renderer.js` goes from "Choose a folder…"
straight to `window.lore.connectSource`, and the Obsidian vault shortcut in
the first-run list calls `connectSource` directly too. An owner pointing Lore
at a big vault learns how many notes came in, and how many were skipped,
only after they are in the library. This is what keeps CAP-004's criteria 1
and 3 open.

## Proposed approach

- Add a `sources:preview` IPC (preload, `ipc.cjs`, `state.cjs`) that runs
  `lore sources preview --folder <path> --json` and returns its payload.
- In `openConnect()`, when a folder is chosen (picked or found), show the
  preview in the sheet before the primary button imports: "312 notes,
  Mar 2019 – Nov 2026 · 14 too short to keep". The button stays the import.
- Say plainly when the folder has nothing to import, and do not offer to
  connect it.

## Acceptance criteria

- [ ] Choosing a folder in the connect sheet shows its note count and date
      range before anything is imported.
- [ ] The same preview shows how many notes are skipped as too short.
- [ ] Nothing enters the library until the owner presses the import button;
      a renderer unit test pins that `connectSource` is not called on choose.
- [ ] A folder with nothing to import says so and offers no import.
- [ ] `design-review` run; dark-mode screenshot of the sheet with a preview
      attached to the PR.

## Notes

Filed 2026-11-15 from the in-review close-out. Left over from CAP-004
criteria 1 and 3 (see its 2026-11-13 Close-out note). Once this lands, those
two criteria can be ticked or struck naming this id. CAP-027 is a separate
bug in `preview()` for feeds and hosted apps; folders are unaffected.
