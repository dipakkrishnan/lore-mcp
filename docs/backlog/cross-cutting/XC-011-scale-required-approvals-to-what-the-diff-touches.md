---
id: XC-011
title: Scale required approvals to what the diff touches
priority: P2
effort: M
component: cross-cutting
status: ready
related: [XC-004, XC-012, XC-009, XC-010, XC-014]
blockers: []
dependencies: ["Repository admin access to configure branch protection or a ruleset — the current backlog author has push but not admin"]
github_issue: null
created: 2026-08-03
updated: 2026-08-26
---

## Problem

`main` has no protection at all. `GET /repos/dipakkrishnan/lore-mcp/branches/
main/protection` returns 404 and the repository has no rulesets, so today there
is no required approval, no required status check, and nothing that stops a
direct push to `main` bypassing pull requests entirely. There is no `CODEOWNERS`
file either.

"Zero approvals for ordinary changes" is therefore already true — by absence
rather than by decision, which means it is not recorded anywhere and cannot be
selectively tightened.

That matters most for one path. CI is the mechanism that enforces every other
gate in this pipeline: the test tiers `XC-004` hangs, the lint gate `XC-012`
adds, the type check `XC-009` adds, the title check `XC-010` adds. A pull
request that edits or deletes a workflow can disable all of them, and it is the
one class of change where an unreviewed merge removes the safety net itself
rather than risking a bug underneath it. Right now that change needs the same
zero approvals as a typo fix.

## Proposed approach

Require approvals as a function of what the diff touches. For now exactly one
rule, deliberately narrow:

| Paths changed | Approvals required |
|---|---|
| `.github/**` | 1 |
| everything else | 0 |

The mapping is expected to grow — payment and disclosure paths are the obvious
next candidates — so it should live somewhere that can gain rows without
redesigning the mechanism.

Two ways to build it, and the choice is a real trade-off rather than a detail:

1. **`CODEOWNERS` plus "require review from Code Owners".** Native GitHub, no
   custom code, and the ownership file is version-controlled. The problem is
   self-approval: GitHub does not let an author approve their own pull request,
   so on a repository this size a maintainer changing CI can be left unable to
   merge their own change with no second owner available. That is either the
   intended property or a deadlock, depending on how many people can review, and
   that question has to be answered before this is built.
2. **A status-check job** that reads the pull request's reviews via the API,
   computes the requirement from the changed paths, and fails when approvals fall
   short. Fully expressible in the repository, trivially extensible to a table,
   and it can say *why* it failed. It must trigger on `pull_request_review` as
   well as `pull_request`, or an approval arriving after the last push never
   re-evaluates and the check stays red.

Either way the enforcement half — required checks, or "require a pull request
before merging" — is branch protection or a ruleset, which is repository
settings, not a file. Whoever implements this needs admin on the repository.

## Acceptance criteria

- [ ] A pull request touching `.github/**` cannot merge without at least one
      approval
- [ ] A pull request touching nothing under `.github/**` can merge with zero
      approvals, with no new friction over today
- [ ] The path-to-approvals mapping is version-controlled in the repository, so
      changing the policy is itself reviewable — not configured only in GitHub
      settings where the change leaves no diff
- [ ] Changing the mapping requires an approval under its own rule
- [ ] Removing or dismissing an approval re-evaluates the requirement rather
      than leaving a stale pass
- [ ] The self-approval case is explicitly resolved and written down: either a
      second reviewer is genuinely required for CI changes, or the documented
      admin bypass is named along with when it is acceptable to use
- [ ] `main` requires a pull request, so the rule cannot be sidestepped by
      pushing directly

## Notes

Filed 2026-08-03 alongside `XC-010`, as the second of two pull-request-level
gates. Scope is deliberately minimal: one protected path, one approval. The
"this will eventually change" part is the mapping, not the mechanism, which is
why the mapping wants to be a table in the repository from the first version
even while it has a single meaningful row.

Verified 2026-08-03: no branch protection (`404` from the protection endpoint),
no rulesets (`[]`), no `CODEOWNERS`. Note that the 404 is also what an
insufficiently-permissioned read returns — the empty ruleset list and absent
`CODEOWNERS` are the stronger evidence, and an admin should confirm from
settings before assuming `main` is entirely unprotected.

Sequencing against the rest of the pipeline: this is worth more after `XC-012`,
`XC-009`, and `XC-010` land, because each one adds another gate that a workflow
edit could remove. It is not blocked by them — the rule protects
`.github/workflows/tests.yml`, which already exists.

**2026-08-04:** `XC-014` filed to cover the narrower, more urgent half of
this problem — making the status checks that already exist actually block a
merge — separately from this item's path-scaled approval mechanism. Same
admin dependency; worth executing together if picked up in the same pass.

**Prioritization pass 2026-08-26:** Admin-access dependency is real but not a hard blocker — `XC-014` (same admin gap, same author) already completed 2026-08-10, so an admin is reachable when needed. The mechanism trade-off (CODEOWNERS vs. a status-check job) stays open in the approach, but the AC are shape-agnostic and testable either way, unlike `MCP-002`'s pre-decision blocker. Recommend the status-check-job direction during implementation: version-controlled/extensible per the AC's own bar, and it avoids CODEOWNERS' self-approval deadlock risk. Promoted `in-review` → `ready`.
