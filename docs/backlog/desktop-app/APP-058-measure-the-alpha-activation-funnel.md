---
id: APP-058
title: Measure the alpha activation funnel
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-001, APP-041]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-03
updated: 2026-09-03
---

## Problem

Once a few people use Lore, anecdotes alone will not show whether they reach
first value, return, or consistently stop at the same step. The desktop app has
no coarse product signal for setup, capture, publishing, or opening a store.

## Proposed approach

Send a small allowlisted set of milestone events to the simplest hosted sink
available: app opened, sign-in completed, setup completed, memory saved,
publication approved, store opened, and sale viewed. Include only a random
installation id, app version, and timestamp. Never send memory or publication
content, prompts, source paths, URLs, wallet or transaction identifiers, or
credentials. Delivery is best-effort, never blocks the product, is disclosed in
the app, and can be disabled in Settings.

## Acceptance criteria

- [ ] The events can answer how many alpha installs reach setup, first saved
      memory, publication, store, and a viewed sale, plus whether they reopen
      Lore on a later day.
- [ ] The event schema cannot carry user content, paths, URLs, payment details,
      or secrets; automated coverage checks the allowlist.
- [ ] Analytics failures never interrupt a user action, and Settings provides a
      plainly worded disclosure and off switch.
- [ ] The implementation uses one existing or commodity event sink without a
      custom analytics service or in-app dashboard.

## Notes

This is deliberately crude alpha instrumentation. Add richer funnels or
experimentation only after real usage creates a concrete question the milestone
events cannot answer.
