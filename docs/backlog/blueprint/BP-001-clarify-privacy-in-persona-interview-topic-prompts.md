---
id: BP-001
title: Clarify that persona-interview topic/domain answers stay private
priority: P2
effort: S
component: blueprint
status: in-review
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-08-03
updated: 2026-08-03
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

- [ ] The persona interview states, before or alongside the topic-outline
      question, that topic/domain answers are private and do not themselves
      disclose anything externally
- [ ] The wording matches or explicitly cross-references the disclosure
      framing in `lore-enable-payments`'s valuable_context stakes statement
- [ ] A fresh conversational run of the interview (see XC-005) reads as
      unambiguously private before the owner is asked to name topics

## Notes

Surfaced 2026-08-03 from a live onboarding walkthrough transcript quoted
above. Related in spirit to XC-005 (dry-running owner skills as
conversations), which would be a natural way to verify the fix once made.
