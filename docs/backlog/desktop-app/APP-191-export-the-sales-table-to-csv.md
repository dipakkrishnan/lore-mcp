---
id: APP-191
title: Export the sales table to CSV
priority: P3
effort: S
component: desktop-app
status: in-review
related: [MON-018, APP-185]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

The Sales list on the For Sale page only lives in the app. A seller who wants
their sales for bookkeeping or taxes has no way to get them out.

## Proposed approach

Add an "Export CSV" button to the Sales section header. It writes one row per
sale: date, piece title, price paid, free or paid, buyer kind (agent or card)
and the transaction link. The rows come from what `app/desktop/src/sales.cjs`
already loads, and the file is saved through the main process's save dialog.

## Acceptance criteria

- [ ] "Export CSV" saves a file with one row per sale, matching the on-screen list
- [ ] The button is disabled when there are no sales

## Notes

Filed from the 2026-10-06 For Sale review. Low priority.
