---
id: CAP-034
title: Read Chrome and Safari bookmarks already on the Mac
priority: P3
effort: S
component: capture
status: ideation
related: [CAP-032, CAP-033]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-14
updated: 2026-10-14
---

## Problem

Bookmark folders are years of hand-picked sources on a topic, and they are
already on disk. No sign-in is needed.

## Proposed approach

A folder-style connector whose `choices()` finds Chrome profiles
(`~/Library/Application Support/Google/Chrome/*/Bookmarks`, JSON) and
Safari's `~/Library/Safari/Bookmarks.plist`. Each bookmark folder becomes one
item: the folder path, then titles and URLs.

## Acceptance criteria

- [ ] Chrome profiles are offered without asking for a path.
- [ ] One item per folder; a refresh picks up added bookmarks.

## Notes

Safari's plist needs Full Disk Access, the same permission problem as Apple
Notes (CAP-007). Start with Chrome, and offer Safari only once that permission
flow exists.
