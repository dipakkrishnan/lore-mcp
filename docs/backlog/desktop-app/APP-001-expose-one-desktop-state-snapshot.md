---
id: APP-001
title: Expose one machine-readable desktop state snapshot
priority: P1
effort: M
component: desktop-app
status: completed
related: [MON-013, MON-015, STO-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-21
updated: 2026-08-22
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

- [x] One CLI command returns versioned JSON with no ANSI or explanatory text.
- [x] The snapshot covers onboarding readiness, library/publication states,
      configured prices, node URL, and whether approved publications are live.
- [x] A missing or unreachable deployment is represented as data rather than a
      command failure.
- [x] The snapshot contains no private memory bodies, credentials, or wallet
      secrets.
- [x] A subprocess test proves the JSON contract from a temporary Lore home.

## Notes

This is the read model for the desktop app, not a new domain API. `MON-013`
owns the underlying local-versus-deployed drift semantics. Revenue trends are
deferred until real transaction history and an owner-authenticated read path
exist; current truth is enough for the first Store view.

Provider sign-in state (Claude/OpenAI credential presence) is deliberately not
a snapshot field: that credential lives in the app's OS keychain, which the
Python CLI cannot and must not read. The app composes its own auth facts over
the snapshot when it renders the setup checklist. Keep the two sources
separate so the CLI contract never grows a dependency on app-side secrets.

Implemented as `lore desktop-state`. Live state comes from the node's free
`discover` tool. Drafts and answer-job totals remain explicitly unavailable
because neither has an owner-readable source of truth. Implementation was
explicitly approved by the owner on 2026-08-22.
