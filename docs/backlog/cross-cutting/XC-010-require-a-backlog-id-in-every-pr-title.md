---
id: XC-010
title: Require a backlog id in every pull request title
priority: P1
effort: S
component: cross-cutting
status: completed
related: [XC-004, XC-007, XC-011]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-03
updated: 2026-08-04
---

## Problem

The convention already exists — `MCP-001: reframe discover as manifest-first`,
`XC-004: run the Python test suite in CI` — and it is followed a quarter of the
time. Across the last 40 pull requests:

| Title shape | Count |
|---|---|
| `ID: summary` | 10 |
| id present, but mid-title or parenthesised | 13 |
| no backlog id at all | 17 |

So the link from merged work back to the item that justified it is missing or
unparseable on three quarters of the history. `git log --oneline` cannot answer
"what shipped for MON-003", and the backlog cannot answer "which PR closed
this" without someone remembering. The backlog is this project's planning system;
a title convention nobody enforces is the seam where it stops matching the code.

This is a check nothing else in the proposed pipeline covers. Every other tier
inspects the diff — this one inspects the pull request.

## Proposed approach

A workflow triggered on `pull_request` with types `[opened, edited, reopened,
synchronize]` that validates the title. `edited` is the one that matters most: a
check that runs only on open lets a title be fixed to pass and then changed back,
and never re-runs.

Two levels of validation, and the second is the point:

1. **Shape** — the title matches `^[A-Z]{2,5}-\d{3}: \S`.
2. **Existence** — the id resolves to a real file under `docs/backlog/`. A typo
   like `XC-099:` satisfies any regex while pointing at nothing, and that is the
   failure this check exists to prevent. Since the workflow already has the
   repository checked out, this is a glob, not an API call.

The open question is what to do about pull requests that genuinely do not have
one owning item, because they exist and are not mistakes:

- `#55` — "Backlog: record what the launch weekend closed (MON-002, MON-003,
  XC-002)", three items at once
- `#54` — a backlog ideation PR that created seven items and closed none
- dependency bumps, typo fixes, and revert commits, which have no item and
  should not need one filed first

Recommended: allow a small prefix allowlist (`Backlog:`, `chore:`, `revert:`)
alongside the id form, rather than a bypass label. A prefix is visible in the
title itself, so the exception is legible in `git log`; a label is invisible
there and tends to become the default path. Whichever is chosen, it should be a
short closed set, and the check should name the allowed forms in its failure
message so the fix is obvious without opening this item.

## Acceptance criteria

- [x] A pull request titled without a leading `ID: ` (and not matching an
      allowed exception form) fails the check
- [x] A pull request whose id is well-formed but has no matching file under
      `docs/backlog/` fails, with a message naming the unknown id
- [x] Editing a pull request title re-runs the check rather than leaving a stale
      result
- [x] The exception path for multi-item and no-item pull requests is documented
      in `docs/backlog/README.md`, and is a closed set rather than a free-text
      escape
- [x] The failure message states the required format and the allowed exceptions
- [x] The check runs on pull requests from forks without needing write
      permissions or repository secrets

## Notes

Filed 2026-08-03 at the same time as `XC-011`, as the two pull-request-level
gates added to the pipeline `XC-004` maps. Neither inspects code, so neither
belongs among that item's jobs.

Compliance numbers measured 2026-08-03 over `gh pr list --limit 40` on
`dipakkrishnan/lore-mcp`, counting `^[A-Z]{2,5}-\d{3}: ` as strict compliance.

`XC-007` (PR templates the backlog skills reference) is the other half of this.
That item makes the right title easy to produce; this one makes the wrong one
fail. Build them together if both are picked up — a template that emits
`<ID>: <summary>` in the title field is worth more than either alone, and the
allowlist decided here is what its template needs to reflect for the backlog
skills' own PRs, which are exactly the multi-item case.

Worth deciding during implementation, and deliberately not decided here: whether
this check is *required* to merge or advisory. Making it required means a
maintainer with a legitimate untitled hotfix has to rename the PR before merging,
which is cheap; making it advisory means it will be ignored, which is what the
current 25% rate already demonstrates. The recommendation is required, with the
allowlist wide enough that legitimate work always has a passing form.

**Prioritization pass 2026-08-03:** promoted `in-review` → `ready` at `P1`.
Unblocked, small effort, and the open questions above (allowlist form,
required-vs-advisory) both carry a clear stated recommendation — handing this
to implementation as-is means picking the recommendation, not inventing one.

**Implementation 2026-08-04:** built as recommended — a `pull_request`
workflow (`.github/workflows/pr-title.yml`) on `[opened, edited, reopened,
synchronize]` running `.github/scripts/check_pr_title.py`, which checks
shape (`^[A-Z]{2,5}-\d{3}: \S`) then existence (`docs/backlog/*/<ID>-*.md`),
with the `Backlog:`/`chore:`/`revert:` allowlist as the alternative to the id
form. Exception path documented in `docs/backlog/README.md`. Uses the
default `pull_request` trigger (not `pull_request_target`) and `permissions:
contents: read`, so it runs on fork PRs with no secrets or elevated token —
satisfies that criterion without needing anything special.

Left as a follow-up, not blocking completion: the required-vs-advisory
branch-protection setting. The recommendation from filing stands (required),
but turning it on needs repository admin to configure required status
checks, and the current backlog author has push, not admin — same gap noted
in `XC-011`. The workflow runs and reports on every PR either way; only its
enforcement is soft until someone with admin flips it.
