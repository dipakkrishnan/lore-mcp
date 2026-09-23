---
id: APP-121
title: Ship the entitlements and purpose strings connectors need
priority: P1
effort: S
component: desktop-app
status: in-progress
related: [CAP-004, CAP-007, APP-005, APP-120]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-17
updated: 2026-09-17
---

## Problem

The signed Lore.app carries only osx-sign's default entitlements and one
purpose string (microphone). Under the hardened runtime an Apple Event to
Notes is refused regardless of what the owner allows in System Settings,
because `com.apple.security.automation.apple-events` is absent and
`NSAppleEventsUsageDescription` is missing from Info.plist, so the read
fails silently. A vault picked under Documents, Desktop, or Downloads
prompts with Electron's boilerplate instead of Lore's words.

## Proposed approach

In `app/desktop/forge.config.js`: add `NSAppleEventsUsageDescription`,
`NSDocumentsFolderUsageDescription`, `NSDesktopFolderUsageDescription`, and
`NSDownloadsFolderUsageDescription` to `packagerConfig.extendInfo`, each a
specific sentence in sentence case ending in a period, and point `osxSign`
at a custom entitlements plist that adds the apple-events entitlement to
the defaults. Rebuild, sign, notarize, and verify with `codesign -d
--entitlements -` and `plutil -p Info.plist` rather than trusting the
build, given the earlier symlink failure that broke signing silently.

## Acceptance criteria

- [ ] `codesign -d --entitlements -` on the built app lists
      `com.apple.security.automation.apple-events`.
- [ ] Info.plist carries the four usage strings in Lore's voice.
- [ ] From the notarized build, an `osascript` naming Notes triggers the
      macOS Automation prompt reading "Lore" wants access to control
      "Notes".
- [ ] The release checklist records the entitlement so a future rebuild
      cannot drop it.

## Notes

Notion.app (Electron, hardened, not sandboxed) is the reference
configuration. Lore is not sandboxed, so Full Disk Access paths remain
open later, but nothing here asks for it. Ad-hoc-signed dev builds show up
in TCC as "Electron" and re-prompt on every rebuild.

2026-09-17: config landed on branch app-121-entitlements:
`app/desktop/packaging/entitlements.plist` (the signer's defaults that the
app uses, jit and audio-input, plus apple-events; bluetooth, camera, print,
usb, and location were only there because the default plist lists them and
nothing in Lore asks for them) wired through `osxSign.optionsForFile`, and
the four purpose strings in `extendInfo`. The README carries the two
post-build checks. The first three criteria need the next signed build,
which is Dipak's step, so the item stays in progress until he runs it.
