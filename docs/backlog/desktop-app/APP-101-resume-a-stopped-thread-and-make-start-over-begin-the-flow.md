---
id: APP-101
title: Resume a stopped thread with one press, and make Start over begin the flow again
priority: P1
effort: XS
component: desktop-app
status: in-review
related: [APP-053, APP-030, APP-097]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-07
---

## Problem

A thread cut off mid-turn shows "Ready to resume" with only a Start over
button. Resuming meant opening the thread and typing something, which nothing
says. Start over on Open your store recorded the restart, cleared the thread,
and then waited silently for the owner to type: the store flow never began
again, so "it just doesn't do anything" (final pass 2026-09-07).

## Proposed approach

Put Resume beside Start over on the Today row and in the thread header; it
opens the thread and sends "Let's pick up where we left off." Start over on
setup or the store sends that flow's opening line itself; a capture or
publish thread still waits for the owner's first word.

## Acceptance criteria

- [x] A stopped task offers Resume and Start over on Today and in its header.
- [x] Start over on Open your store begins the store flow again without typing.
- [x] Resume continues the cut-off session, not a new one.
