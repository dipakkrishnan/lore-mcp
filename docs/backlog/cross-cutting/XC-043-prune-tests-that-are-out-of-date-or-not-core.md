---
id: XC-043
title: Prune tests that are out of date or don't test core behavior
priority: P2
effort: S
component: cross-cutting
status: in-review
related: [XC-013]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

The suites carried tests that pin incidental copy, grep source files, repeat the
argparse table, test library behavior (pydantic frozen models, Pi's own tools),
or test backlog tooling. Some were out of date: a seller edge check matched only
September dates and broke on Oct 1, and two deploy tests patched `push` where
deploy calls `push_job`.

## Proposed approach

Delete tests that don't exercise Lore's behavior; fix tests that do but have
drifted. Never delete owner gates, payments, store, deploy, connector, sandbox or
skill safety-boundary tests.

## Acceptance criteria

- [x] Every suite passes: Python, desktop unit and CI edge scenarios, node store, feedback relay, bridge
- [x] No test is tied to a month or a single model version
