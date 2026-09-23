---
id: APP-126
title: Let desktop users update the app from inside it
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-005, APP-040]
blockers: []
dependencies: [APP-005]
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/266
created: 2026-09-19
updated: 2026-09-19
---

## Problem

Once the desktop app is installed there is no way to get a newer version of it
short of going back to the download page (`APP-040`), fetching the zip again, and
replacing the app by hand. Nothing in the running app says a newer release
exists, so an owner stays on the build they installed (issue #266: "I want to be
able to update my app easily such that I can get the latest version").

## Proposed approach

Two shapes, and the choice is not made here:

- **Tell, then link.** The app compares its own version to the latest GitHub
  release and, when a newer one exists, says so and opens the `APP-040`
  download URL. Needs no signing, but the owner still replaces the app by hand.
- **Update in place.** Electron's `autoUpdater` (for example through
  `update-electron-app`) against GitHub Releases. On macOS this needs a
  code-signed build, and the current build is unsigned until the Apple Developer
  credentials `APP-005` is waiting on arrive, so this shape cannot land first.

Unclear which the owner needs — needs investigation. Either shape has to leave
the app-owned prefix `APP-005` installs on first launch, and the owner's
memories and credentials, exactly as they were.

## Acceptance criteria

- [ ] A running app tells the owner when a newer release than the one they are
      on exists, without the owner visiting the download page first.
- [ ] The owner can move to the newer version from that notice, in the app or
      by one click to the download.
- [ ] Updating leaves the owner's memories, profile, and stored credentials
      untouched.
- [ ] An app that cannot check (offline, or a build that cannot update itself)
      says so plainly and stays fully usable.

## Notes

Cataloged from issue #266 on 2026-09-19. `APP-005` listed auto-update
infrastructure as out of scope "until real owner usage shows which one is
necessary"; this is that signal. `APP-040` covers first install only.
