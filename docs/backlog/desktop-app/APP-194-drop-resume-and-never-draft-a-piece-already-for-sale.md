---
id: APP-194
title: Drop Resume and never draft a piece already for sale
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-186, APP-139]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

Resume sent "Let's pick up where we left off." and the agent repeated its
last status: nothing typing a reply doesn't do. Any reply without
finish_task left a thread "Stopped · Ready to resume", which reads as broken,
and the store thread stayed under Unfinished after the store opened.

Publish re-drafted pieces already for sale ("Prove the real request path…"
on Oct 6, and the 12 duplicates revoked that night), even while saying it
had checked.

## Proposed approach

- Remove Resume from the thread header and Today's Unfinished rows; a row
  opens its thread and the reply box carries on. Start over stays in the
  thread header.
- "Stopped · Ready to resume" becomes "Waiting for you · Reply to keep going".
- Hide the store thread from Unfinished once the store is open.
- `lore publication draft` skips a draft drawn from the same memory as a
  piece for sale whose title is mostly the same words (≥60% overlap), and
  says which piece it repeats so the agent drafts something else.

## Acceptance criteria

- [x] No Resume button anywhere.
- [x] Unfinished rows have no buttons and say "Waiting for you".
- [x] A repeat of a piece for sale is never staged; distinct pieces from the
      same memory still are (checked against the Oct 6 library: 13/20, 20/21,
      23/27 caught; 13/14, 15/16/17, 5/10 kept).
