---
id: APP-001
title: Expose one machine-readable desktop state snapshot
priority: P1
effort: M
component: desktop-app
status: in-review
related: [MON-013, MON-015, STO-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-21
updated: 2026-08-21
---

## Problem

A desktop app cannot reliably show setup progress, the private library, or the
deployed store from Lore's human-formatted terminal output. The underlying
facts already exist, but they are spread across SQLite, local configuration,
and the deployed node; scraping them into a second model would create drift.

## Proposed approach

Add one JSON snapshot command assembled from existing store, pricing, and
deployment helpers. It should report setup readiness, memory and publication
counts, current prices, node URL, local-versus-live publication state, and any
already-available answer-job totals without returning memory bodies or secrets.
Represent unavailable live state explicitly. Do not add charts or a second
analytics store.

## Acceptance criteria

- [ ] One CLI command returns versioned JSON with no ANSI or explanatory text.
- [ ] The snapshot covers onboarding readiness, library/publication states,
      configured prices, node URL, and whether approved publications are live.
- [ ] A missing or unreachable deployment is represented as data rather than a
      command failure.
- [ ] The snapshot contains no private memory bodies, credentials, or wallet
      secrets.
- [ ] A subprocess test proves the JSON contract from a temporary Lore home.

## Notes

This is the read model for the desktop app, not a new domain API. `MON-013`
owns the underlying local-versus-deployed drift semantics. Revenue trends are
deferred until real transaction history and an owner-authenticated read path
exist; current truth is enough for the first Store view.
