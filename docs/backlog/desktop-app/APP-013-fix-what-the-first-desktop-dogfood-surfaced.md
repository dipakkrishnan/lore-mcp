---
id: APP-013
title: Fix what the first desktop dogfood surfaced
priority: P1
effort: M
component: desktop-app
status: completed
related: [APP-005, APP-006, APP-009, APP-011, APP-012, XC-019]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-22
updated: 2026-08-22
---

## Problem

The first run of the packaged app on the owner's Mac (2026-08-22) surfaced
five defects in the shipped surface, distinct from the feature gaps filed as
APP-011, APP-012, and XC-019: "Continue with ChatGPT" hung on "Waiting for
your browser…"; the Dock showed Electron's atom because no icon was
configured, and the first icon shipped on an opaque white plate; every click
on the mic appended the same hint line; the only way to take a publication
down was an alert about a change the app could not explain; and the
`manual_code` paste prompt from either OAuth flow lingered as a stale card.

## Proposed approach

Fix each at its cause rather than papering over in the renderer: answer
pi-ai's `select` prompt in-app; honor pi-ai's per-prompt `AbortSignal` and
dismiss the card; render the icon with Electron so its margin is transparent
and refuse an opaque one at build time; show the dictation hint once per
burst; drop the unexplained alert and give every For-sale row a Take down
control with one inline confirm and a push offer while the node is live.

## Acceptance criteria

- [x] ChatGPT sign-in opens the browser immediately; pi-ai's `select` prompt
      never reaches the renderer.
- [x] After either OAuth flow completes, no paste-the-code card remains.
- [x] The packaged app carries the Lore mark with a transparent margin, and
      `packaging/icon.cjs` fails the build if the margin is opaque.
- [x] Repeated mic clicks add one hint line, not one per click.
- [x] Every approved publication can be taken down from Store with a confirm
      step; the "changed underneath" alert, chip, and `reapprove` IPC are gone.
- [x] Desktop typecheck and tests pass; a full `npm run package` was verified.

## Notes

Completed on PR #121. Filed after the fact so the pull-request title rule
has an item to point at; the fixes were made during the dogfood session
itself. `npm run package` needs `npm ci` first on checkouts that predate the
APP-005 devDependencies — `electron-forge` missing fails with `command not
found`. The dev-mode screenshot helper (`support/screenshot.cjs`) cannot get
past the welcome gate because dev and packaged builds use different user-data
directories; worth fixing alongside APP-012.
