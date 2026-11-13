---
id: APP-138
title: Move draft approval into a Drafts inbox with a review sheet
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-136, APP-137, MON-039]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-11-12
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

## Notes

**Prioritization (2026-11-12):** Priority P2 (was P1), effort M (was L).
Moved back from ready to in-review. Before it can be ready: Mostly shipped
(Drafts view, Inbox row). Rewrite against the Inbox and Drafts view keeping
two criteria: drafting threads link to Drafts instead of embedding approvals
(if still wanted), and the grouped review sheet. Drop the Today wording.
Prioritization flag (not acted on): mostly done.
