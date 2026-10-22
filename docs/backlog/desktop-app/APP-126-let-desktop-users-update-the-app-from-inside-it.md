---
id: APP-126
title: Let desktop users update the app from inside it
priority: P2
effort: M
component: desktop-app
status: completed
related: [APP-005, APP-040]
blockers: []
dependencies: [APP-005]
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/266
created: 2026-09-19
updated: 2026-10-19
---

## Problem

Once the desktop app is installed there is no way to get a newer version of it
short of going back to the download page (`APP-040`), fetching the zip again, and
replacing the app by hand. Nothing in the running app says a newer release
exists, so an owner stays on the build they installed (issue #266: "I want to be
able to update my app easily such that I can get the latest version").

## Approach

**Update in place**, chosen 2026-10-13. Releases have been signed and notarized
since v0.1.1, so the blocker above is gone, and the repo is public, so
Electron's own `autoUpdater` can read it for free through
[update.electronjs.org](https://github.com/electron/update.electronjs.org) via
`update-electron-app` (`app/desktop/src/updates.cjs`). The service picks a mac
asset whose name matches `-(mac|darwin|osx)…zip` and `-arm64`; the existing
`Lore-macOS-arm64.zip` already matches (checked: a 0.1.12 request returns the
v0.1.13 zip, a 0.1.13 request returns 204), so the release step is unchanged.

The app checks on launch and every four hours and downloads quietly. When a
download is ready an **Update** pill appears beside the Lore name; clicking it
restarts into the new version. Settings → Updates shows the version and the
state in plain words. Squirrel swaps only the app bundle, so `~/.lore`, the
app-owned prefix and `credentials.bin` under user data stay as they were.

**App Translocation.** An early owner deleted and re-downloaded the app and
still ran the old build: his stack trace ran from
`/private/var/folders/.../AppTranslocation/.../Lore.app`, because macOS runs an
app opened straight from Downloads from a random read-only path. Squirrel
cannot replace an app there. So a packaged Lore outside Applications asks on
launch to move itself (`app.moveToApplicationsFolder()`), and until it is
moved, the same Update pill appears when a newer release exists and offers the
move again or, declined, opens the latest download (tell, then link).

## Acceptance criteria

- [x] A running app tells the owner when a newer release than the one they are
      on exists, without the owner visiting the download page first.
- [x] The owner can move to the newer version from that notice, in the app or
      by one click to the download.
- [x] Updating leaves the owner's memories, profile, and stored credentials
      untouched.
- [x] An app that cannot check (offline, or a build that cannot update itself)
      says so plainly and stays fully usable.

A real end-to-end update needs two published releases built with this code;
the first release that carries it is the first that can update itself.

## Notes

Cataloged from issue #266 on 2026-09-19. `APP-005` listed auto-update
infrastructure as out of scope "until real owner usage shows which one is
necessary"; this is that signal. `APP-040` covers first install only.

**Completed (verified 2026-10-19):** every acceptance criterion is checked and the work is on main in f0253bf, e568071. Status was left stale after merge; closed out in the review-queue pass.
