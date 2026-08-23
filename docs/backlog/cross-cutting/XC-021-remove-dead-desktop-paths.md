---
id: XC-021
title: Remove dead desktop paths
priority: P2
effort: S
component: cross-cutting
status: completed
related: [APP-001, APP-004, APP-020]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

The shipped desktop app still carries its throwaway spike package, a superseded
onboarding checkpoint protocol, and snapshot and renderer fields with no reader.
These paths add maintenance surface without preserving a current product behavior.

## Proposed approach

Delete only code proven unreferenced or replaced by durable Pi sessions. Keep the
existing trust-boundary validation, owner approvals, and non-desktop onboarding
checkpoint behavior unchanged.

## Acceptance criteria

- [x] The unreferenced `app/spikes/` package is removed.
- [x] Desktop onboarding resumes from its Pi session without reading or writing the
      old checkpoint heredoc; other hosts retain checkpoint support.
- [x] Snapshot, renderer, and agent-status fields with no desktop reader are removed.
- [x] Desktop and Python checks pass with a net reduction in code.

## Notes

Raised from the deletion audit of the 2026-08-22 desktop PR stack. This item does
not authorize removing security validation, accessibility behavior, or packaging
needed by the shipped app.

Completed with 293 Python tests, 13 desktop tests, TypeScript, Ruff, and mypy
passing. The desktop now hard-denies the former checkpoint write; non-desktop
hosts retain their existing checkpoint instructions.
