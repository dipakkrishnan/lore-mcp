---
id: CAP-007
title: Read Apple Notes through Automation
priority: P2
effort: S
component: capture
status: in-review
related: [STO-003, APP-121, APP-120, APP-116]
blockers: [APP-121]
dependencies: ["STO-003 for the source kind and state"]
github_issue: null
created: 2026-09-17
updated: 2026-09-17
---

## Problem

Apple Notes is where most Mac owners keep the notes-to-self Lore wants,
and it has no export. Its database sits under Full Disk Access, which
macOS cannot prompt for. The AppleScript dictionary is the sanctioned path
and needs only the Automation prompt, which macOS shows on first use and
applies live without a relaunch. Lore's shipped build cannot send the
Apple Event today (`APP-121`).

## Proposed approach

The `script` kind from `STO-003`, run from Electron main: one `osascript`
that lists folders and note ids, then one call per note for name, body,
creation and modification dates, and the folder. `body of every note`
raises error -1741 on real libraries, so the loop is required; measured at
about 48 ms per note, so a thousand notes takes under a minute with
progress shown ("Reading… 340 of 1,000"). Bodies arrive as HTML; convert
to text. Before the first read the app shows the pre-permission sheet with
one Continue button and the sentence macOS will not say: "macOS will ask
whether Lore may control Notes. Lore reads your notes on this Mac and
nothing leaves it." Check the grant silently afterwards for the status
dot.

## Acceptance criteria

- [ ] From the connectors list, Continue triggers the macOS Automation
      prompt for Notes exactly once, and Allow leads to a preview with
      folder and note counts.
- [ ] The read imports chosen notes as private memories with creation
      dates and folder names, skipping notes shorter than a sentence.
- [ ] Don't Allow ends in a named state with an "Open System Settings"
      action that deep-links to Privacy_Automation.
- [ ] Ad-hoc-signed dev builds are excluded or clearly labelled, since TCC
      keys the grant to the signature and re-prompts every rebuild.

## Notes

Verified on this Mac 2026-09-16: the same script works from a terminal that
already holds the Automation grant (41 notes in 2.0 s). The silent status
check is `AEDeterminePermissionToAutomateTarget` with `askUserIfNeeded`
false, which needs a small native helper; a harmless `tell application
"Notes" to name` forcing the prompt is the fallback. iMessage is not in
scope: it needs Full Disk Access and a typedstream decoder.
