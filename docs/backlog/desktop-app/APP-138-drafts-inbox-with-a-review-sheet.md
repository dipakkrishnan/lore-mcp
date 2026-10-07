---
id: APP-138
title: Move draft approval into a Drafts inbox with a review sheet
priority: P1
effort: L
component: desktop-app
status: ready
related: [APP-136, APP-137, MON-039]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

Approval cards render on Today above everything else and inside unrelated
agent threads, pushing sales off-screen; two drafts take about three
screens. APP-136 made each card read-first, but they still live everywhere.

## Proposed approach

A "Drafts (N)" view, hidden when empty: one compact row per draft (title,
teaser, price, Preview / Skip / Approve) opening a review sheet grouped
"What anyone sees" / "What buyers pay to read", empty optional fields
collapsed. Live-piece updates (MON-039) use the same row and sheet. Today
shows only "N drafts to approve → Review"; threads link to the inbox
instead of embedding cards. Inspiration: Linear Inbox, Apple Mail.

## Acceptance criteria

- [ ] Drafts never render on Today or inside a thread, only a link with a count.
- [ ] Every approve still goes through the attended decide path.
- [ ] New pieces and live-piece updates share one row and sheet.
