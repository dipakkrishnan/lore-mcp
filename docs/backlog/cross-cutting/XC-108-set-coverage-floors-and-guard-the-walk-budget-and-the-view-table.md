---
id: XC-108
title: Set coverage floors and guard the walk budget and the view table
priority: P2
effort: S
component: cross-cutting
status: ready
related: [XC-098, APP-266, APP-270, XC-099, XC-096]
blockers: [XC-098, APP-266, APP-270]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

A pyramid only stays one if something refuses the first eighth walk, the
first Worker test that sneaks `cloudflare:workers` into the node project,
and the first view that quietly stops being scanned. The old
`test/ci-edge.test.cjs` guarded one such property (every persona had a CI
step) until XC-077 replaced it; nothing guards the shape the test-pyramid
plan builds. And the coverage numbers XC-098 reports are advisory until a
floor makes them binding.

## Proposed approach

Three guards and a set of floors. Floors: from XC-098's first weeks of
numbers, set a statement and branch floor per Node package a few points
under the measured value, enforced in that package's CI job the way XC-096
enforces Python's. Guard one, in `app/desktop/test/unit/walks-budget.test.cjs`:
fail if `support/walks.cjs` has more than seven entries or its `seconds`
sum exceeds 450, unless the PR adds a one-line note in the walks file naming
the item that allows it. Guard two, in each Worker's node project: fail if
any `test/unit/` file imports `cloudflare:workers` or `cloudflare:test`
(XC-099 may already add this; then it is confirmed here). Guard three, the
view table: a test reads APP-266's seven-walk table and edge.cjs's `shot()`
calls and fails if any view in the table is no longer scanned by its named
walk at its named width. Editing the table is the only sanctioned way to
change scan coverage, and the diff shows it.

## Acceptance criteria

- [ ] Each Node package's CI job fails below a per-package statement and
      branch floor recorded in its config, with the number and date in Notes.
- [ ] A PR that adds an eighth walk, or pushes the `seconds` sum past 450,
      without a note fails the walks-budget test.
- [ ] A PR that imports `cloudflare:workers` from a node-project test fails.
- [ ] A PR that removes a scanned view from a kept walk without editing the
      table fails the view-table guard; the three cases are shown on a
      throwaway branch and the run links recorded in Notes.
- [ ] Layout scan: this item adds the guard that protects scan coverage;
      no view scanned before this change is unscanned after it.

## Notes

- Workstream E2 of the test-pyramid plan.
