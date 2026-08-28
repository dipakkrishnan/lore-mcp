---
id: XC-001
title: Separate the capture, retention, and disclosure decisions
priority: P3
effort: S
component: cross-cutting
status: in-review
related: [STO-001, CLI-001, ONB-001, XC-002]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/6
created: 2026-07-26
updated: 2026-08-26
---

## Problem

`lore review` collapses three separable decisions into one keystroke: whether
content enters Lore at all (capture), whether to keep it (retention), and whether
a paying stranger may see a derivative (disclosure). Capture and retention are
cheap, reversible, and automatable; disclosure is expensive and irreversible.
Reviewing 50 memories is exhausting because the flow forces the expensive
decision on every item, including the many where it's irrelevant.

## Proposed approach

Treat this as the framing that ties STO-001 (capture tier), CLI-001 (cheap
retention decisions in bulk), and ONB-001 (in-session capture + disclosure
prompt) together, rather than a separate implementation. Design each so that
capture/retention default toward safe and automatic, and disclosure stays rare
and deliberate. Use it as the yardstick when prioritizing those items.

## Acceptance criteria

- [ ] The three related items are designed so disclosure never defaults
      permissive and is always an explicit owner action.
- [ ] There is a stated target for owner disclosure decisions per week that is
      independent of session/capture volume (draft: under 5).
- [ ] No path lets capture or retention convenience produce a disclosure
      without an explicit owner-approved publication (the `external` status
      this originally guarded against was retired in PR #19; the invariant
      now lives at the publications boundary).

## Notes

Cataloged from https://github.com/dipakkrishnan/lore-mcp/issues/6. This is the
"funnel, not interface" reframing from PR #9's design note — kept as a
cross-cutting yardstick rather than a doc, since the backlog now supersedes the
freeform essay. The two design targets: <5 owner decisions/week (volume-
independent) and zero irreversible-disclosure errors.

Prioritization 2026-07-27: dropped P2→P3. This is a design principle, not
standalone build work, and it is now concretely realized by CLI-001 (bulk is
retention-only) and specified into STO-001/XC-002 (private-by-default,
publications-only disclosure, no bulk externalization). It stays as a review lens
for those items; it is a candidate for closure once STO-001 and XC-002 land rather
than something to implement on its own.

**Prioritization pass 2026-08-26:** the stated closure trigger has landed —
`STO-001`, `XC-002`, and `CLI-001` are all now `completed`, satisfying AC1
(disclosure never defaults permissive — structural, per `STO-001`/`XC-002`'s
publications-only model) and AC3 (no bulk-externalization path — `CLI-001`'s
bulk action is retention-only). AC2 is not: `grep`ing the repo found no
committed statement of the "<5 owner disclosure decisions/week" target
anywhere (not in `README.md`, not under `docs/`). Not closing this — write
the target down somewhere real (a natural fit: `README.md`'s disclosure
model section) before treating this as done; left `in-review` at `P3`.
