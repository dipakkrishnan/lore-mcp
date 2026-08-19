---
id: XC-007
title: Add reusable PR templates the backlog skills can reference
priority: P2
effort: M
component: cross-cutting
status: completed
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-08-03
updated: 2026-08-07
---

## Problem

No backlog playbook documents how to open a PR for its own output.
`implementation.md` explicitly stops short of it ("commit... Do not push, and
do not merge into a protected branch automatically"), and `ideation.md`,
`audit.md`, and the issue-cataloging steps say nothing about a PR at all.
In practice, every backlog PR opened so far has been improvised from
scratch each time — a fresh multi-paragraph `gh pr create --body` composed
freehand, re-describing the same handful of shapes ("filed a new item",
"regenerated INDEX.md via audit", "completed a ready item") in different
words every time. That's repeated, avoidable output-token cost on a
mechanical step, and it produces inconsistent PR bodies across items with no
shared structure to scan against.

## Proposed approach

Add a small set of reference PR-description templates — one per recurring
backlog PR shape (new item filed, item taken to completed, index
regenerated/audit pass, GitHub issue cataloged) — as plain files under
`docs/backlog/agents/` (e.g. `pr-templates/`), with placeholders for the
id(s), title, and a short checklist. Reference the relevant template
directly from each playbook that produces PR-worthy output, so an agent
fills a template instead of composing prose. Since the raw ask specifically
wants these usable by script, also provide a small helper (shell or Python)
that takes a template name plus fill-in values and renders the finished PR
body, so template use doesn't require the model to hand-assemble the
placeholders either.

This item should also settle *when* a backlog PR gets opened at all, since
today that's fully ad hoc (whichever agent or owner decides to push) —
templating the body doesn't help much if the trigger stays undocumented.

## Acceptance criteria

- [x] At least one reference template exists per current backlog PR shape:
      new item filed, item completed, index regenerated
- [x] `ideation.md`, `implementation.md`, and `audit.md` each link to the
      template they should use when a PR is warranted
- [x] A template-filling script exists and can render a complete PR body
      from an id + template name, not just serve as a copy-paste reference
- [x] Using a template on the next real backlog PR produces a materially
      shorter authored prompt than composing the body freehand

## Notes

Surfaced 2026-08-03 after manually authoring several backlog PR bodies
(MON-007's item PR, this item's own PR) freehand, each restating the same
audit-clean/no-conflicts boilerplate. Scope note: this only templates the PR
*body*; it doesn't change the shared rule that only a human (or an explicit
ask) triggers a push — see `implementation.md`'s "do not push" line.

**Prioritization pass 2026-08-03:** promoted `in-review` → `ready` at `P2`.
Unblocked, criteria are concrete, and it's process tooling rather than
user-facing work — worth doing but not ahead of this pass's `P1` items.

**Completed 2026-08-07:** shipped four templates under
`docs/backlog/agents/pr-templates/` (`new-item.md`, `completed-item.md`,
`index-regenerated.md`, `github-issue-cataloged.md` — the fourth beyond the
three named in the acceptance criteria, since `ideation.md`'s
issue-cataloging path is a distinct PR shape from a plain new-item PR) plus
`render_pr_body.py`, which derives each template's required `{{vars}}` by
scanning the file rather than keeping a separate declared list, and fails
loudly on an unknown template or a missing var instead of emitting a body
with `{{...}}` left in it. Linked from `ideation.md` (both the general flow
and the issue-cataloging flow), `implementation.md`, and `audit.md`. This
PR's own body was rendered from `completed-item.md` via the script — see
the PR for the exact command, satisfying AC4 by construction rather than by
separate demonstration. Covered by `tests/test_pr_templates.py` (7 cases:
successful render, missing-var and unknown-template failures, every shipped
template rendering cleanly with only its own declared vars, `--var` parsing,
and the CLI entry point).

Scope note: the Proposed approach's third paragraph — settling *when* a
backlog PR gets opened at all — is **not** resolved by this item. The
acceptance criteria don't ask for it, and doing so would be a policy change
better suited to its own item; `implementation.md`'s existing "do not push"
line still governs. Left as an open question for a future `ideation` pass
if it's worth pursuing.
