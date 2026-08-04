---
id: XC-014
title: Require the CI status checks to actually block merging to main
priority: P1
effort: S
component: cross-cutting
status: in-review
related: [XC-004, XC-009, XC-010, XC-011, XC-012]
blockers: []
dependencies: ["Repository admin access to configure branch protection or a ruleset — the current backlog author has push but not admin"]
github_issue: null
created: 2026-08-04
updated: 2026-08-04
---

## Problem

Every CI gate built so far — `XC-004` (tests), `XC-012` (lint/format), `XC-009`
(mypy), `XC-010` (PR title) — runs on every pull request and reports pass or
fail, but `main` has no branch protection and no ruleset (`XC-011` confirmed
this: `GET .../branches/main/protection` returns `404`, the ruleset list is
`[]`, and there is no `CODEOWNERS`). Nothing stops a pull request from merging
with a failing or still-running check, and nothing stops a direct push to
`main` that bypasses pull requests — and every one of these gates — entirely.

The checks exist and are visible on every PR, but none of them actually gate
anything. They are advisory, not enforced. `XC-010`'s own pull request (#77)
merged this exact gap still open, and its `## Notes` named the decision as
deliberately deferred rather than resolved.

## Proposed approach

With repository admin access, configure branch protection (or a ruleset) on
`main`:

1. Require a pull request before merging — no direct pushes to `main`.
2. Require the existing status checks to pass before merge: Python lint,
   Python unit tests, Bridge compiler checks, Node lint, Node compiler
   checks, Node component tests, Worker smoke test, and `References a
   backlog item` (`XC-010`'s check) — plus the mypy job once `XC-009`'s
   pull request lands.
3. Require a merging branch to be up to date with `main`, so a PR that
   passed against a stale base can't merge without re-running against the
   current one.
4. Record the configured rule set somewhere version-controlled — a note in
   `docs/backlog/README.md` at minimum, or a checked-in ruleset export if
   GitHub rulesets (rather than classic branch protection) are used, since
   rulesets can be exported and reviewed like code in a way branch
   protection settings cannot.

This is the close-out step for every prior CI item: each of `XC-004`,
`XC-009`, `XC-010`, `XC-012` built a gate; this is what turns "a check that
runs" into "a check that blocks."

## Acceptance criteria

- [ ] A pull request cannot merge into `main` while any required status
      check is failing or still running
- [ ] A direct push to `main` that bypasses a pull request is rejected
- [ ] The list of required checks is recorded outside GitHub's settings UI
      (README note or checked-in ruleset export), so adding or removing one
      is a reviewable change
- [ ] A branch behind `main` must be updated before merging
- [ ] Verified live: a throwaway pull request with a deliberately failing
      check shows the merge button blocked

## Notes

Filed 2026-08-04, prompted directly by `XC-010` landing (#77) with the
required-vs-advisory question explicitly left open in its own notes — the
check runs and reports, but nothing in `main`'s configuration acts on the
result yet.

Same admin gap as `XC-011`: `gh api repos/dipakkrishnan/lore-mcp` shows
`push`, not `admin`, for the current backlog author. The item can be fully
specified and reviewed without admin access; executing it needs a
maintainer who has it.

Related to but distinct from `XC-011`: `XC-011` builds a new path-scaled
*approval* requirement (new mechanism, new config surface); this item makes
the status checks that *already exist* merge-blocking (a settings change,
no new mechanism). They can land independently, but doing both in the same
settings pass avoids touching branch protection twice.
