---
id: APP-253
title: Build, sign and auto-update a Windows installer
priority: P3
effort: M
component: desktop-app
status: ideation
related: [XC-095, APP-251, APP-252, APP-254]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

forge.config.js ships a darwin zip only. The packaging scripts (icon.sh, wheelhouse.sh, node.sh,
whisper.sh) are sh plus macOS tools (sips, iconutil, codesign, Metal, darwin-arm64 downloads). There is
no Windows signing, and updates.cjs assumes /Applications.


## Proposed approach

Port the packaging scripts to Node so one script serves both OSes (uv x86_64-pc-windows-msvc, wheels
built on windows-latest, npm win-x64 with a node.cmd shim using ELECTRON_RUN_AS_NODE, CPU whisper-cli.exe,
icon.ico). Add @electron-forge/maker-squirrel + electron-squirrel-startup. Sign with Azure Artifact
Signing (windowsSign) from a windows-latest release job. Publish Setup.exe/RELEASES/nupkg to the same
GitHub release so update-electron-app serves win32-x64. Skip the move-to-Applications branch on
Windows; skip the update check on --squirrel-firstrun. Per-platform `ignore`.


## Acceptance criteria

- [ ] Signed Lore-Setup.exe installs per-user without admin; shows publisher "Dipak Krishnan" (or the company)
- [ ] An older installed build updates itself to the next release
- [ ] Uninstall removes shortcuts; Lore home (~/.lore) is kept
- [ ] macOS release pipeline unchanged


## Notes

SmartScreen will warn until download reputation builds; EV certificates no longer reliably skip this.

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
