---
id: APP-298
title: Clear the README's stale signing lines and Electron's boilerplate usage strings
priority: P3
effort: XS
component: desktop-app
status: in-review
related: [APP-121, APP-005, APP-291]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-15
updated: 2026-11-15
---

## Problem

Two small leftovers in the desktop app's packaging:

- `app/desktop/README.md` (around line 132) still says "Signing is wired but
  inert" and asks to confirm the bundle id "before the first signed build".
  Releases have been Developer ID signed and notarized since at least v0.1.25.
  The same section says the zip is used instead of a dmg, which APP-291's
  `postMake` dmg (in `forge.config.js`) has since changed.
- The built `Info.plist` still carries Electron's boilerplate usage strings,
  inherited from `node_modules/electron/dist/Electron.app/Contents/Info.plist`:
  `NSCameraUsageDescription` ("This app needs access to the camera"),
  `NSBluetoothAlwaysUsageDescription` and `NSBluetoothPeripheralUsageDescription`
  ("This app needs access to Bluetooth") and `NSAudioCaptureUsageDescription`
  ("This app needs access to audio capture"). `forge.config.js`
  `packagerConfig.extendInfo` overrides only the five Lore uses (microphone,
  Apple Events, Documents, Desktop, Downloads). Lore uses none of the
  boilerplate ones, and if anything ever triggers them the owner sees
  Electron's copy, not Lore's.

## Proposed approach

- Rewrite the README's signing paragraph to describe the signed, notarized
  release as it is now (the env vars it reads still apply), and the zip/dmg
  line to match APP-291.
- Remove the unused keys from the packaged plist (a `postPackage` hook that
  deletes them with `plutil -remove`), or, if removal is not safe for
  Chromium, override each in `extendInfo` with a Lore string saying Lore does
  not use it.
- Add a unit test in `app/desktop/test/unit/packaging.test.cjs` that fails if
  any usage string the packaged app ships is Electron's "This app needs
  access to …" copy.

## Acceptance criteria

- [ ] `app/desktop/README.md` no longer says signing is inert or that there
      is no dmg.
- [ ] `plutil -p out/Lore-darwin-arm64/Lore.app/Contents/Info.plist` shows no
      "This app needs access to" string.
- [ ] A unit test pins that every `NS*UsageDescription` Lore ships is Lore's
      own copy.

## Notes

Filed 2026-11-15 from the in-review close-out. APP-121 (completed) added the
five strings Lore needs and left Electron's others untouched.
