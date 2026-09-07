---
id: APP-104
title: Add a Report Feedback button and dialog above the sign-in block
priority: P2
effort: M
component: desktop-app
status: completed
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
  `#account` inside `<aside>` — always rendered, not gated by
  `renderAccount()`'s credential check like the account block below it. (In
  practice the whole sidebar only exists once signed in — `appShell.hidden =
  !signedIn` — so this mainly keeps the button simple and independent of
  auth state, not a signed-out-reachability requirement as first assumed.)
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

- [x] The button is visible and reachable from every view, signed in or not
      (in practice: from every view once signed in — see note above).
- [x] The dialog collects title, email (optional), and description, and
      submits through `lore report-feedback`.
- [x] Success closes the dialog and surfaces the filed issue's URL; failure
      keeps the dialog open with the owner's text intact and shows the error.
- [x] `npm run check` (tsc over JSDoc) and `npm test` pass with new coverage
      in `app/desktop/test/app.test.cjs` for the `state.cjs` seam.

## Notes

Blocked on `XC-028` (the core and relay) and depends on `CLI-003` shipping
the `--json` output shape this dialog parses.

Done 2026-09-07. Verified visually with a real Electron screenshot
(`app/desktop/support/screenshot.cjs`): the button sits where the owner's
mockup placed it, and the open dialog matches the app's existing visual
language. `app/desktop/test/app.test.cjs` round-trips adversarial
title/email/description text (including a title of literally `--json`)
through the real CLI to a stubbed local relay.
