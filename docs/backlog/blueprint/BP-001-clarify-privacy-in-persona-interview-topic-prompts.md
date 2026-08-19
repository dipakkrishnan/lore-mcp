---
id: BP-001
title: Clarify that persona-interview topic/domain answers stay private
priority: P2
effort: S
component: blueprint
status: completed
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-08-03
updated: 2026-08-07
---

## Problem

The persona interview's topic-outline question gives no signal about
disclosure. A real run produced this exchange:

> "Got it, Sage Shane. Your lore will be arranged by theme, distilled into
> principles and judgment rather than a blow-by-blow log — deep wisdom gets
> full elaboration, everything else gets a passing mention. You can override
> the organizing axis later if that doesn't fit.
>
> Now — what areas of wisdom shall we inscribe? Speak in broad themes."

Nothing here tells the owner whether naming a topic makes it more likely to
be exposed externally later. In fact `blueprint.json` is pure local structure
— it's never disclosed, never reachable over MCP, and has no relationship to
what gets published until the owner separately runs `lore-publish` and
approves specific candidates. But the interview doesn't say that, so an owner
choosing topics has no way to tell "this just organizes my memory" from "this
is what buyers will see" at the moment they're asked to answer.

The contrast is stark against `lore-enable-payments`, which states the stakes
plainly before its analogous question: "This shapes what the synthesis task
hunts for, and what you could later choose to expose as paid answers over
MCP. Everything lands private — no memory is ever reachable over MCP,
whatever you do to it. Disclosing anything takes a publication you approve
yourself." The persona interview — which runs earlier, before any synthesis
or publishing exists — has no equivalent line.

## Proposed approach

Add a short, explicit privacy statement to `persona-interview.md`, either
once near the opener or immediately before the topic-outline question,
making clear that blueprint answers are private structural metadata and are
unrelated to disclosure. Keep the wording consistent with (or directly
reused from) the stakes line already validated in `lore-enable-payments`, so
the two skills don't describe the same guarantee two different ways.

## Acceptance criteria

- [x] The persona interview states, before or alongside the topic-outline
      question, that topic/domain answers are private and do not themselves
      disclose anything externally
- [x] The wording matches or explicitly cross-references the disclosure
      framing in `lore-enable-payments`'s valuable_context stakes statement
- [x] A fresh conversational run of the interview (see XC-005) reads as
      unambiguously private before the owner is asked to name topics

## Notes

Surfaced 2026-08-03 from a live onboarding walkthrough transcript quoted
above. Related in spirit to XC-005 (dry-running owner skills as
conversations), which would be a natural way to verify the fix once made.

**Prioritization pass 2026-08-03:** promoted `in-review` → `ready` at `P2`.
Unblocked, criteria are concrete, and the third criterion (a fresh
conversational run reads as private) can be checked by hand — it doesn't need
`XC-005`'s protocol to exist first, just the practice.

**Implementation 2026-08-07:** added a "Privacy note (state once, before Topic
outline)" section to `persona-interview.md`, placed immediately before the
"Persona-flavored questions" table so it fires ahead of every persona's
Topic-outline question, not just Sage's.

Correction on criterion 2's sourcing: the stakes line as quoted in this
item's Problem section does not currently exist verbatim in
`lore-enable-payments/SKILL.md` — grepping that file turns up no
disclosure/valuable_context framing at all. The actual analogous statement
lives in `lore-onboard/SKILL.md` Phase 2, immediately before its own
`valuable_context` question ("This shapes what the synthesis task hunts for.
Everything lands private, and no memory is ever readable outside this
machine, whatever you do to it. Sharing anything takes a publication you
write and approve yourself."). Either the quoted text drifted since this item
was filed or the attribution was always to the wrong skill. The new note
cross-references and matches wording with that Phase 2 line instead, since
it's the one that actually exists in the same skill today — same guarantee,
one consistent phrasing, just corrected to its real location.

Criterion 3 ("fresh conversational run... reads as unambiguously private")
was verified by close reading of the rendered flow, not a live dry-run agent
session — `XC-005`'s dry-run protocol still doesn't exist as tooling, same
gap the prioritization note above anticipated. The note's placement
(immediately before the Topic-outline row, ahead of all five personas) and
plain-language content satisfy the criterion by inspection.
