---
id: APP-122
title: Bundle source logos with provenance and render Apple icons from disk
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-120, APP-115]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-17
updated: 2026-09-17
---

## Problem

A source list without logos reads as a form. Fetching favicons is not an
option: the renderer's CSP is `img-src 'self' data:` with `connect-src
'none'`, and PRIVACY.md promises the only thing Lore sends unprompted is
feedback the owner asks to send. A lookup on render would tell a third
party which services the owner is browsing. Apple's guidelines forbid
bundling the Notes or Messages icon at all.

## Proposed approach

Follow the existing `claude.svg` and `openai.svg` convention: one SVG per
service under `app/desktop/src/assets`, simple-icons format, each with a
comment recording the source URL and the date pulled. Per the brand pages:
GitHub, Bluesky, X, and Obsidian ship as-is (GitHub monochrome only);
Google Drive as the multicolour PNG, unchanged; Substack and Day One after
a short permission email; Slack and LinkedIn as a text label on a house
tile, since both forbid the mark and simple-icons removed them; Readwise
and Bear as house tiles until they answer. For Apple apps, render the icon
already on the owner's disk: `nativeImage.createThumbnailFromPath` on the
app bundle at 512 px in main, cached by bundle path and mtime, sent to the
renderer as a data URI. When a source has no logo, a house tile with the
initial in a colour derived from the name, never a broken image.

## Acceptance criteria

- [ ] Every source in the catalog renders a crisp 20 px mark at 2x, offline.
- [ ] No network request fires when the source list renders.
- [ ] Each bundled asset file names its source URL and pull date.
- [ ] Apple Notes shows the real Notes icon on a Mac that has it and a
      house tile on one that does not.

## Notes

Verified on this Mac 2026-09-16 with Electron 44: `createThumbnailFromPath`
returns a real 512 px image; `nativeImage.createFromPath` on the `.icns` is
empty; `app.getFileIcon` at size `large` crashes the process with SIGTRAP
and must never be called. simple-icons is CC0 but waives no trademark
rights; treat it as delivery, not licence.
