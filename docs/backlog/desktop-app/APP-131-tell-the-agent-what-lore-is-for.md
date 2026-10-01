---
id: APP-131
title: Tell the desktop agent what Lore is for
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-128, CAP-009]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

The desktop agent's system prompt said who it was but not what Lore is for, so a
finished capture thread had nothing to anchor it. Asked to "uplevel my
offerings", it tried to buy marketplace advice; told "I mean to sell", it gave
go-to-market advice for the owner's product. The capture rule also forbade
mentioning publication. Separately, an answer sent as two text blocks rendered
as one run-on sentence, and Granola's "no account" refusal read as "can't reach
Granola".

## Proposed approach

One purpose sentence in the system prompt; the capture rule points a selling
request at Draft for sale on the saved memory. Text blocks join as paragraphs. A hosted
app can name the phrase it answers someone with no account, and Lore says so.

## Acceptance criteria

- [x] The system prompt says what Lore is for and what selling means in it
- [x] Two text blocks render as two paragraphs, live and in history
- [x] A Granola sign-in with no Granola account says so
