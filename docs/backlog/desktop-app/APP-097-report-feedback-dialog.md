---
id: APP-097
title: Add a Report Feedback button and dialog above the sign-in block
priority: P2
effort: M
component: desktop-app
status: in-progress
related: [XC-028, CLI-003]
blockers: [XC-028]
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-07
---

## Problem

The Desktop app has no way for an owner to report a problem. `XC-028` builds
the shared delivery core and relay; this item is the sidebar button and
dialog that drive it, sitting just above the existing "Signed in" account
block.

## Proposed approach

- A static "Report Feedback" button in `index.html`, immediately before
  `#account` inside `<aside>` — reachable even when signed out, since that is
  exactly when someone is most likely to need it (unlike the account block,
  which renders nothing without a credential).
- A small native `<dialog class="sheet narrow">` modal, following the one
  existing modal pattern (`openMemory()` in `renderer.js`) for focus
  trapping, Escape-to-close, and backdrop-click-to-close. Fields: title,
  email, description, built with the existing `draftField()` factory.
- The renderer cannot reach the network directly (CSP `connect-src 'none'`),
  so it goes through the standard three-hop chain: `renderer.js` ->
  `preload.cjs` -> `main.cjs` -> `state.cjs` -> `lore report-feedback --json`
  over stdin (so a description starting with `-` is never read as a flag).
- No confirmation step before sending, per the product decision — but the
  dialog states plainly, next to the description field, that the report
  becomes a public GitHub issue.

## Acceptance criteria

- [ ] The button is visible and reachable from every view, signed in or not.
- [ ] The dialog collects title, email (optional), and description, and
      submits through `lore report-feedback`.
- [ ] Success closes the dialog and surfaces the filed issue's URL; failure
      keeps the dialog open with the owner's text intact and shows the error.
- [ ] `npm run check` (tsc over JSDoc) and `npm test` pass with new coverage
      in `app/desktop/test/app.test.cjs` for the `state.cjs` seam.

## Notes

Blocked on `XC-028` (the core and relay) and depends on `CLI-003` shipping
the `--json` output shape this dialog parses.
