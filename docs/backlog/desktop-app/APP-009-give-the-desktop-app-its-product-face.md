---
id: APP-009
title: Give the desktop app its product face
priority: P1
effort: M
component: desktop-app
status: completed
related: [APP-002, APP-003, APP-004, APP-006]
blockers: [APP-003]
dependencies: []
github_issue: null
created: 2026-08-22
updated: 2026-08-22
---

## Problem

The APP-002/003 shell worked but read as an admin template and spoke the
kernel's language: tool names in the activity line, a shell heredoc in the
approval card, permanent sign-in buttons in a capture footer, no account or
configuration surface, and no way in from a cold start.

## Proposed approach

Rebuild the renderer around the approved design frames without touching the
kernel's boundaries: sign-in as a first-launch welcome screen with the
official provider marks; sidebar with icons, memory search, and Settings; a
quiet composer with dictation, file attach and drop; Today as a feed (Needs
you, Recently kept, one strip of counts); approval cards that show the
memories being kept, never a command; a short agent log with no tool names;
sessions per task. The snapshot gains `home` and a readable `project_label`.

## Acceptance criteria

- [x] With no stored credential the app opens on the welcome screen; OAuth and
      API-key sign-in both land on Today, and Settings can sign out.
- [x] The capture approval card renders the parsed entries, and no view or
      event surfaces tool names or raw commands to the owner.
- [x] Search, attachments (picker and drop, with a guard against credential
      and hidden files), and every view render from the snapshot alone.
- [x] The keyboard path works: skip link, focus states, ⌘K to search.
- [x] `npm run check`, the desktop tests, and the Python suite stay green.

## Notes

Visual truth verified by rendering every state to PNG via
`support/screenshot.cjs`. Pi's native `read` tool can still read any path the
process can; scoping it is a separate hardening item to file when the app
grows beyond attended capture.
