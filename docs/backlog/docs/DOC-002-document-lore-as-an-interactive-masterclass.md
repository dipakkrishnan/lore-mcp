---
id: DOC-002
title: Document Lore as an interactive masterclass and coaching surface
priority: P2
effort: XS
component: docs
status: in-review
related: [XC-002, MCP-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-01
updated: 2026-08-07
---

## Problem

Lore is currently explained mainly as paid access to bounded answers, which
undersells what accumulated firsthand expertise can become. The same approved
publications could support an interactive "masterclass": a learner brings their
own goal, work, or decision and gets personalized coaching grounded in the
owner's judgment, examples, and failures. That framing opens many use cases but
is not documented well enough to evaluate or communicate.

## Proposed approach

Write a short product note that names the shared primitive — an agent using an
owner's approved lore to teach, critique, question, rehearse, and guide — then
maps the surrounding use-case family. Include adaptive tutoring, artifact
critique, decision rehearsal, case-based teaching, role-play, office hours,
curriculum generation, and ongoing mentorship. Show how each use case can begin
with today's `discover` and `answer` surface, while keeping private memories
private and avoiding claims that the agent literally is the owner.

Treat "masterclass" as working shorthand for the experience, not a committed
product name or a reason to add new infrastructure.

## Acceptance criteria

- [ ] A concise product note explains the interactive masterclass/coaching
      thesis in plain language and catalogs at least six distinct use cases.
- [ ] The note identifies the common product primitive beneath those use cases
      and separates the first plausible wedge from later variants.
- [ ] Every example respects `private memories -> explicit publication -> paid
      answer`; coaching is derived only from owner-approved publications.
- [ ] The note distinguishes grounded access to someone's expertise from
      impersonating that person or promising their endorsement.
- [ ] The note states which use cases work on the existing `discover`/`answer`
      surface and names any capability that truly requires future product work.

## Notes

Captured from the idea: "Masterclass in Lore — coaching, so many different use
cases." Start with positioning and use-case validation; do not build a separate
coaching subsystem until one interaction pattern proves it needs more than the
existing answer loop.

**Prioritization pass 2026-08-03:** promoted `in-review` → `ready` at `P2`.
Unblocked, `XS` effort, and the criteria describe a self-contained writing task
with no open design questions.

**2026-08-07:** product note written at `docs/masterclass-coaching.md`, all
five acceptance criteria addressed. `ready` → `in-review` pending PR review;
the shipped `discover`/`get` surface has no `answer` tool yet (`MCP-003` is
still `in-review`), so the note is explicit about which use cases work today
via client-side synthesis over `get` versus which need `MCP-003`'s `answer`
tool once it lands.
