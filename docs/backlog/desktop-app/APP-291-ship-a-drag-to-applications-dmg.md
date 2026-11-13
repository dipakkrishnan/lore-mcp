---
id: APP-291
title: Ship a drag-to-Applications disk image beside the update zip
priority: P3
effort: S
component: desktop-app
status: in-review
related: [APP-126, APP-040, APP-005]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-06
updated: 2026-11-12
---

## Problem

The download is a 331 MB zip. Chrome leaves it in Downloads; the owner double-clicks it, Archive Utility unpacks a
633 MB Lore.app beside it, and they run Lore from Downloads. Nothing ever shows them where it belongs, so the first
thing Lore says is a "Move to Applications" alert (walk of 0.1.24, Nov 6). Apps people install happily (Wispr Flow,
the owner's reference) open a disk image whose window says "To install, drag the app to Applications", with the app,
an arrow and the Applications folder.

## Proposed approach

- `npm run make` also writes `out/make/Lore-macOS-arm64.dmg`: Lore on the left, an Applications link on the right, and
  a light picture behind them reading "To install, *drag* Lore to Applications" with an arrow between the two.
- Built by `dmgbuild` (pure Python, run by the bundled uv) from forge's `postMake` hook. appdmg, which forge's DMG maker
  uses, needs a native module (macos-alias) that no longer compiles on current Node.
- Signed with `LORE_SIGN_IDENTITY`, notarized and stapled with the `APPLE_API_*` variables, as the app is.
- The zip stays: update.electronjs.org serves only `.zip` assets to Squirrel.Mac.
- The release uploads both assets under stable names; the site's Download points at the disk image (separate change).

## Acceptance criteria

- [ ] `npm run make` produces `Lore-macOS-arm64.dmg` and the zip.
- [ ] Mounted, the image shows Lore.app and an Applications link side by side over the drag picture, at 1x and Retina.
- [ ] With signing variables set, `spctl -a -t open --context context:primary-signature` accepts the image and
      `stapler validate` passes.
- [ ] The update check still finds the zip.

## Notes

**Prioritization (2026-11-12):** Priority P3 (was P1). Stays in-review.
Before it can be ready: Confirm criterion 3 (spctl and stapler validate) on
a signed release build, then close. Prioritization flag (not acted on):
done: #669; signing check needs a signed build.
